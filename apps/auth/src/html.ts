function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export const interactionSubmitGuardScript = `
(() => {
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.dataset.rrSubmitting === "1") {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    form.dataset.rrSubmitting = "1";
    form.setAttribute("aria-busy", "true");

    queueMicrotask(() => {
      for (const control of form.querySelectorAll('button[type="submit"],input[type="submit"]')) {
        control.setAttribute("aria-disabled", "true");
        control.style.pointerEvents = "none";
      }
    });
  }, true);
})();
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Range Remote</title>
<script src="/auth/ui.js" defer></script>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f6f7f9;color:#15171a;margin:0}
main{max-width:480px;margin:8vh auto;padding:24px}
.card{background:#fff;border:1px solid #e3e6ea;border-radius:18px;padding:28px;box-shadow:0 10px 30px #0000000a}
h1{font-size:24px;margin:0 0 8px}p{line-height:1.55;color:#555}
label{display:block;margin-top:16px;font-weight:600}
input{box-sizing:border-box;width:100%;margin-top:7px;padding:12px;border:1px solid #cbd0d6;border-radius:10px;font:inherit}
button,.button{display:inline-block;margin-top:20px;background:#15171a;color:#fff;border:0;border-radius:10px;padding:12px 16px;font:inherit;text-decoration:none;cursor:pointer}
.secondary{background:#eef0f2;color:#15171a;margin-left:8px}.error{color:#a40018}.scopes{padding-left:20px}
.small{font-size:14px}
</style>
</head><body><main><div class="card">${body}</div></main></body></html>`;
}

export function loginPage(uid: string, csrf: string, clientName: string, error?: string): string {
  return page("Sign in", `
<h1>Sign in to Range Remote</h1>
<p><strong>${esc(clientName)}</strong> is requesting access to your paired computers.</p>
${error ? `<p class="error">${esc(error)}</p>` : ""}
<form method="post" action="/interaction/${esc(uid)}/login">
<input type="hidden" name="csrf" value="${esc(csrf)}">
<label>Username or email<input name="login" autocomplete="username" required></label>
<label>Password<input type="password" name="password" autocomplete="current-password" required></label>
<button type="submit">Sign in</button>
</form>
<p class="small">Need an account? <a href="/register?returnTo=/interaction/${esc(uid)}">Create one</a>.</p>`);
}
export function consentPage(
  uid: string,
  csrf: string,
  clientName: string,
  scopes: string[]
): string {
  const items = scopes.map((scope) => `<li>${esc(scope)}</li>`).join("");
  return page("Authorize", `
<h1>Allow access?</h1>
<p><strong>${esc(clientName)}</strong> wants to use Range Remote on your behalf.</p>
<ul class="scopes">${items || "<li>Basic account access</li>"}</ul>
<form method="post" action="/interaction/${esc(uid)}/consent">
<input type="hidden" name="csrf" value="${esc(csrf)}">
<button type="submit" name="decision" value="allow">Allow</button>
<button class="secondary" type="submit" name="decision" value="deny">Deny</button>
</form>`);
}

export function registerPage(returnTo: string, csrf: string, error?: string): string {
  return page("Create account", `
<h1>Create Range Remote account</h1>
<p>This account controls which paired computers ChatGPT may access.</p>
${error ? `<p class="error">${esc(error)}</p>` : ""}
<form method="post" action="/register">
<input type="hidden" name="csrf" value="${esc(csrf)}">
<input type="hidden" name="returnTo" value="${esc(returnTo)}">
<label>Username<input name="username" autocomplete="username" required minlength="3" maxlength="40"></label>
<label>Email<input type="email" name="email" autocomplete="email" required></label>
<label>Password<input type="password" name="password" autocomplete="new-password" required minlength="8"></label>
<button type="submit">Create account</button>
</form>`);
}

export function homePage(registrationEnabled: boolean): string {
  return page("Authorization server", `
<h1>Range Remote Authorization</h1>
<p>OAuth 2.1 / OpenID Connect authorization service for Range Remote.</p>
<p class="small">Accounts are used only to authorize access to explicitly paired devices.</p>
${registrationEnabled ? '<a class="button" href="/register">Create account</a>' : ""}`);
}
