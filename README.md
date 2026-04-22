# Synapse

[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6?logo=typescript)](https://www.typescriptlang.org)
[![MCP](https://img.shields.io/badge/protocol-MCP-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**AI coding session memory, shared across tools.**

Synapse is a local MCP server that indexes conversations from Claude Code, OpenCode, OpenClaw, and other AI coding tools into a single SQLite database — letting any MCP client search and reuse past sessions.

## Quick Start

```bash
git clone https://github.com/anthropics/synapse.git
cd synapse
bun install
bun link

# Index existing sessions
synapse sync

# Start MCP server
synapse serve --stdio
```

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

See [docs/setup.md](docs/setup.md) for OpenCode and OpenClaw configuration.

## Features

- **Full-text search** across all AI coding history (SQLite FTS5)
- **Cross-tool memory** — what you solved in Claude Code is available in OpenCode
- **Local-first** — your data never leaves your machine
- **Incremental sync** with file fingerprinting (inode + mtime + size)
- **MCP protocol** — works with any MCP-compatible client

## MCP Tools

| Tool | Description |
|------|-------------|
| `synapse_search` | Full-text search across indexed sessions |
| `synapse_session_list` | List sessions with optional filters (source, project, date) |
| `synapse_session_detail` | Retrieve full conversation for a session |
| `synapse_sync` | Trigger incremental sync from all sources |

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Claude Code  │     │  OpenCode   │     │  OpenClaw   │
│   .jsonl     │     │   .jsonl    │     │   .jsonl    │
└──────┬───────┘     └──────┬──────┘     └──────┬──────┘
       │                    │                    │
       └────────────┬───────┘────────────────────┘
                    ▼
           ┌────────────────┐
           │   Adapters     │  discover → parse → canonical
           └───────┬────────┘
                   ▼
           ┌────────────────┐
           │   Indexer      │  upsert projects/sessions/messages
           └───────┬────────┘
                   ▼
           ┌────────────────┐
           │  SQLite + FTS5 │  synapse.db
           └───────┬────────┘
                   ▼
           ┌────────────────┐
           │  MCP Server    │  stdio transport
           └────────────────┘
```

## Contributing

```bash
bun install
bun test
bun run lint
```

## License

MIT
