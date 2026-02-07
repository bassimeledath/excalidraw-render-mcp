# excalidraw-mcp

MCP server that renders hand-drawn Excalidraw diagrams as PNG files. Designed for **Claude Code CLI** and other MCP clients that don't have a browser surface.

Uses headless Chromium (via [agent-browser](https://github.com/nicepkg/agent-browser)) to render diagrams server-side. First render takes ~3s (browser launch + CDN import), subsequent renders ~60ms.

## Install

### One command (npm)

```bash
# Claude Code
claude mcp add --scope user --transport stdio excalidraw -- npx -y excalidraw-mcp

# Or with any MCP client
npx -y excalidraw-mcp
```

### From source

```bash
git clone https://github.com/bassimeledath/excalidraw-mcp-app.git
cd excalidraw-mcp-app
npm install
npm run build

# Add to Claude Code
claude mcp add --scope user --transport stdio excalidraw -- node /absolute/path/to/excalidraw-mcp-app/dist/index.js
```

### Claude Desktop / other clients

Add to your MCP config:

```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "npx",
      "args": ["-y", "excalidraw-mcp"]
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `excalidraw_read_me` | Returns the Excalidraw element format reference (color palettes, element types, examples). Call once before drawing. |
| `create_excalidraw_diagram` | Renders an Excalidraw element JSON array to a PNG file. Returns the file path. |

## Usage

After installing, ask Claude to draw:

- "Draw an architecture diagram showing a FastAPI server connected to Redis and Gemini"
- "Create an Excalidraw diagram of the git branching model"
- "Sketch a flowchart for user authentication"

Claude will call `excalidraw_read_me` to learn the element format, then `create_excalidraw_diagram` with the element JSON. The PNG is saved to disk and the path is returned.

### `create_excalidraw_diagram` parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `elements` | string | yes | JSON array of Excalidraw elements (see format reference from `excalidraw_read_me`) |
| `outputPath` | string | no | Absolute path for the output PNG. Defaults to a temp file. |

## How it works

1. A headless Chromium browser is launched as a singleton
2. The browser navigates to [esm.sh](https://esm.sh) and dynamically imports `@excalidraw/excalidraw`
3. Elements are converted via `convertToExcalidrawElements()` and rendered to SVG via `exportToSvg()`
4. Playwright takes an element-level screenshot of the SVG, producing a PNG
5. The browser stays alive for subsequent renders (~60ms each)

## Requirements

- Node.js 18+
- Chromium is installed automatically via `agent-browser install` (runs as a postinstall hook)

## Credits

Fork of [excalidraw-mcp-app](https://github.com/antonpk1/excalidraw-mcp-app) by Anton Pk, adapted for headless CLI usage.

Built with [Excalidraw](https://github.com/excalidraw/excalidraw).

## License

MIT
