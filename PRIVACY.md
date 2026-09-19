# Range Remote Privacy Policy

Last updated: 2026-09-19

Range Remote connects an authenticated ChatGPT user to computers that the user has explicitly paired.

## Data processed

The relay processes:
- the identity subject supplied by the configured OAuth provider;
- paired device identifiers, user-chosen device names, and connection status;
- short-lived pairing codes;
- MCP tool arguments and the corresponding device responses while a request is being executed.

The relay does not need to store file contents or shell output after returning a tool response. The reference implementation does not persist those payloads.

## Credentials

Device bearer tokens are generated randomly and stored on the relay only as cryptographic hashes. OAuth access tokens are validated for each MCP request and are not written to the application database.

## Local data

Files, repositories, processes, and commands remain on the paired device unless a user invokes a tool that returns data to ChatGPT. The local agent blocks sensitive credential locations by default and restricts operations to locally configured roots.

## Retention

Pairing codes expire automatically. Device metadata remains until the user removes a device. The `remove_device` tool removes one device, and `remove_all_devices` removes all paired devices and outstanding pairing codes for the authenticated account. Operational logs avoid tool payloads and secrets and should be retained only as needed for security and reliability.

## Sharing

Range Remote does not sell user data. Data is sent only to infrastructure required to provide the service and to OpenAI when the user invokes the plugin through ChatGPT.

## User control

Users can stop the agent at any time to disconnect a device. Users can also remove one device or remove all device metadata and outstanding pairing codes through authenticated MCP tools.

## Contact

For privacy or support requests, use the repository issue tracker. Do not post secrets or security vulnerabilities in public issues; use GitHub Security Advisories for security reports.
