# MapIron MCP

MapIron (https://mapiron.com) is a map API built on OpenStreetMap data, with a free plan and flat paid plans. It provides static map images, including a privacy-area mode, geocoding, and tiles. This repository provides a small stdio-to-HTTP bridge for MCP clients that can only launch local servers.

MCP Registry: `com.mapiron/maps`

MapIron was called PinSharing until November 2026. Old configs keep working: see [Upgrading from PinSharing](#upgrading-from-pinsharing).

## Most clients: use the hosted server directly

The hosted MCP server is available at:

`https://api.mapiron.com/v1/mcp`

See https://mapiron.com/docs/mcp for setup. With Claude Code:

```bash
claude mcp add --transport http mapiron https://api.mapiron.com/v1/mcp --header "Authorization: Bearer YOUR_KEY"
```

## Clients that only run local servers (stdio)

Some clients, such as Claude Desktop with `claude_desktop_config.json`, can only launch local stdio MCP servers. For those, use this bridge.

```json
{
  "mcpServers": {
    "mapiron": {
      "command": "npx",
      "args": ["-y", "github:Software-Consulting/mapiron-mcp"],
      "env": { "MAPIRON_API_KEY": "ps_your_key" }
    }
  }
}
```

Git and Node.js 18+ are required.

## Tools

| Tool | What it does | What it counts |
| --- | --- | --- |
| `geocode` | Convert addresses or place names to coordinates | 1 geocode |
| `reverse_geocode` | Convert coordinates to an address or place | 1 geocode |
| `static_map` | Render a map image with markers or a route | 1 static image |
| `privacy_area_map` | Show roughly where a place is (a shaded area, no pin); never reveals the exact point | 1 static image |
| `map_setup` | Code and URLs for an interactive map (MapLibre GL JS, Leaflet, OpenLayers) | free |

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `MAPIRON_API_KEY` | Recommended | none | MapIron API key (`ps_...`). Without it, discovery works and tool calls return the server's `missing_key` error. |
| `MAPIRON_MCP_URL` | No | `https://api.mapiron.com/v1/mcp` | Hosted MCP server URL. Must be `https:` unless the host is `localhost` or `127.0.0.1`. |
| `MAPIRON_MCP_TIMEOUT_MS` | No | `60000` | HTTP timeout in milliseconds. |
| `MAPIRON_MCP_DEBUG` | No | unset | Set to `1` to write debug logs to stderr. |

## Upgrading from PinSharing

Nothing breaks if you change nothing:

- `github:Software-Consulting/pinsharing-mcp` redirects to this repository.
- `PINSHARING_API_KEY`, `PINSHARING_MCP_URL`, `PINSHARING_MCP_TIMEOUT_MS` and `PINSHARING_MCP_DEBUG` are still read. If both names are set, the `MAPIRON_` one wins.
- Existing `ps_` keys work unchanged, and `https://api.pinsharing.com/v1/mcp` still serves the same tools.

To move to the new names, change the repository in `args` to `github:Software-Consulting/mapiron-mcp` and rename the variable to `MAPIRON_API_KEY`.

## How it works

The bridge reads JSON-RPC messages from stdin, one per line, and forwards each one to the hosted MCP server over HTTPS. Responses are written to stdout, one JSON object per line. Nothing is stored locally. The API key is only sent to the configured server (by default `api.mapiron.com`) in the `Authorization` header, and never printed in logs or errors.

## Plans and caps

MapIron has hard monthly caps and no overage billing. A free plan is available without a card:

- Pricing and caps: https://mapiron.com/pricing
- Free keys / dashboard: https://mapiron.com/dashboard

## Attribution

Map data © OpenStreetMap contributors. Show attribution wherever map results or images appear.

## Development

```bash
npm test
```

The project has zero runtime or development dependencies.

## License

MIT. MapIron is a service of Wells Software Consulting LLC.
