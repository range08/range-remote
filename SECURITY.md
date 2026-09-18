# Security Policy

## Threat model

Range Remote intentionally exposes powerful capabilities. The relay therefore treats all MCP input, agent traffic, filesystem paths, and shell commands as untrusted.

The security boundary is the local agent policy. The relay cannot grant access outside roots or capabilities configured locally on the device.

## Defaults

- No shell access unless `allowShell` is enabled on the device.
- Sensitive files and directories are blocked unless the user changes the agent config locally.
- No remote operation can change the local agent policy.
- Every device belongs to exactly one authenticated user subject.
- Pairing codes are short-lived and single-use.
- Device credentials are random bearer tokens stored hashed at rest.
- WebSocket device connections are bound to a device and user.
- Command runtime and output are bounded.
- File operations are bounded and text-only in v0.1.

## Reporting vulnerabilities

Do not publish security vulnerabilities as public issues. Contact the repository owner privately through GitHub security advisories.
