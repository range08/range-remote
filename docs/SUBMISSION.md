# OpenAI Plugin Submission Checklist

Range Remote is intended for submission as a public remote-MCP plugin.

## Required before review

- [ ] Stable public HTTPS MCP endpoint ending in `/mcp`.
- [ ] OAuth 2.1 authorization server deployed on the final public issuer hostname.
- [x] Built-in authorization server implements OIDC discovery, DCR, authorization code + PKCE S256, RFC 9207 issuer identification, refresh tokens, persistent RS256 signing keys, and RFC 8707 resource indicators.
- [x] Automated OAuth E2E covers DCR, PKCE-required rejection, invalid-resource rejection, login, consent, code exchange, resource-bound JWT issuance, MCP initialize, tools/list, tool security schemes, and annotations.
- [x] OAuth discovery advertises `authorization_response_iss_parameter_supported: true`, public-client `none`, DCR, and S256.
- [x] Protected resource metadata at `/.well-known/oauth-protected-resource`.
- [x] OAuth tokens are checked for signature, issuer, audience, expiry, and required scopes.
- [x] Domain challenge route exists at `/.well-known/openai-apps-challenge`.
- [x] Public privacy, terms, security, and support documents exist in the repository.
- [x] Device removal and all-device deletion are implemented.
- [ ] Publisher identity is verified in the OpenAI Platform organization.
- [ ] App management write permission is available.
- [ ] Reviewer account works without MFA, email verification, SMS verification, or private-network access.
- [x] Workspace email-domain restriction is intentionally not claimed because the reference auth service does not yet assert `email_verified: true`.
- [ ] Dedicated review device remains online during review.
- [ ] Domain ownership challenge token is installed during submission.
- [ ] Listing logo and final public website/support URLs are supplied.

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

- Name: Range Remote
- Short description: Securely connect ChatGPT to computers you explicitly pair for file, Git, and optional shell workflows.
- Category: Developer tools
- Website: https://github.com/range08/range-remote
- Support: https://github.com/range08/range-remote/issues
- Privacy: https://github.com/range08/range-remote/blob/main/PRIVACY.md
- Terms: https://github.com/range08/range-remote/blob/main/TERMS.md
