# Security Policy

## Threat model

Range Remote intentionally exposes powerful capabilities. The relay therefore treats all MCP input, agent traffic, filesystem paths, and shell commands as untrusted.

Device-side permissions are selected locally. Restricted mode provides application-level guardrails for filesystem roots, sensitive paths, and shell access. Unrestricted mode intentionally removes those guardrails and grants remote tools the permissions of the OS account running the agent. Neither mode weakens relay authentication, device ownership checks, or OCI isolation.

## Defaults

- Restricted mode requires `allowShell` for shell access and blocks common sensitive paths by default. `git_diff` is disabled unless sensitive-file access is explicitly enabled locally, because tracked diffs can contain credential contents; restricted Git status/diff requests are scoped to the requested working subtree.
- `unrestricted` can only be enabled in local agent configuration or during local pairing. It bypasses allowed-root and sensitive-file checks, enables shell execution, and preserves the agent process environment for child commands.
- In unrestricted mode, the effective security boundary is the operating-system account that runs the agent; UAC/sudo and filesystem ACLs still apply.
- No remote operation can change the local agent policy.
- Every device belongs to exactly one authenticated user subject.
- Pairing codes are short-lived and single-use.
- Device credentials are random bearer tokens stored hashed at rest.
- WebSocket device connections are bound to a device and user.
- Command runtime and output are bounded.
- File operations are bounded and text-only in v0.1.
- OAuth authorization uses authorization code + PKCE S256, RFC 8707 resource indicators, short-lived JWT access tokens, persistent signing keys, and exact issuer/audience/scope validation at the MCP relay.
- The built-in authorization service stores password verifiers using randomly salted scrypt hashes and never stores plaintext passwords.
- OAuth signing keys and SQLite databases live in non-public persistent volumes; `.env`, runtime data, and generated keys are excluded from Git and Docker build contexts.
- The public Cloudflare network terminates at the gateway. Auth and relay containers use an internal-only Docker network with no published host ports and no direct Internet egress.
- Auth signing/cookie secrets are injected only into the authorization container; the relay receives no cookie-signing secret.
- Production containers run non-root with read-only root filesystems, all Linux capabilities dropped, `no-new-privileges`, and bounded CPU, memory, and PID resources.
- Agent WebSockets use bounded payloads, heartbeat liveness checks, connection caps, and global/per-device pending-call caps.
- Authenticated device operations have per-account rate and concurrency caps. These protect relay availability; they do not reduce the permissions granted by the local agent policy.
- Pairing storage keeps only the newest outstanding code per account and caps persistent device records per account.

## Reporting vulnerabilities

Do not publish security vulnerabilities as public issues. Contact the repository owner privately through GitHub security advisories.
