# OpenIntern 开发进度报告（截至 2026-02-10）

更新日期：2026-02-10  
代码基线：`main`（最近关键提交：`01715fe`、`b98a464`、`ef64e91`）

---

## 1. 执行摘要

当前仓库已从单体 MVP 发展为：

- Postgres 持久化运行时（Run/Event/Checkpoint/Memory）
- 多租户 scope 隔离（`org_id/user_id/project_id`）
- 串行多角色编排（Orchestrator，Phase 1）
- 角色工具权限与 Skills 注册（Phase 2）
- 共享黑板 + 私有记忆分层检索 + episodic 自动生成（Phase 3）
- Web 端 Chat/Runs/Trace/Blackboard 页面

整体状态：**主链路可运行，可测试，phase0-phase3 核心代码已落地；仍有若干集成与治理项待收口。**

---

## 2. 已完成能力总览

### 2.1 Backend Runtime 与存储

- Postgres 连接与迁移：
  - `src/backend/db/postgres.ts`
  - `src/backend/db/schema.ts`
- 数据表：
  - `runs/events/checkpoints/memories/memory_chunks`
  - 编排扩展：`roles/groups/group_members/agent_instances/skills`
- 运行时服务：
  - `RunRepository` / `EventService` / `CheckpointService` / `MemoryService`
  - 队列执行器 `RunQueue` + runtime executor

### 2.2 Agent 执行主循环

- 单 Agent Runner：
  - `src/backend/runtime/agent-runner.ts`
- Step 流程：
  - `step.started -> memory_search(_tiered) -> llm.called -> tool.called/tool.result -> checkpoint -> step.completed -> run.completed/failed`
- SSE 实时流：
  - `src/backend/api/sse.ts`

### 2.3 工具系统与 MCP

- Runtime ToolRouter：
  - `src/backend/runtime/tool-router.ts`
- 内置工具：
  - `memory_search` / `memory_get` / `memory_write` / `read_file` / `export_trace`
- MCP 工具接入与协议测试：
  - `src/backend/agent/mcp-client.ts`
  - `src/backend/runtime/mcp-tool-router.protocol.test.ts`

### 2.4 API 层

- Runs：
  - `POST /api/runs`
  - `GET /api/runs/:run_id`
  - `GET /api/sessions/:session_key/runs`
  - `GET /api/runs/:run_id/events`
  - `GET /api/runs/:run_id/stream`
  - `POST /api/runs/:run_id/cancel`
- Orchestrator 相关：
  - `POST/GET /api/roles`
  - `POST/GET /api/groups`
  - `POST/GET /api/groups/:group_id/members`
  - `POST /api/groups/:group_id/runs`
- Skills：
  - `POST/GET/DELETE /api/skills`
- Blackboard：
  - `GET /api/groups/:groupId/blackboard`
  - `GET /api/groups/:groupId/blackboard/:memoryId`
  - `POST /api/groups/:groupId/blackboard`

### 2.5 Web 与 CLI

- Web 页面：
  - Chat：`/`
  - Runs：`/runs`
  - Trace：`/trace/:runId`
  - Blackboard：`/blackboard/:groupId`
- CLI：
  - `agent dev/run/tail/export/doctor`
  - `agent skills list`

---

## 3. Orchestrator PRD Phase 状态

### Phase 0：模型与协议奠基

已完成：

- 角色/团队/成员/实例/技能表结构已在 schema 中定义
- `roles/groups` API 已落地
- 事件类型与结构化消息 schema（`TASK/PROPOSAL/DECISION/EVIDENCE/STATUS`）已定义

待补齐/偏差：

- `events` 表虽已扩展 `group_id/message_type` 列，但 `RunRepository.appendEvent/getRunEvents` 尚未贯通这两列读写（当前主要写入标准事件字段）
- `runs.group_id` 列已存在，但 `RunRepository.createRun` 仍未写入该列

### Phase 1：串行编排 Orchestrator

已完成：

- 串行调度器：
  - `src/backend/runtime/orchestrator.ts`
- Group run 执行入口：
  - `src/backend/runtime/executor.ts`
- Role -> Runner 工厂：
  - `src/backend/runtime/role-runner-factory.ts`
- Lead 汇总输出 `message.decision`

待补齐/偏差：

- Runner 侧结构化消息目前以常规事件为主，自动输出 `PROPOSAL/EVIDENCE/STATUS` 的完整协议闭环仍偏弱（当前明确可见的是 `message.decision`）

### Phase 2：Skills + 权限与审批

已完成：

- Skill 类型/仓储/注册中心：
  - `src/types/skill.ts`
  - `src/backend/runtime/skill-repository.ts`
  - `src/backend/runtime/skill-registry.ts`
- ToolPolicy + ToolRouter 权限拦截：
  - 支持 `allowed_tools/denied_tools/risk_level` 判定
  - 支持 `tool.blocked` 事件

待补齐/偏差：

- `tool.requires_approval` 事件类型已定义，但当前未看到实际发射逻辑（仍是“先阻断”路径）
- Skills API 目前无独立 `/api/skills/:id/health` 路由

### Phase 3：Blackboard + Personal Memory + 自动巩固

已完成：

- Memory scope 扩展：
  - `group_id` / `agent_instance_id`
- 分层检索：
  - `memory_search_tiered`（group -> project core -> personal episodic -> archival）
- 黑板写入策略：
  - lead 才可写 core/decision（`blackboard_write`）
- run 完成后自动生成 episodic：
  - `src/backend/runtime/episodic-generator.ts`
  - 在 executor 的 `run.completed` 分支触发
- Web 黑板面板已实现展示：
  - 共识（DECISION）/ TODO / EVIDENCE

待补齐/偏差：

- consolidation 后台任务尚未形成独立可调度模块（当前以 run 完成自动写入为主）
- 黑板页面入口存在，但 Chat 页面无直接导航到 Blackboard（需手动访问路由）

---

## 4. 测试与质量现状（2026-02-10 本地执行）

已执行命令与结果：

- `pnpm exec vitest run`
  - 结果：`21 passed | 5 skipped`（`241 passed | 31 skipped`）
- `pnpm --dir web exec vitest run`
  - 结果：`3 passed`（`9 passed`）
- `pnpm typecheck`：通过
- `pnpm --dir web typecheck`：通过
- `pnpm build`：通过
- `pnpm --dir web build`：通过
- `pnpm --dir web lint`：通过

受环境限制未完成：

- `pnpm --dir web test:e2e` 未通过（本机无可用 Postgres，报 `ECONNREFUSED 127.0.0.1:5432`）
- 多个后端集成测试文件在未设置 `DATABASE_URL` 时会 `skip`

当前质量风险：

- `pnpm lint`（backend）目前失败，约 35 个 lint 错误（未使用变量、测试规则等），不影响当前功能运行，但影响代码治理与 CI 稳定性

---

## 5. 主要缺口与风险清单

1. 编排字段落库链路未完全闭环  
`group_id/message_type` 在事件表层面已准备，但仓储读写未完整贯通，影响后续按字段检索与审计。

2. 审批链路仍是占位状态  
`tool.requires_approval` 未实际产出事件，审批 UI/流程无法实测。

3. 集成测试依赖数据库环境  
无 `DATABASE_URL` 时，关键 API 集成与 e2e 路径无法全量回归。

4. 编排协议测试不足  
roles/groups/blackboard/orchestrator 的端到端 DB 集成断言还不够系统化。

---

## 6. 下一步建议（按优先级）

1. 修复仓储层字段贯通  
为 `runs.group_id`、`events.group_id/message_type` 增加完整写入与读取映射，并补对应集成测试。

2. 落地审批事件与最小审批流  
在 ToolPolicy 判定中区分“阻断/需审批”，补 `tool.requires_approval` 发射与 trace 展示。

3. 建立可复现的 Postgres 测试基线  
在本地/CI 提供统一 DB 测试环境，取消关键集成测试 skip。

4. 收敛质量门槛  
清理 backend lint 错误，恢复 `lint + typecheck + test` 作为稳定发布门禁。

---

## 7. 结论

仓库已完成从“单 Agent MVP”到“具备多角色编排能力基础平台”的关键跃迁。  
Phase 0-3 的主干实现基本齐备，下一阶段重点应从“功能可用”转向“字段闭环、审批闭环、集成测试闭环与质量门禁闭环”。

