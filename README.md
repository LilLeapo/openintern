# OpenIntern

一个可运行的多租户 Agent Runtime 项目：TypeScript 后端 + React Web UI + 可选 Python MCP Server。  
代码当前重点是「可追踪的 run 执行链路 + Postgres 持久化 + 角色编排基础能力」。

## 功能总览

- 多租户隔离
  - 每个请求按 `org_id / user_id / project_id(optional)` 做数据隔离（Header 优先）。
- Run 生命周期
  - 创建、排队、执行、查询、分页、取消。
- 事件追踪（Trace）
  - 事件落库（`events`）+ SSE 实时推送（`/api/runs/:run_id/stream`）。
- 运行时记忆系统（Postgres）
  - `core / episodic / archival` 三层持久记忆；
  - `pgvector` + Postgres FTS 混合检索；
  - step 级 checkpoint（`checkpoints`）用于恢复基础。
- 角色编排（Phase 0~3 基础）
  - 角色/群组/成员管理；
  - 群组 run 走串行编排器（`SerialOrchestrator`）；
  - 黑板（Blackboard）读写接口与前端页面。
- 工具与策略
  - 内置工具：`memory_search` / `memory_get` / `memory_write` / `read_file` / `export_trace`；
  - 可选 MCP 工具接入（stdio）；
  - `ToolPolicy` 已支持 allow / block 规则（高风险默认阻断）。
- 使用入口完整
  - Backend API
  - Web（Chat / Runs / Trace / Blackboard）
  - CLI（`agent dev/run/tail/export/skills/doctor`）

## 架构

```text
Web UI (React + Vite)
  -> REST + SSE

Backend (Express + RunQueue + Runtime Executor)
  -> PostgreSQL (runs/events/checkpoints/memories/memory_chunks/roles/groups/skills...)
  -> Optional MCP (Python stdio JSON-RPC)
```

执行主链路（单 agent）：
1. `POST /api/runs` 创建 run（pending）并入队
2. 队列串行执行 run（running）
3. Agent step 循环：`step.started -> llm.called -> tool.called/tool.result -> step.completed`
4. 每 step 写 checkpoint
5. 结束写 `run.completed` 或 `run.failed`
6. 事件同时落库并通过 SSE 推送

执行主链路（group run）：
1. `POST /api/groups/:group_id/runs`
2. Runtime 根据 group 成员创建多角色 runner
3. 串行编排（非 lead -> lead 汇总）
4. lead 产出 `message.decision`，run 结束后自动生成 episodic 黑板记忆

## 技术栈

- Backend: Node.js + TypeScript + Express + pg
- Storage: PostgreSQL + pgvector + FTS
- Frontend: React + TypeScript + Vite
- MCP: Python（stdio 协议）
- Test: Vitest + Playwright + pytest

## 快速开始

### 1) 前置要求

- Node.js >= 20
- pnpm >= 8
- PostgreSQL >= 15（需 `vector` 扩展）
- Python >= 3.9（仅 MCP 需要）

### 2) 安装依赖

```bash
# 根目录（backend + cli）
pnpm install

# web
pnpm --dir web install

# python MCP（可选）
cd python
pip3 install -e .
cd ..
```

### 3) 准备数据库

你需要一个可连接的 Postgres，并确保 `DATABASE_URL` 对应用户有权限创建扩展（至少首次迁移时需要 `CREATE EXTENSION vector/pgcrypto`）。

```bash
export DATABASE_URL='postgres://openintern:openintern@127.0.0.1:5432/openintern'
```

可选：使用仓库示例 compose（见 `docker-compose.example.yml`）。

首次启动后端时会自动执行幂等迁移（表、索引、扩展）。

### 4) 启动服务

后端（方式一）：

```bash
pnpm cli dev
```

后端（方式二，直接运行 server）：

```bash
pnpm exec tsx src/backend/server.ts
```

前端：

```bash
pnpm --dir web dev
```

默认地址：
- Backend: `http://localhost:3000`
- Web: `http://localhost:5173`

## 多租户 Scope 约定

推荐通过 Header 传递：

- `x-org-id`（必填）
- `x-user-id`（必填）
- `x-project-id`（可选）

Body / Query 也支持（兼容场景）。  
CLI 默认 scope：
- `AGENT_ORG_ID`（默认 `org_default`）
- `AGENT_USER_ID`（默认 `user_default`）
- `AGENT_PROJECT_ID`（可选）

## API 概览

### Runs

- `POST /api/runs`
- `GET /api/runs/:run_id`
- `GET /api/sessions/:session_key/runs?page&limit`
- `GET /api/runs/:run_id/events?cursor&limit&type`
- `GET /api/runs/:run_id/stream`（SSE）
- `POST /api/runs/:run_id/cancel`

### Roles / Groups / Blackboard / Skills

- Roles
  - `POST /api/roles`
  - `GET /api/roles`
  - `GET /api/roles/:role_id`
- Groups
  - `POST /api/groups`
  - `GET /api/groups`
  - `GET /api/groups/:group_id`
  - `POST /api/groups/:group_id/members`
  - `GET /api/groups/:group_id/members`
  - `POST /api/groups/:group_id/runs`
- Blackboard
  - `GET /api/groups/:groupId/blackboard`
  - `GET /api/groups/:groupId/blackboard/:memoryId`
  - `POST /api/groups/:groupId/blackboard`
- Skills
  - `POST /api/skills`
  - `GET /api/skills`
  - `GET /api/skills/:skill_id`
  - `DELETE /api/skills/:skill_id`

### 事件类型（当前主用）

- `run.started / run.completed / run.failed`
- `step.started / step.completed`
- `llm.called / llm.token`
- `tool.called / tool.result / tool.blocked`
- `message.task / message.proposal / message.decision / message.evidence / message.status`（编排扩展）

## CLI 使用

```bash
# 初始化配置
pnpm cli init

# 启动后端开发服务
pnpm cli dev

# 发起 run
pnpm cli run "帮我写一个 TS 函数" --session demo

# 流式观察
pnpm cli run "解释这段代码" --stream
pnpm cli tail run_xxx

# 导出 trace
pnpm cli export run_xxx --format json
```

## Web 页面

- `/` Chat
- `/runs` 历史 run 列表
- `/trace/:runId` run 轨迹
- `/blackboard/:groupId` 群组黑板

## 开发与测试

### 基础检查

```bash
pnpm typecheck
pnpm --dir web typecheck
pnpm lint
pnpm --dir web lint
```

### 后端测试（含集成）

> 依赖 `DATABASE_URL`。未提供时，部分 Postgres 集成用例会 skip。

```bash
export DATABASE_URL='postgres://openintern:openintern@127.0.0.1:5432/openintern'
pnpm exec vitest run
```

### 前端测试

```bash
pnpm --dir web test
```

### Web E2E（Playwright）

首次需要安装浏览器：

```bash
pnpm --dir web exec playwright install chromium
```

执行 e2e：

```bash
export DATABASE_URL='postgres://openintern:openintern@127.0.0.1:5432/openintern'
pnpm --dir web test:e2e
```

### Python MCP 测试（可选）

```bash
cd python
pytest
```

## 配置说明

### 配置文件

- `agent.config.json`（`agent init` 可生成）
- 优先级：配置文件 < 环境变量 < CLI 参数 < API 请求参数

### 常用环境变量

- `DATABASE_URL`
- `PORT`
- `DATA_DIR`
- `LLM_PROVIDER` / `LLM_MODEL` / `LLM_API_KEY`
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`
- `VITE_API_PROXY_TARGET`（web dev 代理）
- `VITE_ORG_ID` / `VITE_USER_ID` / `VITE_PROJECT_ID`

## 项目结构

```text
src/
  backend/
    api/        # HTTP routes
    db/         # Postgres pool + schema migration
    runtime/    # runner/orchestrator/tool router/memory service
    queue/      # serial run queue
    agent/      # LLM/MCP client adapters
  cli/          # agent command line
  types/        # shared zod schemas / types
web/            # React frontend + Playwright e2e
python/         # optional MCP server
```

## 已知限制（按当前实现）

- `runs.group_id`、`events.group_id/message_type` 列已在 schema 中预留，但仓储层尚未完全贯通读写。
- `tool.requires_approval` 事件类型已定义，审批闭环（approve/reject）接口尚未落地。
- Web Trace 当前主要展示 run/step/llm/tool 事件，结构化 message 事件可视化还较基础。

## 常见问题

### 启动时报 `DATABASE_URL is required`

设置数据库连接：

```bash
export DATABASE_URL='postgres://openintern:openintern@127.0.0.1:5432/openintern'
```

### `CREATE EXTENSION vector` 权限错误

用于迁移的数据库用户需要能创建扩展，或由 DBA 预先安装 `vector`、`pgcrypto`。

### SSE 返回 400/404

通常是 scope 不匹配：查询 run 时的 `org/user/project` 与创建 run 时不一致。

### MCP 工具不可用

确认安装了 Python 包并在 `agent dev` 启用 MCP：

```bash
cd python && pip3 install -e .
pnpm cli dev --mcp-stdio
```

## 安全提示

- 不要将真实 API Key 提交到仓库。
- 建议通过环境变量注入密钥，避免明文写入配置文件。
