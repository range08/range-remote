# Security Policy

## Threat model

Range Remote intentionally exposes powerful capabilities. The relay therefore treats all MCP input, agent traffic, filesystem paths, and shell commands as untrusted.

The primary device-side security boundary is the local agent policy. Filesystem tools cannot access paths outside configured roots. Optional shell execution is a separate capability: its working directory must be within an allowed root, but the shell itself inherits the operating-system permissions of the agent process.

## Defaults

- No shell access unless `allowShell` is enabled on the device. Filesystem roots do not sandbox an enabled shell; shell commands inherit the OS permissions of the agent process. Use a dedicated low-privilege account or OS/container sandbox when enabling shell execution.
- Sensitive files and directories are blocked unless the user changes the agent config locally.
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

## Reporting vulnerabilities

Do not publish security vulnerabilities as public issues. Contact the repository owner privately through GitHub security advisories.
