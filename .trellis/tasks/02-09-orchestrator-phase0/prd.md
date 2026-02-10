# Phase 0: 角色化编排系统 - 模型与协议奠基

## 目标

把"角色/团队/项目"的概念落到数据模型与事件协议里，保持现有单 agent MVP 可用。
这是 Orchestrator PRD 的第一阶段，为后续串行编排（Phase 1）打基础。

## 需求

### 1. 数据模型（Postgres）

新增以下表：

- `roles` - 角色模板（prompt、默认 skills、风格约束）
- `projects` - 项目空间（将现有 project_id 软引用落表）
- `groups` - 团队（project_id 下）
- `group_members` - group 内成员（role_id → agent_instance_id）
- `agent_instances` - 角色在项目中的实例（role_id + project_id）

### 2. 事件协议扩展

events.payload 增加可选字段：
- `group_id` - 团队 ID
- `message_type` - 结构化消息类型
- `to_agent_id` - 目标 agent
- `artifact_refs` - 产物引用

定义结构化消息类型：
- `TASK` - {goal, inputs, expected_output, constraints, priority}
- `PROPOSAL` - {plan, risks, dependencies, evidence_refs}
- `DECISION` - {decision, rationale, next_actions, evidence_refs}
- `EVIDENCE` - {refs:[{type,id}...], summary}
- `STATUS` - {state, progress, blockers}

### 3. API（最小闭环）

- `POST /api/roles` / `GET /api/roles` - 角色 CRUD
- `POST /api/groups` / `GET /api/groups` / `GET /api/groups/:id` - 团队 CRUD
- `POST /api/groups/:id/members` - 添加成员
- `POST /api/groups/:id/runs` - 启动 group run（先复用现有 /runs 逻辑，附带 group_id）

## 验收标准

- [ ] DB: roles/groups/group_members/agent_instances 表创建成功
- [ ] API: 能创建 role 并查询
- [ ] API: 能创建 group 并把 2~3 个 roles 加入
- [ ] API: 启动 group run 后，events 里能看到 group_id + message_type 字段
- [ ] 现有单 agent 主链路不受影响（向后兼容）
- [ ] TypeScript strict mode 通过
- [ ] ESLint 通过

## 技术说明

### 可复用组件

| 组件 | 路径 | 用途 |
|------|------|------|
| Postgres 连接池 | `src/backend/db/postgres.ts` | 数据库连接 |
| Schema 定义 | `src/backend/db/schema.ts` | 幂等 migration |
| EventService | `src/backend/runtime/event-service.ts` | 事件写入 |
| RunRepository | `src/backend/runtime/run-repository.ts` | Run CRUD |
| SSEManager | `src/backend/api/sse.ts` | 实时推送 |

### 新增文件规划

```
src/types/orchestrator.ts          # 角色/团队/消息协议类型
src/backend/db/schema.ts           # 扩展现有 schema（新增表）
src/backend/runtime/role-repository.ts    # Role CRUD
src/backend/runtime/group-repository.ts   # Group/Member CRUD
src/backend/api/roles.ts           # Roles API 路由
src/backend/api/groups.ts          # Groups API 路由
```
