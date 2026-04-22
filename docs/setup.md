# Synapse Setup Guide

## Prerequisites

- [Bun](https://bun.sh) >= 1.2

## Installation

```bash
git clone https://github.com/anthropics/synapse.git
cd synapse
bun install
bun link
```

This makes the `synapse` command available globally.

## First Sync

```bash
synapse sync
```

This scans `~/.claude/projects/` for JSONL session files and indexes them into `~/.synapse/synapse.db`.

## MCP Client Configuration

### Stdio (default — single client)

#### Claude Code

Add to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "synapse": {
      "command": "bunx",
      "args": ["synapse", "serve", "--stdio"]
    }
  }
}
```

### OpenCode

Add to `~/.config/opencode/config.yaml`:

```yaml
mcp:
  synapse:
    command: bunx
    args: ["synapse", "serve", "--stdio"]
```

### OpenClaw

Add to your `config.yaml`:

```yaml
mcpServers:
  synapse:
    command: bunx
    args:
      - synapse
      - serve
      - --stdio
```

### SSE (multi-client sharing)

Start the SSE server:

```bash
synapse serve --sse              # default port 7099
synapse serve --sse --port 8080  # custom port
```

Then point MCP clients at the SSE endpoint:

```json
{
  "mcpServers": {
    "synapse": {
      "url": "http://localhost:7099/sse"
    }
  }
}
```

## Usage Examples

Once configured, use these MCP tools from any client:

```
# Search across all sessions
synapse_search query="how to parse JSON"

# List recent sessions
synapse_session_list limit=5

# View a specific session
synapse_session_detail session_id="claude-code:abc123"

# Trigger a manual sync
synapse_sync
```

## Data Location

| Path | Description |
|------|-------------|
| `~/.synapse/synapse.db` | SQLite database |
| `~/.synapse/cursors.json` | Sync cursor state |
| `~/.claude/projects/` | Claude Code session files |
