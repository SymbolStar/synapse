# Synapse

[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6?logo=typescript)](https://www.typescriptlang.org)
[![MCP](https://img.shields.io/badge/protocol-MCP-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**AI coding session memory, shared across tools.**

Synapse is a local MCP server that indexes conversations from Claude Code, OpenCode, OpenClaw, and other AI coding tools into a single SQLite database — letting any MCP client search and reuse past sessions.

## Features

- Full-text search across all AI coding history
- Cross-tool memory: what you solved in Claude Code is available in OpenCode
- Local-first: your data never leaves your machine
- Incremental sync with file fingerprinting

## Quick Start

```bash
bun install
bun run dev -- serve --stdio
```

Configure in your MCP client (e.g. `~/.claude/mcp.json`):

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
