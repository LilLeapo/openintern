# OpenIntern

一个生产级的多租户 Agent Runtime 系统，提供完整的 Agent 执行、追踪、编排和记忆管理能力。

## ✨ 核心特性

### 🎯 多租户架构
- 完整的租户隔离机制（org_id / user_id / project_id）
- 灵活的 scope 传递方式（Header / Body / Query）
- 独立的数据空间和权限控制

### 🔄 Run 执行引擎
- 完整的 run 生命周期管理（创建、排队、执行、取消）
- 串行执行队列，保证资源可控
- Step 级别的 checkpoint，支持执行恢复
- 实时事件追踪和 SSE 流式推送

### 🧠 智能记忆系统
- 三层记忆架构：Core（核心）/ Episodic（情景）/ Archival（归档）
- pgvector + Postgres FTS 混合检索
- 自动记忆管理和知识沉淀
- 支持 Feishu 文档同步和 MinerU PDF 摄入

### 👥 团队协作编排
- 角色（Role）和团队（Group）管理
- 可视化团队管理控制台
- 串行编排器（SerialOrchestrator）
- 黑板（Blackboard）协作机制
- 角色级工具权限控制

### 🛠️ 工具生态
- 内置工具：记忆读写、文件操作、trace 导出
- MCP 协议支持（stdio）
- 工具策略（ToolPolicy）：allow/block 规则
- 高风险操作自动阻断

### 🎨 完整的使用界面
- **Web UI**：现代化的 React 应用
  - 对话界面（Chat）
  - 执行历史（Runs）
  - 轨迹追踪（Trace）
  - 团队管理（Team Management）
  - 黑板协作（Blackboard）
- **CLI**：强大的命令行工具
- **REST API**：完整的 HTTP 接口

## 🏗️ 系统架构

```text
┌─────────────────────────────────────────────────────────────┐
│                        Web UI (React)                        │
│              Chat / Runs / Trace / Team / Blackboard        │
└────────────────────────┬────────────────────────────────────┘
                         │ REST + SSE
┌────────────────────────┴────────────────────────────────────┐
│                    Backend (Express)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  Run Queue   │  │   Runtime    │  │  Orchestrator│     │
│  │  (Serial)    │→ │   Executor   │→ │  (Serial)    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────┴────────────────────────────────────┐
│                    PostgreSQL + pgvector                     │
│  runs / events / checkpoints / memories / roles / groups    │
└─────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────┴────────────────────────────────────┐
│              Optional: MCP Server (Python)                   │
└─────────────────────────────────────────────────────────────┘
```

### 执行流程

**单 Agent 执行：**
1. `POST /api/runs` 创建 run（pending）并入队
2. 队列串行执行 run（running）
3. Agent step 循环：
   - `step.started` → `llm.called` → `tool.called/result` → `step.completed`
4. 每 step 写入 checkpoint
5. 结束时写入 `run.completed` 或 `run.failed`
6. 所有事件实时落库并通过 SSE 推送

**团队协作执行：**
1. `POST /api/groups/:group_id/runs` 创建团队 run
2. Runtime 根据团队成员创建多角色 runner
3. 串行编排：非 lead 角色 → lead 角色汇总
4. Lead 产出 `message.decision`
5. 自动生成 episodic 黑板记忆

## 🚀 快速开始

### 环境要求

- Node.js >= 20
- pnpm >= 8
- PostgreSQL >= 15（需要 `vector` 扩展）
- Python >= 3.9（仅 MCP 需要）

### 安装步骤

1. **安装依赖**

```bash
# 后端和 CLI
pnpm install

# 前端
pnpm --dir web install

# Python MCP（可选）
cd python && pip3 install -e . && cd ..
```

2. **配置数据库**

```bash
export DATABASE_URL='postgres://openintern:openintern@127.0.0.1:5432/openintern'
```

可选：使用 Docker Compose 快速启动数据库（参考 `docker-compose.example.yml`）

首次启动时会自动执行数据库迁移（表、索引、扩展）。

3. **启动服务**

```bash
# 启动后端（开发模式）
pnpm cli dev

# 启动前端（新终端）
pnpm --dir web dev
```

4. **访问应用**

- 后端 API: http://localhost:3000
- Web UI: http://localhost:5173

## 📖 使用指南

### CLI 命令

```bash
# 初始化配置
pnpm cli init

# 启动开发服务器
pnpm cli dev

# 发起 run
pnpm cli run "帮我写一个 TypeScript 函数" --session demo

# 流式观察
pnpm cli run "解释这段代码" --stream
pnpm cli tail run_xxx

# 导出 trace
pnpm cli export run_xxx --format json

# 查看技能列表
pnpm cli skills list

# 健康检查
pnpm cli doctor
```

### Web 界面

| 页面 | 路径 | 功能 |
|------|------|------|
| 对话 | `/` | 与 Agent 交互，发起 run |
| 执行历史 | `/runs` | 查看所有 run 记录 |
| 轨迹追踪 | `/trace/:runId` | 详细的 run 执行轨迹 |
| 团队管理 | `/orchestrator` | 管理角色和团队 |
| 黑板协作 | `/blackboard/:groupId` | 团队协作黑板 |
| 技能管理 | `/skills` | 管理可用技能 |

### 多租户配置

通过 HTTP Header 传递租户信息（推荐）：

```bash
curl -H "x-org-id: my-org" \
     -H "x-user-id: my-user" \
     -H "x-project-id: my-project" \
     http://localhost:3000/api/runs
```

CLI 默认使用环境变量：
- `AGENT_ORG_ID`（默认 `org_default`）
- `AGENT_USER_ID`（默认 `user_default`）
- `AGENT_PROJECT_ID`（可选）

## 🔌 API 接口

### Runs 管理

```bash
# 创建 run
POST /api/runs

# 查询 run
GET /api/runs/:run_id

# 查询 session 的 runs
GET /api/sessions/:session_key/runs?page=1&limit=20

# 查询 run 事件
GET /api/runs/:run_id/events?cursor=0&limit=100&type=llm.called

# SSE 流式订阅
GET /api/runs/:run_id/stream

# 取消 run
POST /api/runs/:run_id/cancel
```

### 角色和团队

```bash
# 角色管理
POST   /api/roles                    # 创建角色
GET    /api/roles                    # 列出角色
GET    /api/roles/:role_id           # 查询角色
PUT    /api/roles/:role_id           # 更新角色
DELETE /api/roles/:role_id           # 删除角色
GET    /api/roles/:role_id/stats     # 角色统计
POST   /api/roles/batch-delete       # 批量删除

# 团队管理
POST   /api/groups                   # 创建团队
GET    /api/groups                   # 列出团队
GET    /api/groups/:group_id         # 查询团队
PUT    /api/groups/:group_id         # 更新团队
DELETE /api/groups/:group_id         # 删除团队
GET    /api/groups/:group_id/stats   # 团队统计
GET    /api/groups/:group_id/runs    # 团队执行历史
POST   /api/groups/batch-delete      # 批量删除

# 团队成员
POST   /api/groups/:group_id/members           # 添加成员
GET    /api/groups/:group_id/members           # 列出成员
PUT    /api/groups/:group_id/members/:member_id  # 更新成员
DELETE /api/groups/:group_id/members/:member_id  # 删除成员

# 团队执行
POST   /api/groups/:group_id/runs    # 创建团队 run
```

### 黑板协作

```bash
GET  /api/groups/:groupId/blackboard              # 列出黑板记忆
GET  /api/groups/:groupId/blackboard/:memoryId    # 查询记忆详情
POST /api/groups/:groupId/blackboard              # 创建黑板记忆
```

### 技能管理

```bash
POST   /api/skills              # 创建技能
GET    /api/skills              # 列出技能
GET    /api/skills/:skill_id    # 查询技能
DELETE /api/skills/:skill_id    # 删除技能
```

### Feishu 连接器

```bash
POST  /api/feishu/connectors                      # 创建连接器
GET   /api/feishu/connectors                      # 列出连接器
GET   /api/feishu/connectors/:connector_id        # 查询连接器
PATCH /api/feishu/connectors/:connector_id        # 更新连接器
POST  /api/feishu/connectors/:connector_id/sync   # 触发同步
GET   /api/feishu/connectors/:connector_id/jobs   # 查询同步任务
```

详细文档：`docs/api/feishu-connectors.md`

### 事件类型

| 类型 | 说明 |
|------|------|
| `run.started` / `run.completed` / `run.failed` | Run 生命周期 |
| `step.started` / `step.completed` | Step 执行 |
| `llm.called` / `llm.token` | LLM 调用 |
| `tool.called` / `tool.result` / `tool.blocked` | 工具调用 |
| `message.task` / `message.proposal` / `message.decision` | 编排消息 |
| `message.evidence` / `message.status` | 协作消息 |

## ⚙️ 配置说明

### 配置文件

使用 `pnpm cli init` 生成 `agent.config.json`。

配置优先级：配置文件 < 环境变量 < CLI 参数 < API 请求参数

### 常用环境变量

**基础配置：**
- `DATABASE_URL` - PostgreSQL 连接字符串
- `PORT` - 后端服务端口（默认 3000）
- `DATA_DIR` - 数据目录路径

**LLM 配置：**
- `LLM_PROVIDER` - LLM 提供商（openai / anthropic / gemini）
- `LLM_MODEL` - 模型名称
- `LLM_API_KEY` - API 密钥
- `OPENAI_API_KEY` - OpenAI API 密钥
- `ANTHROPIC_API_KEY` - Anthropic API 密钥

**前端配置：**
- `VITE_API_PROXY_TARGET` - API 代理目标
- `VITE_ORG_ID` / `VITE_USER_ID` / `VITE_PROJECT_ID` - 默认租户信息

**Feishu 配置：**
- `FEISHU_ENABLED` - 是否启用 Feishu 连接器
- `FEISHU_APP_ID` - Feishu 应用 ID
- `FEISHU_APP_SECRET` - Feishu 应用密钥

**MinerU 配置：**
- `MINERU_ENABLED` - 是否启用 MinerU PDF 摄入
- `MINERU_MODE` - 模式（v4）
- `MINERU_API_KEY` - API 密钥
- `MINERU_BASE_URL` - API 基础 URL
- `MINERU_UID_TOKEN` - UID Token

### Feishu 连接器配置

在 `agent.config.json` 中添加：

```json
{
  "feishu": {
    "enabled": true,
    "appId": "cli_xxx",
    "appSecret": "xxxx",
    "baseUrl": "https://open.feishu.cn",
    "timeoutMs": 20000,
    "maxRetries": 3,
    "pollIntervalMs": 120000
  }
}
```

**说明：**
- Connector 按 `org_id + project_id` 绑定
- 同步内容写入 `archival` 记忆层
- 支持文档、知识库、云空间同步

### MinerU PDF 摄入配置

在 `agent.config.json` 中添加：

```json
{
  "mineru": {
    "enabled": true,
    "mode": "v4",
    "apiKey": "your_api_token",
    "baseUrl": "https://mineru.net/api/v4",
    "timeoutMs": 20000,
    "maxRetries": 3,
    "pollIntervalMs": 3000,
    "maxPollAttempts": 120,
    "defaultModelVersion": "pipeline"
  }
}
```

**说明：**
- 运行时工具 `mineru_ingest_pdf` 使用该配置
- 支持 URL 和本地文件路径
- 结果写入 `archival` 知识层

## 🧪 开发与测试

### 代码检查

```bash
# TypeScript 类型检查
pnpm typecheck
pnpm --dir web typecheck

# 代码风格检查
pnpm lint
pnpm --dir web lint
```

### 后端测试

```bash
export DATABASE_URL='postgres://openintern:openintern@127.0.0.1:5432/openintern'
pnpm exec vitest run
```

### 前端测试

```bash
pnpm --dir web test
```

### E2E 测试

首次需要安装浏览器：

```bash
pnpm --dir web exec playwright install chromium
```

运行 E2E 测试：

```bash
export DATABASE_URL='postgres://openintern:openintern@127.0.0.1:5432/openintern'
pnpm --dir web test:e2e
```

### Python MCP 测试

```bash
cd python && pytest
```

## 📁 项目结构

```text
openintern/
├── src/
│   ├── backend/
│   │   ├── api/           # HTTP 路由和控制器
│   │   ├── db/            # 数据库连接和迁移
│   │   ├── runtime/       # 执行引擎和编排器
│   │   ├── queue/         # Run 队列管理
│   │   └── agent/         # LLM 和 MCP 适配器
│   ├── cli/               # 命令行工具
│   └── types/             # 共享类型定义
├── web/                   # React 前端应用
│   ├── src/
│   │   ├── components/    # React 组件
│   │   ├── pages/         # 页面组件
│   │   ├── hooks/         # 自定义 Hooks
│   │   └── api/           # API 客户端
│   └── e2e/               # Playwright E2E 测试
├── python/                # MCP Server（可选）
├── docs/                  # 文档
└── agent.config.json      # 配置文件
```

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js + TypeScript + Express |
| 数据库 | PostgreSQL + pgvector + FTS |
| 前端 | React + TypeScript + Vite |
| MCP | Python（stdio 协议）|
| 测试 | Vitest + Playwright + pytest |
| 类型 | Zod（运行时验证）|

## ⚠️ 已知限制

- `runs.group_id`、`events.group_id/message_type` 列已预留，但仓储层尚未完全贯通
- `tool.requires_approval` 事件类型已定义，审批闭环接口尚未实现
- Web Trace 页面的结构化 message 事件可视化还较基础

## ❓ 常见问题

### 启动时报 `DATABASE_URL is required`

设置数据库连接字符串：

```bash
export DATABASE_URL='postgres://openintern:openintern@127.0.0.1:5432/openintern'
```

### `CREATE EXTENSION vector` 权限错误

数据库用户需要有创建扩展的权限，或由 DBA 预先安装 `vector` 和 `pgcrypto` 扩展。

### SSE 返回 400/404

通常是 scope 不匹配：查询 run 时的 `org/user/project` 与创建 run 时不一致。

### MCP 工具不可用

确认已安装 Python 包并启用 MCP：

```bash
cd python && pip3 install -e .
pnpm cli dev --mcp-stdio
```

### 团队管理页面显示空白

检查：
1. 后端服务是否正常运行
2. 数据库连接是否正常
3. 浏览器控制台是否有错误
4. 租户信息（org_id/user_id）是否正确

## 🔒 安全建议

- ⚠️ 不要将 API Key 提交到代码仓库
- ✅ 使用环境变量管理敏感信息
- ✅ 生产环境使用强密码和 SSL 连接
- ✅ 定期更新依赖包
- ✅ 启用工具策略（ToolPolicy）限制高风险操作

## 📄 许可证

[添加你的许可证信息]

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📮 联系方式

[添加你的联系方式]
