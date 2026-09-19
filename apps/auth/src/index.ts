import { randomBytes } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import Provider, {
  errors,
  type Account,
  type Configuration
} from "oidc-provider";
import { SqliteAdapter } from "./adapter.js";
import { config } from "./config.js";
import { loadOrCreateJwks } from "./keys.js";
import {
  consentPage,
  homePage,
  interactionSubmitGuardScript,
  loginPage,
  registerPage
} from "./html.js";
import { findUser, registerUser, verifyUser } from "./users.js";

const providerConfig: Configuration = {
  adapter: SqliteAdapter,
  clients: [],
  jwks: loadOrCreateJwks(),
  claims: {
    email: ["email", "email_verified"],
    profile: ["preferred_username"]
  },
  cookies: {
    keys: config.cookieKeys,
    long: { secure: true, httpOnly: true, sameSite: "lax" },
    short: { secure: true, httpOnly: true, sameSite: "lax" }
  },
  clientDefaults: {
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none"
  },
  features: {
    devInteractions: { enabled: false },
    alwaysIssueRefresh: { enabled: true },
    registration: { enabled: true, initialAccessToken: false },
    registrationManagement: { enabled: true },
    resourceIndicators: {
      enabled: true,
      async getResourceServerInfo(_ctx, resourceIndicator) {
        if (resourceIndicator !== config.resource) {
          throw new errors.InvalidTarget("Unknown resource");
        }
        return {
          scope: "remote:use",
          audience: config.resource,
          accessTokenTTL: 3600,
          accessTokenFormat: "jwt"
        };
      },
      async defaultResource(_ctx, _client, oneOf) {
        if (oneOf?.includes(config.resource)) return config.resource;
        return undefined;
      },
      async useGrantedResource() {
        return true;
      }
    }
  },
  interactions: {
    url(_ctx, interaction) {
      return `/interaction/${interaction.uid}`;
    }
  },
  pkce: {
    required() {
      return true;
    }
  },
  responseTypes: ["code"],
  scopes: ["openid", "email", "profile", "offline_access", "remote:use"],
  ttl: {
    AccessToken: 3600,
    AuthorizationCode: 600,
    Grant: 14 * 24 * 60 * 60,
    IdToken: 3600,
    Interaction: 15 * 60,
    RefreshToken: 7 * 24 * 60 * 60,
    Session: 7 * 24 * 60 * 60
  },
  findAccount: async (_ctx, id): Promise<Account | undefined> => {
    const user = findUser(id);
    if (!user) return undefined;
    return {
      accountId: user.id,
      async claims() {
        return {
          sub: user.id,
          email: user.email,
          email_verified: user.emailVerified,
          preferred_username: user.username
        };
      }
    };
  }
};

const provider = new Provider(config.issuer, providerConfig);
provider.proxy = true;
provider.on("server_error", (_ctx, error) => console.error("oidc server_error", error));
provider.on("authorization.error", (_ctx, error) => console.error("oidc authorization.error", error));

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
const formBody = express.urlencoded({ extended: false, limit: "32kb" });
const allowedHosts = new Set([
  new URL(config.issuer).hostname,
  "range-remote-auth",
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]"
]);
const dcrRateLimit = fixedWindowRateLimit(30, 60 * 60_000);
const registrationRateLimit = fixedWindowRateLimit(10, 60 * 60_000);
const loginRateLimit = fixedWindowRateLimit(20, 10 * 60_000);

app.use((req, res, next) => {
  const rawHost = req.headers.host ?? "";
  const host = rawHost.startsWith("[")
    ? rawHost.slice(0, rawHost.indexOf("]") + 1)
    : rawHost.split(":", 1)[0] ?? "";
  if (!allowedHosts.has(host.toLowerCase())) {
    res.status(403).send("Invalid host");
    return;
  }
  next();
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "range-remote-auth", version: "0.1.0" });
});

app.get("/", (_req, res) => {
  res.type("html").send(homePage(config.allowRegistration));
});

app.get("/auth/ui.js", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("application/javascript").send(interactionSubmitGuardScript);
});

app.use("/reg", dcrRateLimit);

app.get("/register", (req, res) => {
  if (!config.allowRegistration) {
    res.sendStatus(404);
    return;
  }
  const returnTo = safeReturnTo(req.query.returnTo);
  const csrf = issueCsrf(res);
  res.type("html").send(registerPage(returnTo, csrf));
});

app.post("/register", registrationRateLimit, formBody, (req, res) => {
  if (!config.allowRegistration) {
    res.sendStatus(404);
    return;
  }
  if (!validCsrf(req, String(req.body.csrf ?? ""))) {
    res.status(403).send("Invalid CSRF token");
    return;
  }

  const returnTo = safeReturnTo(req.body.returnTo);
  try {
    registerUser(
      String(req.body.username ?? ""),
      String(req.body.email ?? ""),
      String(req.body.password ?? "")
    );
    res.redirect(returnTo || "/");
  } catch (error) {
    const csrf = issueCsrf(res);
    res.status(400).type("html").send(registerPage(
      returnTo,
      csrf,
      error instanceof Error ? error.message : "Registration failed"
    ));
  }
});

app.get("/interaction/:uid", async (req, res, next) => {
  try {
    const details = await provider.interactionDetails(req, res);
    const client = await provider.Client.find(String(details.params.client_id));
    const clientName = String(client?.clientName ?? details.params.client_id ?? "OAuth client");
    const csrf = issueCsrf(res);

    if (details.prompt.name === "login") {
      res.type("html").send(loginPage(details.uid, csrf, clientName));
      return;
    }
    if (details.prompt.name === "consent") {
      const scopes = consentScopes(details.prompt.details as Record<string, unknown>);
      res.type("html").send(consentPage(details.uid, csrf, clientName, scopes));
      return;
    }
    res.status(501).send("Unsupported interaction");
  } catch (error) {
    next(error);
  }
});
app.post("/interaction/:uid/login", loginRateLimit, formBody, async (req, res, next) => {
  try {
    if (!validCsrf(req, String(req.body.csrf ?? ""))) {
      res.status(403).send("Invalid CSRF token");
      return;
    }
    const details = await provider.interactionDetails(req, res);
    if (details.prompt.name !== "login") {
      res.status(400).send("Login is not expected");
      return;
    }

    const user = verifyUser(
      String(req.body.login ?? ""),
      String(req.body.password ?? "")
    );
    if (!user) {
      const client = await provider.Client.find(String(details.params.client_id));
      const csrf = issueCsrf(res);
      res.status(401).type("html").send(loginPage(
        details.uid,
        csrf,
        String(client?.clientName ?? details.params.client_id ?? "OAuth client"),
        "Invalid username/email or password"
      ));
      return;
    }

    await provider.interactionFinished(req, res, {
      login: { accountId: user.id, amr: ["pwd"] }
    }, { mergeWithLastSubmission: false });
  } catch (error) {
    next(error);
  }
});

app.post("/interaction/:uid/consent", formBody, async (req, res, next) => {
  try {
    if (!validCsrf(req, String(req.body.csrf ?? ""))) {
      res.status(403).send("Invalid CSRF token");
      return;
    }
    const details = await provider.interactionDetails(req, res);
    if (details.prompt.name !== "consent") {
      res.status(400).send("Consent is not expected");
      return;
    }

    if (req.body.decision !== "allow") {
      await provider.interactionFinished(req, res, {
        error: "access_denied",
        error_description: "The user denied access"
      }, { mergeWithLastSubmission: false });
      return;
    }

    let grant = details.grantId
      ? await provider.Grant.find(details.grantId)
      : undefined;
    if (!grant) {
      grant = new provider.Grant({
        accountId: details.session?.accountId,
        clientId: String(details.params.client_id)
      });
    }

    const prompt = details.prompt.details as Record<string, unknown>;
    const missingOIDCScope = asStrings(prompt.missingOIDCScope);
    if (missingOIDCScope.length) grant.addOIDCScope(missingOIDCScope.join(" "));

    const missingOIDCClaims = asStrings(prompt.missingOIDCClaims);
    if (missingOIDCClaims.length) grant.addOIDCClaims(missingOIDCClaims);

    const missingResourceScopes = prompt.missingResourceScopes;
    if (isRecord(missingResourceScopes)) {
      for (const [resource, scopes] of Object.entries(missingResourceScopes)) {
        const values = asStrings(scopes);
        if (values.length) grant.addResourceScope(resource, values.join(" "));
      }
    }

    await provider.interactionFinished(req, res, {
      consent: { grantId: await grant.save() }
    }, { mergeWithLastSubmission: true });
  } catch (error) {
    next(error);
  }
});
app.use(provider.callback());

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  if (res.headersSent) return;
  const status =
    typeof error === "object" && error !== null &&
    ("status" in error || "statusCode" in error)
      ? Number(("status" in error ? error.status : error.statusCode) ?? 500)
      : 500;
  res.status(Number.isInteger(status) && status >= 400 && status < 600 ? status : 500)
    .send("Authorization server error");
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`Range Remote authorization server listening on :${config.port}`);
});

function issueCsrf(res: Response): string {
  const token = randomBytes(24).toString("base64url");
  res.cookie("rr_csrf", token, {
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    maxAge: 10 * 60_000,
    path: "/"
  });
  return token;
}

function validCsrf(req: Request, submitted: string): boolean {
  if (!submitted) return false;
  return cookie(req, "rr_csrf") === submitted;
}

function cookie(req: Request, name: string): string | null {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function safeReturnTo(value: unknown): string {
  const candidate = typeof value === "string" ? value : "";
  return candidate.startsWith("/interaction/") ? candidate : "";
}

function consentScopes(details: Record<string, unknown>): string[] {
  const result = new Set(asStrings(details.missingOIDCScope));
  if (isRecord(details.missingResourceScopes)) {
    for (const scopes of Object.values(details.missingResourceScopes)) {
      for (const scope of asStrings(scopes)) result.add(scope);
    }
  }
  return [...result];
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fixedWindowRateLimit(limit: number, windowMs: number) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.header("cf-connecting-ip") ?? req.ip ?? "unknown";
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      if (!current && buckets.size >= 4096) {
        for (const [bucketKey, bucket] of buckets) {
          if (bucket.resetAt <= now) buckets.delete(bucketKey);
        }
        while (buckets.size >= 4096) {
          const oldest = buckets.keys().next().value as string | undefined;
          if (oldest === undefined) break;
          buckets.delete(oldest);
        }
      }
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (current.count >= limit) {
      res.setHeader("Retry-After", String(Math.ceil((current.resetAt - now) / 1000)));
      res.status(429).send("Too many requests");
      return;
    }
    current.count += 1;
    next();
  };
}
