# Security policy

## Reporting a vulnerability

Email **security@mapiron.com** with the subject `Security`. Please do not open a public issue for a vulnerability.

You can also use GitHub's private vulnerability reporting on this repository (Security → Report a vulnerability).

We reply within 3 business days. MapIron's full disclosure policy, including good-faith safe harbour, is at https://mapiron.com/security, and `https://mapiron.com/.well-known/security.txt` lists the same contact.

## Scope

- This repository: the stdio-to-HTTP bridge (`mapiron-mcp`).
- The hosted MCP server at `https://api.mapiron.com/v1/mcp` and the MapIron API.

## Supported versions

| Version | Supported |
|---|---|
| 1.1.x | Yes |
| 1.0.x | No (upgrade to 1.1) |

## How the bridge handles your key

- The bridge has no runtime dependencies; it uses only Node.js built-in modules.
- Your API key is read from the `MAPIRON_API_KEY` environment variable (or the older `PINSHARING_API_KEY`) and is sent only to the configured MCP server, as an `Authorization: Bearer` header. The bridge refuses any server URL that is not `https:`, except `localhost` and `127.0.0.1` for local testing.
- The bridge never writes the key to disk, and it removes anything that looks like a key (`ps_…`) from its error and debug messages.
