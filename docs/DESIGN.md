# Synapse — AI 编程会话记忆 MCP 服务

> 让所有 AI 编程工具共享同一份记忆

## 一句话

本地 SQLite 服务，通过 MCP 协议让 Claude Code / OpenCode / OpenClaw / 任意 MCP 客户端查询和复用彼此的编程会话记录。

---

## 解决什么问题

| 痛点 | 场景 |
|------|------|
| **跨工具失忆** | Claude Code 里修过的 bug，OpenCode 不知道 |
| **重复劳动** | 同一个问题在不同工具里反复解释上下文 |
| **找不到历史** | "上次那个 CI 问题怎么解的？"——在哪个工具里都不记得 |
| **经验不沉淀** | 好的解决方案散落在各处对话里，无法复用 |

---

## 架构

```
┌─────────────────────────────────────────────────────────┐
│                     MCP Clients                         │
│  Claude Code  │  OpenCode  │  OpenClaw  │  其他 CLI     │
└───────┬───────┴─────┬──────┴─────┬──────┴──────┬────────┘
        │             │            │             │
        │         MCP Protocol (stdio / SSE)     │
        │             │            │             │
┌───────▼─────────────▼────────────▼─────────────▼────────┐
│                   Synapse MCP Server                      │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │  Tools   │  │ Resources│  │  Prompts │               │
│  │ search   │  │ session  │  │ context  │               │
│  │ ingest   │  │ list     │  │ handoff  │               │
│  │ related  │  │ detail   │  │          │               │
│  └──────────┘  └──────────┘  └──────────┘               │
│                      │                                   │
│              ┌───────▼────────┐                          │
│              │   Core Engine  │                          │
│              │  - Indexer     │                          │
│              │  - Search      │                          │
│              │  - Sync        │                          │
│              └───────┬────────┘                          │
│                      │                                   │
│              ┌───────▼────────┐                          │
│              │  SQLite + FTS5 │                          │
│              │  ~/.synapse/    │                          │
│              │  synapse.db     │                          │
│              └────────────────┘                          │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Source Adapters                       │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │   │
│  │  │  Claude  │ │ OpenCode │ │    OpenClaw       │  │   │
│  │  │  Code    │ │ (SQLite) │ │   (JSONL)        │  │   │
│  │  │  (JSONL) │ │          │ │                   │  │   │
│  │  └──────────┘ └──────────┘ └──────────────────┘  │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

---

## 数据模型

### SQLite Schema

```sql
-- 项目（按工作目录聚合）
CREATE TABLE projects (
  id TEXT PRIMARY KEY,           -- SHA-256(path)
  path TEXT NOT NULL UNIQUE,     -- /Users/symbolstar/superset/app-ios
  name TEXT NOT NULL,            -- app-ios
  last_activity TEXT,
  session_count INTEGER DEFAULT 0
);

-- 会话
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,           -- source:original_id
  source TEXT NOT NULL,          -- 'claude-code' | 'opencode' | 'openclaw'
  project_id TEXT REFERENCES projects(id),
  title TEXT,
  summary TEXT,                  -- AI 生成的一句话摘要
  model TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds INTEGER,
  message_count INTEGER DEFAULT 0,
  user_message_count INTEGER DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  -- 增量同步
  source_fingerprint TEXT,       -- inode:mtime:size 或 rowversion
  indexed_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 消息（精简版，只存搜索需要的）
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  role TEXT NOT NULL,             -- user | assistant | tool
  content TEXT NOT NULL,
  tool_name TEXT,
  model TEXT,
  timestamp TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0
);

-- 全文搜索
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  tool_name,
  content='messages',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

-- FTS 自动同步触发器
CREATE TRIGGER msg_fts_i AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content, tool_name) VALUES (new.rowid, new.content, new.tool_name);
END;
CREATE TRIGGER msg_fts_d AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content, tool_name) VALUES ('delete', old.rowid, old.content, old.tool_name);
END;

-- 标签（可选，用于标记重要解法）
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(session_id, tag)
);

-- 索引
CREATE INDEX idx_sessions_project ON sessions(project_id, started_at DESC);
CREATE INDEX idx_sessions_source ON sessions(source, started_at DESC);
CREATE INDEX idx_messages_session ON messages(session_id, ordinal);
```

---

## MCP Tools 设计

### 1. `synapse_search` — 全文搜索历史对话

```json
{
  "name": "synapse_search",
  "description": "搜索所有 AI 编程工具的历史对话记录。用于查找之前解决过的问题、复用方案。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "搜索关键词" },
      "source": { "type": "string", "enum": ["claude-code", "opencode", "openclaw"], "description": "限定数据源" },
      "project": { "type": "string", "description": "限定项目名或路径" },
      "since": { "type": "string", "description": "ISO 时间，只搜此时间之后" },
      "limit": { "type": "integer", "default": 10 }
    },
    "required": ["query"]
  }
}
```

返回：匹配的消息片段 + 所属 session 摘要 + 来源工具 + 项目名

### 2. `synapse_session_list` — 列出会话

```json
{
  "name": "synapse_session_list",
  "description": "列出历史编程会话，支持按项目/来源/时间过滤。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "project": { "type": "string" },
      "source": { "type": "string" },
      "since": { "type": "string" },
      "limit": { "type": "integer", "default": 20 }
    }
  }
}
```

### 3. `synapse_session_detail` — 获取会话详情

```json
{
  "name": "synapse_session_detail",
  "description": "获取某次编程会话的完整对话内容，用于复用之前的解决方案。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "session_id": { "type": "string" },
      "roles": { "type": "array", "items": { "type": "string" }, "description": "过滤角色，如只看 user+assistant" },
      "summary_only": { "type": "boolean", "default": false, "description": "只返回摘要不返回完整消息" }
    },
    "required": ["session_id"]
  }
}
```

### 4. `synapse_related` — 找相关会话

```json
{
  "name": "synapse_related",
  "description": "根据当前上下文找相关的历史会话。当你在处理一个问题时，找之前类似的解决经验。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "context": { "type": "string", "description": "当前问题的描述或代码片段" },
      "project": { "type": "string", "description": "限定项目" },
      "limit": { "type": "integer", "default": 5 }
    },
    "required": ["context"]
  }
}
```

### 5. `synapse_project_summary` — 项目级概览

```json
{
  "name": "synapse_project_summary",
  "description": "查看某个项目的 AI 编程活动概览：多少会话、用了什么工具、最近在做什么。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "project": { "type": "string" },
      "days": { "type": "integer", "default": 7 }
    }
  }
}
```

### 6. `synapse_sync` — 手动触发同步

```json
{
  "name": "synapse_sync",
  "description": "立即同步所有数据源的最新会话到本地索引。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "source": { "type": "string", "description": "只同步指定源" }
    }
  }
}
```

---

## Source Adapters

### Claude Code Adapter

```
位置: ~/.claude/projects/{path-encoded-dir}/*.jsonl
格式: JSONL, 每行一个 JSON (type: user|assistant|queue-operation)
Session ID: sessionId 字段
项目路径: 从目录名反推 (-Users-symbolstar-superset → /Users/symbolstar/superset)
增量策略: inode + mtime + size + byte offset
```

### OpenCode Adapter

```
位置: ~/.local/share/opencode/opencode.db
格式: SQLite (session → message → part)
Session ID: session.id
项目路径: session.directory
增量策略: session.time_updated > last_sync
消息内容: part.data (JSON, 需解析)
```

### OpenClaw Adapter

```
位置: ~/.openclaw/agents/{agent}/sessions/*.jsonl
格式: JSONL (type: session|message|model_change|...)
Session ID: 文件名 UUID
Agent: 从路径提取 (judy/milly/miki/...)
增量策略: inode + mtime + size
```

---

## 运行方式

### 作为 MCP Server 启动

```bash
# stdio 模式（Claude Code / OpenCode 直接用）
synapse serve --stdio

# SSE 模式（HTTP，多客户端共享）
synapse serve --sse --port 7099
```

### 各客户端配置

**Claude Code** (`~/.claude/mcp.json`):
```json
{
  "mcpServers": {
    "synapse": {
      "command": "synapse",
      "args": ["serve", "--stdio"]
    }
  }
}
```

**OpenCode** (`~/.config/opencode/config.yaml`):
```yaml
mcpServers:
  synapse:
    command: synapse
    args: ["serve", "--stdio"]
```

**OpenClaw** (`config.yaml`):
```yaml
plugins:
  entries:
    synapse:
      type: mcp
      command: synapse
      args: ["serve", "--stdio"]
```

### 自动同步

```bash
# 后台 daemon 模式，定时扫描变更
synapse serve --sse --port 7099 --watch --interval 60

# 或用 launchd/cron 定期 sync
synapse sync
```

---

## 技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| 语言 | TypeScript | 与你现有工具链一致 |
| 运行时 | Bun | 内置 SQLite，启动快 |
| 数据库 | SQLite + FTS5 | 纯本地，零依赖 |
| MCP SDK | `@modelcontextprotocol/sdk` | 官方 SDK |
| 传输 | stdio + SSE | stdio 给直连客户端，SSE 给多客户端共享 |

---

## 核心使用场景

### 场景 1：跨工具复用

```
你在 OpenCode 里遇到一个 iOS build 报错。
→ OpenCode 调用 synapse_search("iOS build error provisioning")
→ 找到 3 天前 Claude Code 里的一次对话，完整解法
→ OpenCode 调用 synapse_session_detail(id) 获取解法
→ 直接复用，不用重新排查
```

### 场景 2：上下文续接

```
你昨天用 Claude Code 做了一半的重构，今天想用 OpenCode 继续。
→ OpenCode 调用 synapse_related(context="重构 UserService")
→ 返回昨天的会话摘要和关键决策
→ OpenCode 有了完整上下文，无缝续接
```

### 场景 3：项目全景

```
你想看 app-ios 项目最近一周的 AI 编程活动。
→ synapse_project_summary(project="app-ios", days=7)
→ 返回: 32 次会话, Claude Code 25 / OpenCode 5 / OpenClaw 2
→ 主要工作: UI 重构、CI 修复、性能优化
```

---

## 项目结构

```
synapse/
├── src/
│   ├── server/
│   │   ├── mcp.ts              # MCP server 入口
│   │   ├── tools/              # MCP tool handlers
│   │   │   ├── search.ts
│   │   │   ├── session-list.ts
│   │   │   ├── session-detail.ts
│   │   │   ├── related.ts
│   │   │   ├── project-summary.ts
│   │   │   └── sync.ts
│   │   └── transport/
│   │       ├── stdio.ts
│   │       └── sse.ts
│   ├── core/
│   │   ├── db.ts               # SQLite 连接 + schema
│   │   ├── indexer.ts          # 会话索引逻辑
│   │   ├── search.ts           # FTS5 搜索
│   │   └── sync.ts             # 增量同步调度
│   ├── adapters/
│   │   ├── types.ts            # Adapter 接口
│   │   ├── claude-code.ts      # Claude Code JSONL 解析
│   │   ├── opencode.ts         # OpenCode SQLite 读取
│   │   └── openclaw.ts         # OpenClaw JSONL 解析
│   ├── cli.ts                  # CLI 入口 (serve / sync / search)
│   └── index.ts
├── tests/
├── package.json
└── README.md
```

---

## 与 Pika 的关键差异

| 维度 | Pika | Synapse |
|------|------|--------|
| 部署 | 云端 SaaS (Cloudflare) | **纯本地** |
| 访问方式 | Web 仪表盘 + CLI | **MCP 协议**（AI 工具原生调用） |
| 核心价值 | 人类搜索回放 | **AI 工具间共享记忆** |
| 数据安全 | 代码对话上云 | **数据不出机器** |
| 复杂度 | 58K 行, 4 个 package | **目标 <5K 行** |
| 数据源 | 5 种 | 3 种（按需扩展） |

---

## 分期实施

### Phase 1：MVP（能搜能用）
- [ ] SQLite schema + FTS5
- [ ] Claude Code adapter（你最大的数据源，219 个文件）
- [ ] `synapse_search` + `synapse_session_list` + `synapse_session_detail`
- [ ] MCP stdio server
- [ ] Claude Code 里能直接搜

### Phase 2：全数据源
- [ ] OpenCode adapter (SQLite)
- [ ] OpenClaw adapter (JSONL)
- [ ] 增量同步 + file watcher
- [ ] `synapse_related` + `synapse_project_summary`

### Phase 3：增强
- [ ] SSE 传输 (多客户端共享)
- [ ] AI 摘要生成（用小模型给每个 session 生成一句话摘要）
- [ ] 标签系统
- [ ] CLI 独立搜索（`synapse search "xxx"`）

### Phase 4：上云（可选）
- [ ] Cloudflare Worker + D1 + R2 云端存储
- [ ] Web 仪表盘（搜索 + 回放）
- [ ] 多设备同步

---

## 上云方案（Phase 4 详细设计）

### Pika 的上云方式拆解

Pika 的云端是一个**三层架构**：

```
CLI (本地解析) ──→ Next.js (API 网关 + OAuth + Web UI) ──→ Worker (D1/R2 读写)
```

**上传流程（两阶段）**：

```
1. POST /api/ingest/sessions       → 批量 metadata upsert (50/batch)
2. PUT  /api/ingest/content/:key/canonical  → gzip 压缩的对话 JSON → Worker 解压 → 分块写 D1 + FTS
3. Raw 内容走 presigned URL 直传 R2（绕过 Worker 30s 超时）
```

**关键设计点**：

| 设计 | 做法 | 目的 |
|------|------|------|
| 两阶段上传 | 先 metadata 后 content | metadata 轻量可批量；content 重但可异步 |
| Presigned URL | Next.js 生成 R2 presigned PUT → CLI 直传 R2 → confirm | 绕过 Worker body size 和 30s 限制 |
| Content hash | SHA-256 去重 | 相同内容不重复上传（204 no-op） |
| Version control | parser_revision + schema_version | 防降级，支持 parser 升级后重新索引 |
| FTS 分块 | 消息分块后写入 message_chunks | 大消息拆分，FTS 索引更高效 |
| Gzip 炸弹防护 | 流式追踪解压大小，超 256MB 截断 | 安全 |
| 认证双通道 | Google OAuth (Web) + API key (CLI) | Web 用 session cookie，CLI 用 pk_xxx Bearer |

### Synapse 的上云方案（简化版）

我们不需要 Pika 那么复杂。核心区别：**Synapse 的主要消费者是 MCP 客户端（AI 工具），不是人。** Web 仪表盘是锦上添花。

#### 架构

```
┌───────────────────────────────────────────────────────────────┐
│                       本地 (始终运行)                          │
│                                                               │
│  MCP Clients ←── MCP ──→ Synapse Server ←── SQLite (本地)     │
│                              │                                │
│                         Cloud Sync                            │
│                         (可选, 后台)                           │
└──────────────────────────────┬────────────────────────────────┘
                               │
                          HTTPS (sync)
                               │
┌──────────────────────────────▼────────────────────────────────┐
│                    Cloudflare (云端)                           │
│                                                               │
│  ┌─────────────┐   ┌──────────┐   ┌────────────────────────┐ │
│  │   Worker    │   │    D1    │   │          R2            │ │
│  │  (API)      │   │ metadata │   │  gzip session content  │ │
│  │             │   │  + FTS5  │   │                        │ │
│  └─────────────┘   └──────────┘   └────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              Web Dashboard (可选)                        │ │
│  │  Next.js / Cloudflare Pages                             │ │
│  │  搜索 + 回放 + 项目概览                                  │ │
│  └─────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

#### 核心原则：**Local-first, Cloud-optional**

| 原则 | 说明 |
|------|------|
| 本地优先 | MCP 工具始终读本地 SQLite，零延迟 |
| 云端可选 | `synapse sync --cloud` 时才上传到 Cloudflare |
| 单向同步 | 本地 → 云端（不做双向，避免冲突） |
| 渐进增强 | 不配置云端 = 纯本地工具，配了 = 多设备 + Web 搜索 |

#### 上传流程（简化版 Pika）

```
1. synapse sync              → 本地解析 + 索引到 SQLite
2. synapse sync --cloud      → 在步骤1基础上，增量上传到 Cloudflare
```

上传细节：

```
Phase 1: POST /api/sessions     → 批量 metadata (50/batch)
Phase 2: PUT  /api/content/:id  → gzip session JSON → R2
```

我们不需要 Pika 的 presigned URL 流程（我们的 session 数据量小得多），直接 proxy 过 Worker 就行。

#### 云端 Worker Schema（复用本地 schema）

本地和云端用**同一套 schema**，只是云端多了 `user_id` 字段：

```sql
-- 云端额外字段
ALTER TABLE sessions ADD COLUMN user_id TEXT NOT NULL;
ALTER TABLE sessions ADD COLUMN content_key TEXT;    -- R2 对象 key
ALTER TABLE sessions ADD COLUMN content_hash TEXT;   -- SHA-256 去重
```

#### 认证（极简版）

不用 Google OAuth。用 **API key 单一方式**：

```bash
# 首次配置
synapse cloud init
# → 生成 API key，存到 ~/.synapse/config.json
# → Worker 端存 SHA-256 hash
```

Worker 校验：`Authorization: Bearer sk_xxx` → SHA-256 比对 → 返回 userId。

#### 费用估算（Cloudflare Free Tier）

| 资源 | 免费额度 | 你的用量预估 |
|------|---------|------------|
| Workers | 100K 请求/天 | ~100 请求/天 |
| D1 | 5M 行读 / 100K 行写/天 | ~1K 读 / 100 写/天 |
| R2 | 10GB 存储 / 1M 请求/月 | ~100MB / 几百请求/月 |

**结论：完全免费。**

---

## 更新后的分期计划

| Phase | 内容 | 产出 |
|-------|------|------|
| **1** | 本地核心 + Claude Code adapter + MCP server | Claude Code 里能搜到历史 |
| **2** | OpenCode + OpenClaw adapters + 增量同步 | 三个工具互通 |
| **3** | CLI + 标签 + AI 摘要 | 独立可用的命令行工具 |
| **4** | Cloudflare 上云 + Web 仪表盘 | 多设备 + 浏览器搜索 |

Phase 1-2 是核心价值（**MCP 跨工具记忆互通**），Phase 3-4 是增强。

---

*设计 by Judy 🔍 | 2026-04-22*
