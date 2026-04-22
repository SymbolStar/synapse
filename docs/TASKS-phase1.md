# Synapse — Phase 1 Task Breakdown

> 每个 task 对应一个 commit，代码量控制在 **≤400 行**
> 按顺序执行，每个 task 包含对应的测试

---

## Task 1: Project scaffolding
**Branch:** `feat/scaffold`

- 初始化 Bun 项目 (`bun init`)
- `package.json`：name, version, scripts, dependencies
- `tsconfig.json`：strict mode, paths
- `biome.json`：lint + format 配置
- `.gitignore`
- `README.md`：项目简介 + badge
- `LICENSE`：MIT

**依赖：**
```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "latest"
  },
  "devDependencies": {
    "@biomejs/biome": "latest",
    "@types/bun": "latest"
  }
}
```

**预计行数：** ~100

---

## Task 2: SQLite schema + database module
**Branch:** `feat/db`

- `src/core/db.ts`：数据库连接管理（open/close，WAL mode）
- `src/core/schema.sql`：建表语句（projects, sessions, messages, messages_fts, triggers, indexes）
- `src/core/migrate.ts`：初始化 schema（幂等，检查表是否存在）
- `tests/core/db.test.ts`：连接、建表、基本 CRUD

**预计行数：** ~250

---

## Task 3: Core types + shared constants
**Branch:** `feat/types`

- `src/types.ts`：CanonicalSession, CanonicalMessage, ParseResult, Source, AdapterConfig 等类型定义
- `src/constants.ts`：数据目录路径、batch size、版本号等常量
- `tests/types.test.ts`：类型校验工具函数测试

**预计行数：** ~150

---

## Task 4: Adapter interface + file fingerprinting
**Branch:** `feat/adapter-interface`

- `src/adapters/types.ts`：SourceAdapter 接口定义（discover, shouldSkip, parse, buildCursor）
- `src/adapters/fingerprint.ts`：文件指纹（inode + mtime + size）
- `src/core/cursor.ts`：cursor 持久化（读写 `~/.synapse/cursors.json`）
- `tests/adapters/fingerprint.test.ts`

**预计行数：** ~200

---

## Task 5: Claude Code parser — JSONL 行解析
**Branch:** `feat/claude-parser`

- `src/adapters/claude-code/parser.ts`：
  - 逐行解析 JSONL
  - 处理 user/assistant 消息
  - 提取 tool_use / tool_result
  - 累计 token 用量
  - 跳过 thinking / queue-operation
- `tests/adapters/claude-code/parser.test.ts`：用 fixture 数据测试

**预计行数：** ~350

---

## Task 6: Claude Code adapter — 文件发现 + 增量同步
**Branch:** `feat/claude-adapter`

- `src/adapters/claude-code/adapter.ts`：
  - discover：递归扫描 `~/.claude/projects/**/*.jsonl`
  - shouldSkip：fingerprint 比对
  - parse：调用 parser，组装 ParseResult
  - buildCursor：记录 byte offset
  - extractProjectName：路径编码反推
  - extractProjectRef：SHA-256 hash
- `tests/adapters/claude-code/adapter.test.ts`

**预计行数：** ~300

---

## Task 7: Indexer — 将 ParseResult 写入 SQLite
**Branch:** `feat/indexer`

- `src/core/indexer.ts`：
  - upsertProject：创建/更新项目
  - upsertSession：创建/更新会话（含去重逻辑）
  - insertMessages：批量写入消息（自动触发 FTS 索引）
  - indexParseResults：编排以上步骤
- `tests/core/indexer.test.ts`

**预计行数：** ~300

---

## Task 8: Search engine — FTS5 查询
**Branch:** `feat/search`

- `src/core/search.ts`：
  - search(query, filters)：FTS5 MATCH + JOIN sessions + snippet
  - listSessions(filters)：按时间/项目/来源过滤
  - getSessionDetail(id)：获取完整消息列表
  - getProjectSummary(project, days)：聚合统计
- `tests/core/search.test.ts`：写入测试数据后搜索验证

**预计行数：** ~350

---

## Task 9: Sync orchestrator
**Branch:** `feat/sync`

- `src/core/sync.ts`：
  - runSync(sources?)：遍历 adapter → discover → parse → index
  - 加载/保存 cursor state
  - 错误收集（不中断）
  - 返回 SyncResult（parsed, skipped, errors）
- `tests/core/sync.test.ts`

**预计行数：** ~250

---

## Task 10: MCP server — tool handlers
**Branch:** `feat/mcp-tools`

- `src/server/tools/search.ts`：synapse_search handler
- `src/server/tools/session-list.ts`：synapse_session_list handler
- `src/server/tools/session-detail.ts`：synapse_session_detail handler
- `src/server/tools/sync.ts`：synapse_sync handler
- `tests/server/tools.test.ts`

**预计行数：** ~300

---

## Task 11: MCP server — stdio transport + entry
**Branch:** `feat/mcp-server`

- `src/server/mcp.ts`：MCP server 实例创建，注册所有 tools
- `src/server/transport/stdio.ts`：stdio 传输层
- `src/cli.ts`：CLI 入口（`synapse serve --stdio`，`synapse sync`）
- `src/index.ts`：导出
- 更新 `package.json`：bin 字段

**预计行数：** ~250

---

## Task 12: Integration test + Claude Code MCP 配置
**Branch:** `feat/integration`

- `tests/integration/e2e.test.ts`：
  - 端到端测试：写入 fixture JSONL → sync → search → 验证结果
- `docs/setup.md`：
  - Claude Code / OpenCode / OpenClaw 配置说明
- 更新 `README.md`：安装 + 快速开始

**预计行数：** ~250

---

## 执行顺序依赖图

```
Task 1 (scaffold)
  └→ Task 2 (db)
      └→ Task 3 (types)
          ├→ Task 4 (adapter interface)
          │   └→ Task 5 (claude parser)
          │       └→ Task 6 (claude adapter)
          │           └→ Task 7 (indexer)
          │               └→ Task 9 (sync)
          └→ Task 8 (search)
              └→ Task 10 (mcp tools)
                  └→ Task 11 (mcp server)
                      └→ Task 12 (integration)
```

---

## 总预计代码量

| Task | 文件数 | 行数 |
|------|--------|------|
| 1. Scaffold | 5 | ~100 |
| 2. DB | 4 | ~250 |
| 3. Types | 3 | ~150 |
| 4. Adapter interface | 4 | ~200 |
| 5. Claude parser | 2 | ~350 |
| 6. Claude adapter | 2 | ~300 |
| 7. Indexer | 2 | ~300 |
| 8. Search | 2 | ~350 |
| 9. Sync | 2 | ~250 |
| 10. MCP tools | 5 | ~300 |
| 11. MCP server | 4 | ~250 |
| 12. Integration | 3 | ~250 |
| **合计** | **38** | **~3,050** |

Phase 1 完成后，你就能在 Claude Code 里配置 Synapse MCP server，搜到所有历史对话了。
