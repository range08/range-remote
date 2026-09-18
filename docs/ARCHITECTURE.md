# Architecture

## Relay

The relay is a multi-tenant resource server.

1. ChatGPT authenticates the user using OAuth 2.1.
2. The relay validates issuer, audience, expiry, and scope.
3. An MCP tool call resolves only devices owned by that authenticated subject.
4. The relay sends an RPC message to an already-authenticated outbound WebSocket.
5. The agent applies its local policy and executes the operation.
6. The relay returns only the agent result needed for the tool response.

## Pairing

`create_pairing_code` creates a short-lived, single-use code associated with the authenticated subject. The user enters it locally into the agent. The agent exchanges the code for a random device token and stores the token locally.

The relay stores only a SHA-256 hash of the device token.

## Agent policy

The agent is the final authorization boundary for machine access.

- Allowed roots are configured locally.
- Policy changes are local-only.
- Existing paths are checked using real paths.
- New files are validated through the real path of their parent directory.
- Sensitive credential paths are denied by default.
- Shell access is an explicit local opt-in.
