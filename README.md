# Range Remote

Range Remote is an open-source remote MCP service designed for ChatGPT plugins. It lets a user connect a computer or server through an outbound-only agent and then use narrowly described MCP tools for filesystem inspection, file editing, Git inspection, and shell execution under a locally selected restricted or unrestricted mode.

## Architecture

```text
ChatGPT / Codex
      |
      | OAuth 2.1 / OIDC
      v
Range Remote auth
      |
      | JWT bearer token
      v
Range Remote relay (MCP over HTTPS)
      |
      | authenticated WebSocket
      v
Range Remote agent
      |
      +-- restricted mode: allowed roots / sensitive-file policy / optional shell
      +-- unrestricted mode: full permissions of the local OS user
```

The relay never needs inbound access to the user's device. The agent opens the connection outward. Local access policy is chosen on the device and cannot be changed remotely.

## Local access modes

Restricted mode remains the default for new pairings. It limits filesystem operations to explicit roots, blocks common credential paths by default, and requires a separate shell opt-in.

For a trusted personal device, `--unrestricted` deliberately removes those application-level permission barriers. Filesystem and Git operations may reach any path the agent OS user can access, sensitive-file filtering is disabled, shell execution is enabled, and child processes inherit the agent's full environment. Operating-system permissions and UAC/sudo still apply. Relay-side authentication, device ownership checks, rate limits, and OCI isolation are unchanged.

```bash
npm run dev:agent -- pair \
  --server https://remotemcp.range08.shop \
  --code ABCDEF-GHJKLM \
  --name my-pc \
  --unrestricted
```

## Security defaults

- Restricted mode confines filesystem tools to explicitly configured roots; unrestricted mode intentionally removes this application-level boundary.
- Restricted mode denies common sensitive credential paths by default; unrestricted mode intentionally permits them subject to OS permissions.
- Restricted mode disables shell execution unless enabled locally. Unrestricted mode enables shell automatically and passes through the agent process environment. In either mode, shell commands run with the operating-system permissions of the agent process.
- File reads/writes and command output have size limits.
- Restricted path checks resolve symlinks before enforcing allowed roots.
- Device tokens are generated once and stored only as SHA-256 hashes on the relay.
- MCP access requires OAuth 2.1 bearer tokens.
- Tools advertise `readOnlyHint`, `destructiveHint`, and `openWorldHint` to ChatGPT.

## Repository layout

- `apps/server`: public HTTPS MCP relay and device WebSocket gateway.
- `apps/auth`: OAuth 2.1 / OpenID Connect authorization server with DCR, PKCE S256, RFC 8707 resource indicators, SQLite persistence, and persistent signing keys.
- `apps/agent`: local/remote device agent.
- `packages/shared`: RPC schemas shared by relay and agent.
- `docs/SUBMISSION.md`: OpenAI plugin submission checklist.
- `PRIVACY.md`: privacy policy draft for publication.

## Local development

Requirements: Node.js 24.15+.

```bash
npm install
npm run build
npm test
```

Copy `.env.example` to `.env`, set two cookie-signing keys, and set `AUTH_ALLOW_REGISTRATION=true` only while creating an account. Registration is disabled by default. Then start the authorization server and relay in separate terminals:

```bash
npm --workspace @range-remote/auth run dev
npm run dev:server
```

The built-in authorization server supports dynamic client registration, authorization code + PKCE S256, refresh tokens through `offline_access`, and resource-bound JWT access tokens.

Pair an agent:

```bash
npm run dev:agent -- pair \
  --server http://127.0.0.1:8787 \
  --code ABCD-EFGH \
  --name my-device \
  --root "$HOME/projects"
```

Shell access requires an explicit local opt-in:

```bash
npm run dev:agent -- pair \
  --server http://127.0.0.1:8787 \
  --code ABCD-EFGH \
  --name my-device \
  --root "$HOME/projects" \
  --allow-shell
```

Then keep the agent connected:

```bash
npm run dev:agent -- start
```

## Production

The production MCP endpoint is `https://remotemcp.range08.shop/mcp`. Range Remote uses its own dedicated `range-remote-gateway` on the `remotemcp.range08.shop` origin; it is not routed through or combined with the personal `range08.shop` homepage. Cloudflare Tunnel reaches only the gateway. The authorization server and MCP relay live on a separate internal-only Docker network and have no published host ports or direct Internet egress.

Production containers run as non-root with read-only root filesystems, dropped Linux capabilities, `no-new-privileges`, and CPU, memory, and PID limits. Only the authorization container receives cookie-signing secrets; the MCP relay receives the internal JWKS URL and public authorization metadata instead. The relay also bounds WebSocket payloads, connected agents, pending device calls, per-device concurrency, and per-user request concurrency/rate so an authenticated user cannot consume unbounded OCI resources.

The authorization server advertises authorization-code flow only, requires PKCE S256, supports refresh tokens, and binds access tokens to the dedicated Range Remote origin.

See `docs/SUBMISSION.md`.

## Support

Use the GitHub issue tracker for non-sensitive support requests. Report security vulnerabilities privately through GitHub Security Advisories.

- Privacy: `PRIVACY.md`
- Terms: `TERMS.md`
- Security: `SECURITY.md`
