# OpenIntern

[English](./README.md) | 简体中文

一个面向生产环境的多租户 AI Agent Runtime，提供 Agent 执行、事件追踪、团队编排、HITL 人工审批与三层记忆系统，底层基于 PostgreSQL。

## 架构

```
┌──────────────────────────────────────────────────────────┐
│                    Web UI (React + Vite)                │
│   Playground / Runs / Trace / Inbox / Team / Ingest     │
└───────────────────────┬──────────────────────────────────┘
                        │ REST + SSE
┌───────────────────────┴──────────────────────────────────┐
│                  Backend (Express + TypeScript)          │
│                                                          │
│  Run Queue ─→ Agent Runner (step loop) ─→ Tool Router   │
│       │            │                          │          │
│       │      Checkpoint Service         MCP / Built-in  │
│       │            │                                     │
│  Orchestrator ─→ Swarm Coordinator (group runs)         │
│       │                                                  │
│  Approval Manager (HITL) + Memory Service               │
└───────────────────────┬──────────────────────────────────┘
                        │
┌───────────────────────┴──────────────────────────────────┐
│             PostgreSQL + pgvector + pgcrypto            │
└──────────────────────────────────────────────────────────┘
```

## 功能特性

- **多租户隔离**：通过 `org_id` / `user_id` / `project_id` 进行作用域隔离
- **运行时执行引擎**：支持队列、检查点、挂起与恢复
- **事件溯源 + SSE**：完整可追踪，支持实时事件流
- **三层记忆**：Core / Episodic / Archival，结合向量检索与全文检索
- **团队编排**：角色、分组、黑板记忆、swarm 依赖关系
- **HITL 审批**：高风险工具调用走 `waiting` / `suspended` 审批流
- **工具生态**：
  - memory（`memory_search/get/write/list/delete`）
  - file（`read/write/list/glob/grep/delete/move/search_replace`）
  - coding（`exec_command`、`apply_patch`）
  - export / routing / escalation / skill 工具
- **集成能力**：Feishu 连接器、MinerU 批量 PDF 导入
- **多模型支持**：OpenAI、Anthropic、Gemini 统一配置
- **三种接口**：Web UI、CLI、REST API

## 技术栈

| 层 | 技术 |
|----|------|
| Backend | Node.js 20+ / TypeScript / Express |
| Database | PostgreSQL 15+ / pgvector / pgcrypto |
| Frontend | React 18 / TypeScript / Vite |
| MCP Server | Python 3.9+（stdio 协议） |
| 校验 | Zod |
| 测试 | Vitest / Playwright / pytest |

## 快速开始

### 前置要求

- Node.js >= 20，pnpm >= 8
- PostgreSQL >= 15，并启用 `vector` 与 `pgcrypto` 扩展
- Python >= 3.9（仅在使用 MCP 工具时需要）

### 安装

```bash
# Backend + CLI
pnpm install

# Frontend
pnpm --dir web install

# Python MCP（可选）
cd python && pip3 install -e . && cd ..
```

### 配置

```bash
# 必填：PostgreSQL 连接串
export DATABASE_URL='postgres://user:pass@127.0.0.1:5432/openintern'

# 可选：模型服务密钥
export OPENAI_API_KEY='...'
# 或
export ANTHROPIC_API_KEY='...'

# 可选：启用 MinerU 导入
export MINERU_ENABLED='true'
export MINERU_API_KEY='your_mineru_key'

# 生成配置文件模板
pnpm cli init
```

首次启动会自动执行数据库迁移。

### 运行

```bash
# Backend（开发模式，默认 3000 端口）
pnpm cli dev

# Frontend（新终端，默认 5173 端口）
pnpm --dir web dev
```

Docker Compose 示例见 `docker-compose.example.yml`。

## CLI

```bash
pnpm cli init                               # 生成 agent.config.json
pnpm cli dev                                # 启动开发服务
pnpm cli run "your prompt" --session demo   # 创建并执行 run
pnpm cli run "your prompt" --stream         # 在终端实时输出事件
pnpm cli tail <run_id>                      # 跟踪 run 事件
pnpm cli export <run_id> --format json      # 导出 trace
pnpm cli skills list                        # 列出已注册 skill
pnpm cli doctor                             # 健康和依赖检查
```

## Web UI

| 页面 | 路径 | 说明 |
|------|------|------|
| Playground | `/` | 对话与任务执行 |
| Dashboard | `/dashboard` | 运行时健康与指标 |
| Approvals Inbox | `/inbox` | 人工审批队列 |
| PA Emulator | `/emulator` | IM 路由模拟与追踪 |
| Runs | `/runs` | 运行历史与状态 |
| Trace | `/trace/:runId` | 步骤/事件时间线 |
| Swarm Studio | `/orchestrator` | 角色、分组、编排管理 |
| Blackboard | `/blackboard` / `/blackboard/:groupId` | 团队共享记忆板 |
| Skills | `/skills` | Skill 注册表管理 |
| Group Run | `/group-run/:runId` | Group Run 汇总视图 |
| PDF Ingest | `/ingest` | MinerU 批量 PDF 导入 |

## API

业务接口统一位于 `/api`。

### 多租户作用域

通过 HTTP Header 传递租户范围：

```bash
curl -H "x-org-id: my-org" \
     -H "x-user-id: my-user" \
     -H "x-project-id: my-project" \
     http://localhost:3000/api/runs
```

CLI 对应环境变量：`AGENT_ORG_ID`、`AGENT_USER_ID`、`AGENT_PROJECT_ID`。

### 健康检查

```
GET    /health
```

### Runs

```
POST   /api/runs
GET    /api/runs/:run_id
GET    /api/sessions/:session_key/runs
GET    /api/runs/:run_id/events
GET    /api/runs/:run_id/stream
GET    /api/runs/:run_id/children
GET    /api/runs/:run_id/swarm
POST   /api/runs/:run_id/inject
POST   /api/runs/:run_id/cancel
POST   /api/runs/:run_id/approve
POST   /api/runs/:run_id/reject
```

### Roles

```
POST   /api/roles
GET    /api/roles
GET    /api/roles/:role_id
PUT    /api/roles/:role_id
DELETE /api/roles/:role_id
GET    /api/roles/:role_id/stats
POST   /api/roles/batch-delete
```

### Groups

```
POST   /api/groups
GET    /api/groups
POST   /api/groups/assign-project
GET    /api/groups/:group_id
PUT    /api/groups/:group_id
DELETE /api/groups/:group_id
GET    /api/groups/:group_id/stats
GET    /api/groups/:group_id/runs
POST   /api/groups/:group_id/members
GET    /api/groups/:group_id/members
PUT    /api/groups/:group_id/members/:member_id
DELETE /api/groups/:group_id/members/:member_id
POST   /api/groups/:group_id/runs
POST   /api/groups/batch-delete
```

### Blackboard 与 Skills

```
GET    /api/groups/:groupId/blackboard
GET    /api/groups/:groupId/blackboard/:memoryId
POST   /api/groups/:groupId/blackboard

POST   /api/skills
GET    /api/skills
GET    /api/skills/:skill_id
DELETE /api/skills/:skill_id
```

### 上传与集成接口

```
POST   /api/uploads
GET    /api/uploads/:upload_id

POST   /api/feishu/connectors
GET    /api/feishu/connectors
GET    /api/feishu/connectors/:connector_id
PATCH  /api/feishu/connectors/:connector_id
POST   /api/feishu/connectors/:connector_id/sync
GET    /api/feishu/connectors/:connector_id/jobs

POST   /api/mineru/ingest-batch
GET    /api/mineru/ingest-batch/:jobId/progress
GET    /api/mineru/ingest-batch/:jobId
```

### 事件类型（节选）

| 类型 | 说明 |
|------|------|
| `run.started` / `run.completed` / `run.failed` | Run 生命周期 |
| `step.started` / `step.completed` | 步骤执行 |
| `llm.called` / `llm.token` | LLM 调用与流式 token |
| `tool.called` / `tool.result` / `tool.blocked` | 工具调用生命周期 |
| `tool.requires_approval` | 请求人工审批 |
| `message.task` / `message.proposal` / `message.decision` | 编排消息 |

## MinerU 批量 PDF 导入

先启用 MinerU（`MINERU_ENABLED=true` 且配置 `MINERU_API_KEY`），然后可一次导入多个 PDF：

```bash
curl -X POST "http://localhost:3000/api/mineru/ingest-batch" \
  -H "x-org-id: my-org" \
  -H "x-user-id: my-user" \
  -H "x-project-id: my-project" \
  -F "file=@./docs/spec-a.pdf" \
  -F "file=@./docs/spec-b.pdf" \
  -F "enable_table=true" \
  -F "enable_formula=true"
```

接口会返回 `job_id`。可通过 SSE 订阅进度：

```bash
curl "http://localhost:3000/api/mineru/ingest-batch/<job_id>/progress"
```

## 配置

配置优先级：配置文件 < 环境变量 < CLI 参数 < API 请求参数。

### 关键环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DATABASE_URL` | PostgreSQL 连接串 | （必填） |
| `PORT` | Backend 端口 | `3000` |
| `DATA_DIR` | 运行时数据目录 | `data` |
| `LLM_PROVIDER` | `openai` / `anthropic` / `gemini` / `mock` | 来自配置 |
| `LLM_MODEL` | 模型名 | 各 provider 默认 |
| `LLM_API_KEY` | 统一 provider 密钥 | — |
| `OPENAI_API_KEY` | OpenAI 兼容密钥 | — |
| `ANTHROPIC_API_KEY` | Anthropic 兼容密钥 | — |
| `EMBEDDING_PROVIDER` | `hash` / `api` | `hash` |
| `FEISHU_ENABLED` | 是否启用 Feishu 连接器同步 | `false` |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | Feishu 应用凭证 | — |
| `FEISHU_POLL_INTERVAL_MS` | 连接器轮询周期 | `120000` |
| `MINERU_ENABLED` | 是否启用 MinerU 导入 | `false` |
| `MINERU_API_KEY` | MinerU API token/AK-SK | — |
| `MINERU_BASE_URL` | MinerU API 地址 | `https://mineru.net/api/v4` |
| `MINERU_POLL_INTERVAL_MS` | MinerU 任务轮询间隔 | `3000` |
| `MINERU_MAX_POLL_ATTEMPTS` | 单文件最大轮询次数 | `120` |
| `MINERU_DEFAULT_MODEL_VERSION` | `pipeline` / `vlm` / `MinerU-HTML` | `pipeline` |
| `VITE_API_PROXY_TARGET` | 前端开发代理目标 | — |

## 项目结构

```
src/
├── backend/
│   ├── api/              # Express 路由处理
│   ├── agent/            # LLM 客户端 + MCP 客户端
│   ├── db/               # PostgreSQL 连接池、迁移、Schema
│   ├── queue/            # Run 队列
│   ├── runtime/          # 执行器、工具、编排、集成
│   └── store/            # 事件、记忆、向量数据访问
├── cli/                  # CLI 命令
├── config/               # 配置加载
├── types/                # 共享 schema/type
└── utils/                # ID、错误、日志
web/
├── src/
│   ├── api/              # REST 客户端 + SSE 客户端
│   ├── components/       # React 组件
│   ├── pages/            # 路由页面
│   ├── hooks/            # 自定义 hooks
│   ├── context/          # Context provider
│   └── i18n/             # 国际化
└── e2e/                  # Playwright 测试
python/                   # 可选 MCP Server
```

## 开发

```bash
# 类型检查
pnpm typecheck
pnpm --dir web typecheck

# Lint
pnpm lint
pnpm --dir web lint

# Backend 测试
pnpm test

# Frontend 测试
pnpm --dir web test

# E2E（先安装浏览器）
pnpm --dir web exec playwright install chromium
pnpm --dir web test:e2e

# Python MCP 测试
cd python && pytest
```

## 故障排查

| 问题 | 解决方案 |
|------|----------|
| `DATABASE_URL is required` | 设置 `export DATABASE_URL='postgres://...'` |
| `CREATE EXTENSION vector` 权限错误 | 让 DBA 预先安装 `vector` 与 `pgcrypto` |
| SSE 返回 400/404 | 确认 `org/user/project` 请求头与 run 作用域一致 |
| MCP 工具不可用 | 执行 `cd python && pip3 install -e .` |
| MinerU 返回 `MinerU is not enabled` | 设置 `MINERU_ENABLED=true` 且配置有效 `MINERU_API_KEY` |

## 许可证

TBD
