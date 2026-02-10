# Phase 2: 角色绑定 Skills + 权限与审批

## 目标

让不同角色拥有不同的工具/权限；高风险工具必须审批或阻断。实现真正的"岗位边界"。

## 需求

### 1. Skill Registry（技能注册中心）

- 统一注册 MCP 和 local 工具，每个 skill 包含：skill_id、工具列表、schema、risk_level、provider
- risk_level 分级：`low`（只读）、`medium`（可写但可逆）、`high`（不可逆/外部副作用）
- provider 类型：`builtin` | `mcp`
- MCP tools/list 结果缓存，避免每次 refreshMcpTools 都重新请求
- 健康检查：记录 MCP server 在线状态

### 2. Role-Tool Policy（角色工具策略）

- 利用 Role 已有的 `allowed_tools` / `denied_tools` 字段（已定义但未使用）
- Policy 引擎根据 role 配置 + skill risk_level 判断权限
- 策略优先级：denied_tools（黑名单）> allowed_tools（白名单）> risk_level 默认策略
- 默认策略：allowed_tools 为空时，允许 low/medium 风险工具，阻断 high 风险工具

### 3. ToolRouter 权限检查 + 审批 Hook

- `callTool()` 接收 agent 上下文（agent_id, role）
- 调用前检查 policy：
  - 不允许 → 发射 `tool.blocked` 事件，返回错误结果
  - 需审批 → 发射 `tool.requires_approval` 事件（本阶段先做阻断，审批 UI 后续迭代）
- AgentRunner 的 `handleToolCalls()` 处理 blocked 返回

### 4. Skills REST API

- `POST /api/skills` — 注册 skill
- `GET /api/skills` — 列出所有 skills
- `GET /api/skills/:id` — 获取 skill 详情
- `GET /api/skills/:id/health` — 健康检查

### 5. 数据库

- 新增 `skills` 表：id, name, description, tools (JSONB), risk_level, provider, health_status, created_at, updated_at

## 验收标准

- [ ] Skill Registry 可注册和查询 builtin/mcp 工具
- [ ] Role 的 allowed_tools/denied_tools 在运行时生效
- [ ] 同一工具：Researcher 可调用，Critic 被阻断（可回放可解释）
- [ ] tool.blocked 事件正确写入 events 表
- [ ] tool.requires_approval 事件类型已定义（本阶段先阻断）
- [ ] Skills CRUD API 可用
- [ ] TypeScript strict mode 通过
- [ ] ESLint 通过

## 技术说明

### 新增文件

```
src/types/skill.ts                          # Skill 类型定义
src/backend/runtime/skill-registry.ts       # Skill Registry 核心
src/backend/runtime/skill-repository.ts     # Skill DB CRUD
src/backend/runtime/tool-policy.ts          # Role-Tool Policy 引擎
src/backend/api/skills.ts                   # Skills REST API
```

### 修改文件

```
src/types/events.ts                         # 新增 tool.blocked / tool.requires_approval
src/types/orchestrator.ts                   # 可能微调 Role 类型
src/backend/db/schema.ts                    # 新增 skills 表
src/backend/runtime/tool-router.ts          # 核心：加入权限检查
src/backend/runtime/role-runner-factory.ts  # 传递工具策略给 runner
src/backend/runtime/agent-runner.ts         # 处理 blocked 返回
src/backend/runtime/executor.ts             # 集成 skill registry
src/backend/server.ts                       # 注册 skills 路由
src/utils/ids.ts                            # 新增 generateSkillId()
```

### 架构要点

- ToolPolicy 是独立模块，不耦合 ToolRouter 内部实现
- callTool() 新增可选的 agentContext 参数，保持向后兼容
- 无 agentContext 时跳过权限检查（兼容单 agent 模式）
