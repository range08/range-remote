# Range Remote Privacy Policy

Last updated: 2026-09-19

Range Remote connects an authenticated ChatGPT user to computers that the user has explicitly paired.

## Data processed

The authorization service stores:
- a user-selected username and email address;
- a randomly salted scrypt password hash; plaintext passwords are not stored;
- OAuth/OpenID Connect client, session, grant, authorization, and token metadata needed to authenticate connections;
- an RS256 signing key used to issue OAuth tokens.

The relay stores:
- the authenticated account subject identifier;
- paired device identifiers, user-selected device names, and connection status;
- short-lived pairing codes and hashed device bearer tokens.

While a tool runs, the relay processes the tool arguments and the corresponding device response. The reference implementation does not persist file contents, command output, or ordinary tool response payloads after returning the response to ChatGPT.

## Credentials and tokens

Device bearer tokens are generated randomly. The relay stores only their SHA-256 hashes.

OAuth bearer tokens presented to the MCP relay are verified on each request for signature, issuer, audience, expiration, and required scopes. The relay does not persist the presented bearer token in its application database. The authorization service stores the protocol artifacts required by the OAuth/OpenID Connect implementation and keeps its signing private key in its persistent data volume.

## Local device data

Files, repositories, processes, and commands remain on the paired device unless a user invokes a tool that returns data to ChatGPT. The local agent blocks common credential locations by default and restricts filesystem tools to explicitly configured roots. Optional shell execution must be enabled locally and runs with the operating-system permissions of the agent process.

## Retention

The reference implementation uses these maximum lifetimes for authorization artifacts:
- authorization interactions: 15 minutes;
- authorization codes: 10 minutes;
- access and ID tokens: 1 hour;
- sessions and refresh tokens: 7 days;
- grants: 14 days.

Pairing codes expire automatically after 10 minutes. Device metadata remains until the user removes the device. The `remove_device` tool removes one device, and `remove_all_devices` removes all paired devices and outstanding pairing codes for the authenticated account.

Authentication account records and dynamically registered OAuth client records remain until they are removed as part of account or service administration. Operational logs should avoid tool payloads and secrets and should be retained only as needed for security and reliability.

## Sharing

Range Remote does not sell user data. Data is sent only to infrastructure required to operate the service and to OpenAI when the user invokes the plugin through ChatGPT.

## User control

Users can stop the local agent at any time to disconnect a device. Users can remove one or all paired devices through authenticated MCP tools. Users seeking deletion of authentication-account data should use the support channel without posting passwords, tokens, private keys, or private file contents.

## Email verification

The reference implementation records email addresses but does not currently verify ownership of those addresses. It therefore does not claim support for ChatGPT workspace email-domain restrictions that require an `email_verified: true` UserInfo claim.

## Contact

For non-sensitive support or privacy coordination, use the repository issue tracker without including private data. Report security vulnerabilities privately through GitHub Security Advisories.
