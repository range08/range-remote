# OpenAI Plugin Submission Checklist

Range Remote is intended for submission as a public remote-MCP plugin.

## Production endpoint

- MCP server: `https://remotemcp.range08.shop/mcp`
- OAuth/OIDC issuer and resource origin: `https://remotemcp.range08.shop`
- OIDC discovery: `https://remotemcp.range08.shop/.well-known/openid-configuration`
- Protected resource metadata: `https://remotemcp.range08.shop/.well-known/oauth-protected-resource`
- Registration endpoint: `https://remotemcp.range08.shop/reg`
- Privacy page exposed by the MCP service: `https://remotemcp.range08.shop/privacy`

The production deployment uses the dedicated `remotemcp.range08.shop` origin behind `range-remote-gateway`. Cloudflare Tunnel routes that hostname directly to the gateway; OAuth/OIDC paths are proxied to `range-remote-auth`, while MCP and agent paths are proxied to `range-remote`. The personal `range08.shop` homepage is separate and contains no Range Remote routes.

## Required before review

### Server and security

- [x] Stable public HTTPS MCP endpoint ending in `/mcp`.
- [x] OAuth 2.1 / OIDC authorization server deployed on the final public issuer hostname.
- [x] Authorization server is restricted to authorization-code flow; implicit response types are disabled.
- [x] PKCE S256 is mandatory for authorization requests.
- [x] Built-in authorization server implements OIDC discovery, DCR, authorization code + PKCE S256, RFC 9207 issuer identification, refresh tokens, persistent RS256 signing keys, and RFC 8707 resource indicators.
- [x] Automated OAuth E2E covers discovery policy, DCR, PKCE-required rejection, invalid-resource rejection, login, consent, code exchange, refresh-token exchange, resource-bound JWT issuance, MCP initialize, tools/list, OpenAI profile metadata/output schema, tool security schemes, and annotations.
- [x] Protected resource metadata exists at `/.well-known/oauth-protected-resource`.
- [x] OAuth tokens are checked for signature, issuer, audience, expiry, and required scopes.
- [x] Domain challenge route exists at `/.well-known/openai-apps-challenge`.
- [x] Public privacy, terms, security, and support documents exist.
- [x] Device removal and all-device deletion are implemented.
- [x] Production gateway, relay, and authorization containers run as non-root users.
- [x] Production services are healthy and reachable through the existing Cloudflare-backed public origin.

### OpenAI account and review access

- [ ] Publisher identity is verified in the OpenAI Platform organization that will own the submission.
- [ ] Submitter has `api.apps.read` and `api.apps.write` permission, or is an organization owner.
- [ ] Reviewer account is created and works without MFA, email verification, SMS verification, or private-network access.
- [ ] Dedicated review device is paired to the reviewer account and remains online during review.
- [ ] Domain ownership challenge token supplied by the submission portal is installed and verified.
- [x] Workspace email-domain restriction is intentionally not claimed because the authorization service does not assert `email_verified: true`.

### Listing material

- [ ] Final listing logo is prepared.
- [x] Name is selected: **Range Remote**.
- [x] Category is selected: **Developer tools**.
- [x] Short description draft is prepared.
- [x] Long description draft is prepared.
- [x] Website, support, privacy, and terms URLs are prepared.
- [x] Five positive review cases and three negative review cases are prepared.
- [x] Starter prompt draft is prepared.
- [x] Initial release notes draft is prepared.
- [ ] Availability countries/regions are selected in the submission portal.
- [x] No UI screenshots are required because the plugin does not expose an Apps SDK UI component.

## Positive review tests

1. List paired devices and confirm the dedicated review device is online.
2. List the files in the review workspace.
3. Read `README.md` from the review workspace.
4. Run the dedicated read-only `git_status` tool in the review repository.
5. Create a harmless new text file in the review workspace with `write_file`.

## Negative review tests

1. Attempt to read `.env`; the local agent must refuse the sensitive credential path.
2. Attempt to read a path outside the configured root; the local agent must refuse it.
3. Invoke `run_command` on a device where shell access is disabled; the local agent must refuse it.

## Tool annotation rationale

- `profile`, `list_devices`, `system_info`, `list_directory`, `read_file`, `git_status`, `git_diff`: read-only, non-destructive, closed-world.
- `create_pairing_code`: state-changing, non-destructive, closed-world.
- `remove_device`, `remove_all_devices`: destructive account/device state changes, closed-world.
- `write_file`: state-changing and potentially destructive when overwriting, closed-world.
- `run_command`: state-changing, potentially destructive, open-world, and available only after local shell opt-in.

## Listing draft

**Name**

Range Remote

**Short description**

Securely connect ChatGPT to computers you explicitly pair for file, Git, and optional shell workflows.

**Long description**

Range Remote connects ChatGPT to computers and servers through an outbound-only local agent. After a device is explicitly paired, ChatGPT can inspect allowed filesystem roots, read and write files, inspect Git state, and optionally run shell commands when shell access has been enabled locally. The agent enforces allowed-root and sensitive-file policies before filesystem operations, while the public MCP service uses OAuth authorization-code flow with PKCE and resource-bound access tokens. Shell access is disabled by default.

**Category**

Developer tools

**Website**

https://github.com/range08/range-remote

**Support**

https://github.com/range08/range-remote/issues

**Privacy**

https://github.com/range08/range-remote/blob/main/PRIVACY.md

**Terms**

https://github.com/range08/range-remote/blob/main/TERMS.md

## Starter prompt draft

- List my paired devices and tell me which are online.
- Show the files in my review workspace.
- Read `README.md` from my paired review device.
- Show the Git status of the review repository.
- Create `range-remote-review.txt` in the review workspace containing a short test message.

## Initial release notes draft

Initial public submission of Range Remote. Includes outbound-only device pairing, restricted filesystem access, file read/write tools, Git inspection, optional locally enabled shell execution, OAuth authorization-code flow with mandatory PKCE S256, resource-bound JWT access tokens, persistent signing keys, and automated OAuth-to-MCP end-to-end validation.

## Human-only steps remaining

The server and repository can be prepared automatically, but the following require the publisher's OpenAI account or an intentional publisher choice:

1. Complete publisher identity verification in the OpenAI Platform organization used for submission.
2. Confirm `api.apps.read` and `api.apps.write` permissions.
3. Select availability countries/regions.
4. Supply the final listing logo.
5. Temporarily set `AUTH_ALLOW_REGISTRATION=true`, create the reviewer account, then restore it to `false`.
6. Pair a dedicated review device to the reviewer account.
7. Enter the domain challenge value supplied by the submission portal.
8. Submit the completed draft through the plugin submission portal.
