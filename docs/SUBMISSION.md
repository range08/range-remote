# OpenAI Plugin Submission Checklist

This file tracks work needed before submitting Range Remote as a public MCP-backed plugin.

## Required before review

- [ ] Stable public HTTPS MCP endpoint ending in `/mcp`.
- [ ] OAuth 2.1 provider configured for production.
- [ ] Protected resource metadata at `/.well-known/oauth-protected-resource`.
- [ ] Production OAuth issuer metadata supports PKCE S256 and an OpenAI-supported client registration method.
- [ ] OAuth audience/resource is bound to the MCP server.
- [ ] Every MCP request validates signature, issuer, audience, expiration, and required scopes.
- [ ] Public privacy policy URL.
- [ ] Public support contact.
- [ ] Domain ownership challenge endpoint can be configured at `/.well-known/openai-apps-challenge`.
- [ ] Demo reviewer account with no MFA requirement.
- [ ] Demo device stays online throughout review.
- [ ] Test prompts and exact expected outcomes prepared.
- [ ] Tool annotations reviewed against actual behavior.
- [ ] No secrets, internal trace IDs, OAuth tokens, or unnecessary PII in tool outputs.
- [ ] Publisher identity verified in the OpenAI Platform organization.
- [ ] `api.apps.write` permission available to submit.

## Proposed review tests

1. List the connected devices.
2. Read `README.md` from the demo workspace.
3. List files in the demo workspace.
4. Run `git status --short` using the dedicated read-only Git tool.
5. Create a new text file in the demo workspace.
6. Attempt to read `.env` and verify that the agent refuses.
7. Attempt a path traversal outside the allowed root and verify refusal.
8. Invoke shell on a device configured with shell disabled and verify refusal.
9. On the dedicated review device, run a harmless shell command such as `pwd`.

## Tool annotation rationale

- `profile`: read-only, non-destructive, closed-world.
- `list_devices`: read-only, non-destructive, closed-world.
- `create_pairing_code`: state-changing but non-destructive, closed-world.
- `list_directory`: read-only, non-destructive, closed-world.
- `read_file`: read-only, non-destructive, closed-world.
- `git_status`: read-only, non-destructive, closed-world.
- `git_diff`: read-only, non-destructive, closed-world.
- `write_file`: state-changing and potentially destructive when overwriting, closed-world.
- `run_command`: state-changing, potentially destructive, and open-world because a command can access network destinations when the local policy permits it.
