# Range Remote

Range Remote is an open-source remote MCP service designed for ChatGPT plugins. It lets a user connect a computer or server through an outbound-only agent and then use narrowly described MCP tools for filesystem inspection, file editing, Git inspection, and optional shell execution.

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
      +-- allowed filesystem roots
      +-- optional shell
```

The relay never needs inbound access to the user's device. The agent opens the connection outward and enforces local policy before every operation.

## Security defaults

- Filesystem tools are restricted to explicitly configured filesystem roots.
- Sensitive files such as `.env`, SSH keys, cloud credentials, and private keys are denied by default.
- Shell execution is disabled unless the user explicitly enables it locally. When enabled, shell commands run with the operating-system permissions of the agent process; allowed roots constrain the working directory, not every path a shell command may access. Run the agent as a dedicated low-privilege OS user for shell-enabled deployments.
- File reads/writes and command output have size limits.
- Path checks resolve symlinks to prevent escaping allowed roots.
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

Copy `.env.example` to `.env`, set two cookie-signing keys, then start the authorization server and relay in separate terminals:

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

The MCP endpoint is `/mcp`. The tested production layout uses two stable HTTPS origins: one for the MCP relay (for example `https://remote.example.com`) and one for the authorization issuer (for example `https://auth.example.com`). A single-origin deployment is also possible behind a path-aware reverse proxy, but only when every OAuth discovery, registration, authorization, token, JWKS, interaction, and MCP route is mapped to the correct backend and the configured issuer/resource origins remain consistent. `docker-compose.yml` runs both services as non-root containers with separate persistent volumes and attaches them to the external `cloudflare` network. For ChatGPT publication, verify the MCP domain, prepare review credentials, and keep a review device online.

See `docs/SUBMISSION.md`.

## Support

Use the GitHub issue tracker for non-sensitive support requests. Report security vulnerabilities privately through GitHub Security Advisories.

- Privacy: `PRIVACY.md`
- Terms: `TERMS.md`
- Security: `SECURITY.md`
