# PinSharing MCP

PinSharing (https://pinsharing.com) is a map API built on OpenStreetMap data, with a free plan and flat paid plans. It provides static map images, including a privacy-area mode, geocoding, and tiles. This repository provides a small stdio-to-HTTP bridge for MCP clients that can only launch local servers.

MCP Registry: `com.pinsharing/maps`

## Most clients: use the hosted server directly

The hosted MCP server is available at:

`https://api.pinsharing.com/v1/mcp`

See https://pinsharing.com/docs/mcp for setup. With Claude Code:

```bash
claude mcp add --transport http pinsharing https://api.pinsharing.com/v1/mcp --header "Authorization: Bearer YOUR_KEY"
```

## Clients that only run local servers (stdio)

Some clients, such as Claude Desktop with `claude_desktop_config.json`, can only launch local stdio MCP servers. For those, use this bridge.

```json
{
  "mcpServers": {
    "pinsharing": {
      "command": "npx",
      "args": ["-y", "github:Software-Consulting/pinsharing-mcp"],
      "env": { "PINSHARING_API_KEY": "ps_your_key" }
    }
  }
}
```

Git and Node.js 18+ are required. An npm package (`@pinsharing/mcp`) is coming.

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
| `PINSHARING_API_KEY` | Recommended | none | PinSharing API key (`ps_...`). Without it, discovery works and tool calls return the server's `missing_key` error. |
| `PINSHARING_MCP_URL` | No | `https://api.pinsharing.com/v1/mcp` | Hosted MCP server URL. Must be `https:` unless the host is `localhost` or `127.0.0.1`. |
| `PINSHARING_MCP_TIMEOUT_MS` | No | `60000` | HTTP timeout in milliseconds. |
| `PINSHARING_MCP_DEBUG` | No | unset | Set to `1` to write debug logs to stderr. |

## How it works

The bridge reads JSON-RPC messages from stdin, one per line, and forwards each one to the hosted MCP server over HTTPS. Responses are written to stdout, one JSON object per line. Nothing is stored locally. The API key is only sent to `api.pinsharing.com` in the `Authorization` header, and never printed in logs or errors.

## Plans and caps

PinSharing has hard monthly caps and no overage billing. A free plan is available without a card:

- Pricing and caps: https://pinsharing.com/pricing
- Free keys / dashboard: https://pinsharing.com/dashboard

## Attribution

Map data © OpenStreetMap contributors. Show attribution wherever map results or images appear.

## Development

```bash
npm test
```

The project has zero runtime or development dependencies.

## License

MIT. PinSharing is a service of Wells Software Consulting LLC.
