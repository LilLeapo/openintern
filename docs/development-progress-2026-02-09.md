# OpenIntern 开发情况与进度报告

更新日期：2026-02-09  
当前分支：`feat/postgres-runtime-memory`

## 1. 项目目标（本阶段）

本阶段目标是将系统从文件存储模式升级为：
- TS 后端（含 Agent Runtime）
- Web UI
- Python Skills（MCP）
- Memory / Trace / Checkpoint 全部落 Postgres
- 基于 `org_id/user_id/project_id(optional)` 的多租户隔离

## 2. 总体进度评估

按既定交付顺序评估：

1. Postgres schema + MemoryService：已完成
2. EventService + SSE：已完成
3. 单 Agent Loop（memory_search + model + tool）：已完成（MVP）
4. Web UI（chat + trace）联动新接口：已完成（基础联通）
5. MCP tools：已完成“可选接入”能力（按需启用）

当前阶段进度结论：**MVP 主链路已打通，可运行可测试。**

## 3. 已完成内容

### 3.1 数据库与存储层

- 新增 Postgres 连接与自动迁移
  - `src/backend/db/postgres.ts`
  - `src/backend/db/schema.ts`
  - `src/backend/db/index.ts`
- 落地核心表与索引
  - `runs` / `events` / `checkpoints` / `memories` / `memory_chunks`
  - `pgvector` 向量列 + `ivfflat` 索引
  - FTS `tsvector + GIN` 索引

### 3.2 运行时服务（Runtime）

- 新增 scope 隔离模型
  - `src/backend/runtime/scope.ts`
  - `src/backend/runtime/request-scope.ts`
- 新增 Run Repository / Event / Checkpoint / Memory 服务
  - `src/backend/runtime/run-repository.ts`
  - `src/backend/runtime/event-service.ts`
  - `src/backend/runtime/checkpoint-service.ts`
  - `src/backend/runtime/memory-service.ts`
- Memory 实现能力
  - `memory_write`：写 memories + chunk + embedding
  - `memory_search`：向量+FTS 混合召回、去重、返回 snippet
  - `memory_get`：按 scope 读取全文

### 3.3 Agent Runtime

- 新增 `AgentRunner` 抽象与单 Agent 实现
  - `src/backend/runtime/agent-runner.ts`
- 单 Agent 每 step 流程已落地
  - step.started -> memory_search -> LLM -> tool -> checkpoint -> step.completed
- 所有事件带 `agent_id`，为多 Agent 扩展预留

### 3.4 Tool Router

- 新增统一工具入口
  - `src/backend/runtime/tool-router.ts`
- 已实现工具
  - `memory_search`
  - `memory_get`
  - `memory_write`
  - `read_file`
  - `export_trace`
- MCP 能力
  - 支持可选启用 Python MCP 客户端并注册工具（runtime 按需启动）

### 3.5 API 与服务编排

- Runs API 切换到 Postgres 实现
  - `src/backend/api/runs.ts`
- 核心接口已可用
  - `POST /api/runs`
  - `GET /api/runs/:run_id`
  - `GET /api/sessions/:session_key/runs`
  - `GET /api/runs/:run_id/events?cursor&limit`
  - `GET /api/runs/:run_id/stream`
  - `POST /api/runs/:run_id/cancel`
- 服务入口接入 runtime executor
  - `src/backend/server.ts`

### 3.6 CLI / Web 适配

- CLI 请求自动带 scope（支持环境变量）
  - `src/cli/commands/run.ts`
  - `src/cli/commands/tail.ts`
  - `src/cli/commands/dev.ts`
- Web API / SSE 带 scope
  - `web/src/api/client.ts`
  - `web/src/api/sse.ts`
- 前端代理目标可配置（容器场景）
  - `web/vite.config.ts`（`VITE_API_PROXY_TARGET`）

### 3.7 文档与环境示例

- README 已重写并对齐当前架构
  - `README.md`
- 新增 Docker Compose 示例
  - `docker-compose.example.yml`

## 4. 类型与协议调整

- `CreateRunRequest` 增加 scope 字段（可由 Header/Body/Query 传入）
  - `src/types/api.ts`
- `GetRunEventsResponse` 增加 `next_cursor`
  - `src/types/api.ts`
- `RunStatus` 增加 `cancelled`
  - `src/types/run.ts`
- Memory 领域类型扩展
  - `src/types/memory.ts`
- 新增 scope 类型
  - `src/types/scope.ts`

## 5. 验证结果（2026-02-09）

已执行并通过：

- `pnpm typecheck`
- `pnpm --dir web typecheck`
- `pnpm exec vitest run`
  - 结果：`14 passed, 2 skipped`（文件级）
  - 说明：与 Postgres 强绑定的 API 集成测试在未设置 `DATABASE_URL` 时跳过
- `pnpm --dir web exec vitest run`
  - 结果：`3 passed`

## 6. 当前风险与限制

- API/Server 集成测试依赖真实 `DATABASE_URL`，本地无库时会被跳过，不能覆盖数据库集成回归。
- 多 Agent orchestration 目前仅完成接口预留，尚未实现 orchestrator 与多 runner 并发调度。
- Docker 示例目前偏开发态（bind mount + dev server），生产镜像与部署清单尚未落地。
- MCP 目前为可选接入；容器化一体部署时建议补 backend Dockerfile 与 Python 运行时镜像策略。

## 7. 建议下一步（按优先级）

1. 补齐 Postgres 集成测试环境（测试容器 + CI job），取消关键接口测试的 skip。
2. 增加多 Agent orchestrator（同 run_id、多 agent_id 事件汇聚）。
3. 增加生产向 Dockerfile / compose.prod / 部署文档（含迁移策略与健康检查）。
4. 继续完善 Memory 检索策略（重排、过滤、重要性加权、跨会话策略）。

