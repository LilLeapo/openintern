# OpenIntern Agent Runtime

TypeScript 后端（含 Agent Runtime）+ Web UI + Python MCP Skills 的多租户 Agent 系统。

当前实现已经切换为 **Postgres 持久化**：
- Run、Event/Trace、Checkpoint、Memory 全部落库
- Memory 支持 `pgvector` + Postgres FTS 混合检索
- API 通过 `org_id / user_id / project_id(optional)` 做 scope 隔离

## 1. 核心能力

- 多租户运行上下文
  - 每次请求按 `org_id / user_id / project_id` 进行数据隔离
- Run 执行入口
  - `POST /api/runs` 创建 run 并进入队列执行
- Event/Trace 溯源
  - 所有 step、LLM 调用、工具调用写入 `events`
  - 支持历史拉取 + SSE 实时流
- Checkpoint 恢复基础
  - 每 step 保存 working_state 到 `checkpoints`
  - 记录 `agent_id`，为多 Agent 并行预留
- Memory Service（核心）
  - 四层模型：`core` / `working(在 checkpoint)` / `episodic` / `archival`
  - `memory_search`（向量+FTS）、`memory_get`、`memory_write`
- Tool Router
  - TS 内置工具（`memory_*`、`read_file`、`export_trace`）
  - 可选接入 Python MCP tools

## 2. 架构概览

```text
Web UI (React)
  -> REST + SSE
Backend (Express + Run Queue + Agent Runtime)
  -> Postgres (runs/events/checkpoints/memories/memory_chunks)
  -> Optional MCP (python stdio)
```

单 Agent MVP 循环：
1. `step.started`
2. `memory_search`（按 scope）
3. 组装上下文（system + history summary + memory snippets）
4. 调用模型
5. 若 tool_call -> ToolRouter 执行并写 `tool.called/tool.result`
6. 写 checkpoint
7. `step.completed`
8. 结束时 `run.completed` / `run.failed`

## 3. 技术栈

- Backend: Node.js + TypeScript + Express
- Runtime Storage: PostgreSQL + pgvector + FTS
- Frontend: React + TypeScript + Vite
- MCP Skills: Python（stdio JSON-RPC）

## 4. 快速开始

### 4.1 前置要求

- Node.js >= 20
- pnpm >= 8
- Python >= 3.9（如果要用 MCP）
- PostgreSQL >= 15（建议）并可安装 `pgvector`

### 4.2 安装依赖

```bash
pnpm install
pnpm --dir web install

cd python
pip3 install -e .
cd ..
```

### 4.3 配置数据库

必须提供 `DATABASE_URL`。

```bash
export DATABASE_URL='postgres://postgres:postgres@localhost:5432/openintern'
```

首次启动时后端会自动执行 schema 初始化（含 extension/table/index）。

### 4.4 启动

后端：
```bash
pnpm cli dev
```

Web：
```bash
pnpm --dir web dev
```

默认后端地址：`http://localhost:3000`

## 5. 多租户 Scope 约定

所有 API 请求都需要 scope（至少 org/user）：
- Header 方式（推荐）
  - `x-org-id`
  - `x-user-id`
  - `x-project-id`（可选）
- Body/Query 方式也支持（用于兼容）

CLI 默认会注入：
- `AGENT_ORG_ID`（默认 `org_default`）
- `AGENT_USER_ID`（默认 `user_default`）
- `AGENT_PROJECT_ID`（可选）

## 6. API

### 6.1 创建 Run

`POST /api/runs`

请求体：
```json
{
  "org_id": "org_demo",
  "user_id": "user_demo",
  "project_id": "proj_demo",
  "session_key": "s_demo",
  "input": "帮我总结今天的工作",
  "agent_id": "main"
}
```

响应：
```json
{
  "run_id": "run_xxx",
  "status": "pending",
  "created_at": "2026-02-09T00:00:00.000Z"
}
```

### 6.2 查询 Run

`GET /api/runs/:run_id`

### 6.3 拉取事件历史

`GET /api/runs/:run_id/events?cursor&limit`

响应包含：
- `events`
- `total`（本页条数）
- `next_cursor`（下一页游标）

### 6.4 SSE 实时事件

`GET /api/runs/:run_id/stream`

事件类型：
- `run.started`
- `step.started`
- `llm.called`
- `tool.called`
- `tool.result`
- `step.completed`
- `run.completed`
- `run.failed`

### 6.5 取消 Run

`POST /api/runs/:run_id/cancel`

仅 `pending` 可取消。

## 7. Memory 接口（运行时工具）

运行时内置工具接口：

- `memory_search(query, scope, top_k, filters)`
  - 返回：`[{ id, snippet, score, type }]`
  - 不返回全文
- `memory_get(id)`
  - 返回：`{ text, metadata, ... }`
- `memory_write(type, scope, text, metadata)`
  - 写入 `memories` + 自动分块写入 `memory_chunks`

检索策略：
- 向量检索（pgvector cosine）
- FTS 检索（`to_tsvector/plainto_tsquery`）
- 融合打分去重后返回 topK

## 8. 数据模型（Postgres）

最小核心表：
- `runs(id, org_id, user_id, project_id, session_key, status, ...)`
- `events(id bigserial, run_id, ts, agent_id, step_id, type, payload jsonb, ...)`
- `checkpoints(id bigserial, run_id, agent_id, step_id, state jsonb, created_at)`
- `memories(id uuid, org_id, user_id, project_id, type, text, metadata jsonb, importance, ...)`
- `memory_chunks(id uuid, memory_id, org_id, user_id, project_id, chunk_text, embedding vector(256), search_tsv, ...)`

对应实现文件：
- `src/backend/db/schema.ts`

## 9. CLI 使用

创建 run：
```bash
pnpm cli run "帮我写一个 TS 函数" --session demo
```

流式查看：
```bash
pnpm cli run "解释这段代码" --stream
# 或
pnpm cli tail run_xxx
```

切换 scope：
```bash
AGENT_ORG_ID=org_a AGENT_USER_ID=user_a pnpm cli run "hello"
```

## 10. 开发与测试

```bash
# 后端类型检查
pnpm typecheck

# 前端类型检查
pnpm --dir web typecheck

# 后端测试
pnpm exec vitest run

# 前端测试
pnpm --dir web exec vitest run
```

说明：
- 与 Postgres 强绑定的 API 集成测试在缺少 `DATABASE_URL` 时会跳过。

## 11. 目录

```text
src/
  backend/
    api/
    db/
    runtime/
    queue/
    agent/
  cli/
  types/
web/
python/
```

## 12. 常见问题

### 启动时报 DATABASE_URL 缺失

请设置：
```bash
export DATABASE_URL='postgres://postgres:postgres@localhost:5432/openintern'
```

### SSE 返回 400/404

通常是 scope 不匹配（org/user/project 与创建 run 时不同）。

### MCP 工具不可用

确认 Python 依赖已安装：
```bash
cd python && pip3 install -e .
```

并用 `pnpm cli dev --mcp-stdio` 启动。
