# Changelog

## Unreleased (repository only, no code change)

- `server.json` in the repository root, matching the MCP Registry entry `com.mapiron/maps`; CI checks it against `package.json`.
- Fuller `SECURITY.md` (scope, supported versions, response time).
- CI actions pinned to commit SHAs, `npm ci` with a lockfile, Dependabot for actions and npm.
- Git tags `v1.0.0` and `v1.1.0` and GitHub releases for both.

## 1.1.0 — 2026-11-09

- Renamed from PinSharing to MapIron: repository `mapiron-mcp`, command `mapiron-mcp`, registry name `com.mapiron/maps`.
- Default server is now `https://api.mapiron.com/v1/mcp`.
- New `MAPIRON_*` environment variables. The `PINSHARING_*` names are still read; `MAPIRON_*` wins when both are set.

## 1.0.0 — 2026-11-05

- First release.
