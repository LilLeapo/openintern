好，我们把“角色化编排系统”按**阶段（Phase）→任务（Tasks）→文档（Docs）**拆出来，尽量贴合你现在已有的基础（Postgres memory/trace/checkpoint、SSE、AgentRunner、ToolRouter、MCP 可选）。

下面这套计划默认目标是：**先做串行编排的多角色协作（可观测、可控、可扩展），再逐步上权限/黑板/并发。**

---

## 总体路线图

### Phase 0：模型与协议奠基（不改变现有单 agent 主链路）

**目标**：把“角色/团队/项目”的概念落到数据模型与事件协议里，保持现有单 agent MVP 可用。

**交付物**

* DB：Role / Project / Group / AgentInstance 等最小表
* 事件协议：TASK/PROPOSAL/DECISION/EVIDENCE/STATUS 等结构化消息
* API：创建 role/group、把 role 加入 group、启动 group run（先仍然只跑 main）

**任务清单**

1. **数据模型（Postgres）**

   * `roles`：角色模板（prompt、默认 skills、风格约束）
   * `projects`：项目空间（你已有 project_id 概念，可落表或先软引用）
   * `groups`：团队（project_id 下）
   * `group_members`：group 内成员（role_id → agent_instance_id）
   * `agent_instances`：角色在项目中的实例（role_id+project_id，保存偏好/状态）
2. **事件协议扩展**

   * events.payload 增加：`group_id`、`message_type`、`to_agent_id?`、`artifact_refs?`
   * 定义结构化消息类型：

     * `TASK {goal, inputs, expected_output, constraints, priority}`
     * `PROPOSAL {plan, risks, dependencies, evidence_refs}`
     * `DECISION {decision, rationale, next_actions, evidence_refs}`
     * `EVIDENCE {refs:[{type,id}...], summary}`
     * `STATUS {state, progress, blockers}`
3. **API（最小闭环）**

   * `POST /api/roles`、`GET /api/roles`
   * `POST /api/groups`、`POST /api/groups/:id/members`
   * `POST /api/groups/:id/runs`（先复用现有 /runs，只是附带 group_id）

**相关文档**

* `docs/concepts/roles-groups-projects.md`
* `docs/spec/events-message-protocol.md`
* `docs/api/groups-and-roles.md`

**DoD（完成定义）**

* 能创建 group 并把 2~3 个 roles 加入
* 启动 group run 后，events 里能看到 group_id + message_type 字段（即使只有 main 在跑）

---

### Phase 1：串行编排 Orchestrator（真正的多角色协作 MVP）

**目标**：一个 run 里多个 agent_id 轮流发言/执行，但**串行**，可回放、易调试、成本可控。

**交付物**

* `Orchestrator`：调度多个 `AgentRunner`（Lead/Researcher/Critic…）
* 同一 run_id 下汇聚多个 agent 的事件（按 agent_id 分泳道）
* Lead 汇总最终输出（DECISION）

**任务清单**

1. **Orchestrator 核心实现（串行）**

   * 选择策略：round-robin / policy-driven（先 round-robin）
   * 输入：用户输入 + group 配置
   * 输出：事件流（继续用你的 SSE）
2. **Runner 生成（Role → AgentRunner）**

   * Role 提供：system prompt、允许工具、默认行为（只读/可写）
   * AgentRunner 读取 role 配置构造上下文（role prompt + group blackboard 摘要 + memory）
3. **结构化沟通落地**

   * Runner 输出除了自然语言，还必须产出 message_type + payload（最少 PROPOSAL/QUESTION/STATUS）
   * Orchestrator 根据 message_type 做下一步派发（例如 QUESTION → 指定角色）
4. **最小“Lead 汇总器”**

   * 由 Lead 负责生成 DECISION：把各角色 PROPOSAL/EVIDENCE 汇总成最终响应

**相关文档**

* `docs/architecture/orchestrator.md`（核心：调度策略、事件汇聚、失败策略）
* `docs/spec/agent-runner-contract.md`（Runner 输入输出协议）
* `docs/playbook/debug-multi-role.md`（怎么从 trace 定位问题）

**DoD**

* 一个 group（Lead/Researcher/Critic）完成任务：

  * Researcher 提供 evidence
  * Critic 指出风险/缺陷
  * Lead 输出 DECISION
* UI trace 可按 agent_id 分泳道回放

---

### Phase 2：角色绑定 Skills + 权限与审批（让“岗位边界”变硬）

**目标**：真正像团队：不同角色有不同工具/权限；高风险工具必须审批或阻断。

**交付物**

* Skill Registry（MCP/local 工具统一注册 + 风险等级）
* Role→Skill 绑定（白名单）
* ToolRouter 强制权限检查 + 审批 hook（先做阻断也行）

**任务清单**

1. **Skill Registry**

   * 记录：skill_id、工具列表、schema、risk_level、provider（mcp/local）
   * 健康检查：MCP server 在线状态、tools/list 缓存
2. **Role-Tool Policy**

   * role 里声明 allowed_tools / denied_tools
   * 可选：按 tool 风险等级给默认策略（read-only 角色禁止 write 类工具）
3. **审批/阻断**

   * ToolRouter：

     * 若不允许 → 写 `tool.blocked` event
     * 若需审批 → 写 `tool.requires_approval` event（后面接 UI 弹窗）
4. **UI（最小）**

   * 显示每个 role 的可用工具
   * 被阻断的工具调用在 trace 里可见

**相关文档**

* `docs/spec/skills-registry.md`
* `docs/spec/tool-policy-and-approval.md`

**DoD**

* 同一工具：Researcher 可调用，Critic 被阻断（可回放可解释）
* MCP 开关开启/关闭不影响主链路稳定

---

### Phase 3：共享黑板（Blackboard）+ 私有记忆（Personal）+ 自动巩固

**目标**：团队协作的“共同认知”可持续累积，减少重复沟通；记忆可控可追溯。

**交付物**

* group 黑板 memory（共享）
* agent 私有 memory（实例级）
* run 结束自动生成 episodic（决策+证据）
* consolidation（可选后台任务）：去重/提炼/提升重要性

**任务清单**

1. **Memory scope 扩展**

   * 新增 scope：`group_id`、`agent_instance_id`
   * 默认检索顺序：group blackboard → project core → personal episodic → archival
2. **Blackboard 写入策略**

   * 只有 Lead（或允许角色）能写 core/decision 类
   * evidence 可以共享，但要引用来源（events/resources）
3. **自动生成 episodic**

   * run.completed 时自动写：

     * DECISION（what/why）
     * EVIDENCE（refs）
     * TODO（next actions）
4. **UI**

   * Blackboard 面板：共识、待办、证据引用列表

**相关文档**

* `docs/spec/memory-scopes-blackboard.md`
* `docs/spec/episodic-and-consolidation.md`

**DoD**

* 新 run 能检索到上次同 group 的 DECISION/EVIDENCE（明显减少重复）
* Blackboard 可在 UI 中查看与 pin

---

### Phase 4：并发与成本控制（可选，最后做）

**目标**：真正多 agent 并发执行 + 幂等/去重 + 预算控制。

**任务清单（高阶）**

* Orchestrator 支持并发 runner（受预算/锁控制）
* tool call 去重（同一 evidence 不重复抓）
* 资源锁与幂等 key（避免双写）
* 成本预算：per run/per agent/per tool

**文档**

* `docs/architecture/concurrency-and-budget.md`

---

## 建议的开发任务拆分（可直接开 issues）

### Epic A：Core Entities & APIs（Phase 0）

* [ ] DB migrations: roles/groups/members/agent_instances
* [ ] REST: roles CRUD
* [ ] REST: groups CRUD + add member
* [ ] runs: 支持 group_id 贯穿（run meta + events payload）

### Epic B：Serial Orchestrator（Phase 1）

* [ ] Orchestrator 接口与实现（串行）
* [ ] Role-based AgentRunner factory
* [ ] message protocol 产出与路由
* [ ] Lead 汇总器

### Epic C：UI Multi-role Trace（Phase 1 UI）

* [ ] trace 按 agent_id 分组（泳道/过滤）
* [ ] 展示 message_type（proposal/decision/evidence 高亮）
* [ ] group 成员列表 + 当前轮到谁

### Epic D：Skill Policy & Approval（Phase 2）

* [ ] Skill registry（含 MCP tools/list 缓存）
* [ ] Role-tool policy enforcement in ToolRouter
* [ ] tool.blocked / tool.requires_approval events
* [ ] UI 展示工具权限与阻断原因

### Epic E：Blackboard Memory（Phase 3）

* [ ] memory scope 扩展 group/agent_instance
* [ ] blackboard 面板与写入策略
* [ ] episodic 自动生成

---

## 需要新增/更新的开发文档清单（建议按目录落在 repo）

1. `docs/roadmap.md`（阶段、里程碑、DoD）
2. `docs/concepts/roles-groups-projects.md`（产品概念）
3. `docs/architecture/orchestrator.md`（调度器设计）
4. `docs/spec/events-message-protocol.md`（结构化消息协议）
5. `docs/spec/agent-runner-contract.md`（Runner I/O 协议、事件要求）
6. `docs/spec/skills-registry.md`（技能注册与 MCP 接入规范）
7. `docs/spec/tool-policy-and-approval.md`（权限/审批/审计）
8. `docs/spec/memory-scopes-blackboard.md`（共享/私有记忆）
9. `docs/playbook/debug-multi-role.md`（调试手册：怎么读 trace、常见故障）

---

## 我建议你从哪里开始（最高 ROI 的第一步）

先做 **Phase 0 + Phase 1（串行 Orchestrator）**，因为：

* 不涉及复杂并发与分布式
* 你现有 events/checkpoints 体系能直接承载
* UI 只要加泳道展示，立刻就“像团队在工作”

如果你愿意，我可以下一条消息直接给你：

* **最小表结构（roles/groups/agent_instances）DDL 草案**
* **Orchestrator 的伪代码（串行轮转 + message routing）**
* **message protocol 的 JSON Schema**
  让你可以直接丢给 AI 开始写代码。

---

## 测试建议暂存（2026-02-09）

以下建议用于下一轮稳定性收口，先记录在 PRD 便于排期：

### P0：MCP 协议健壮性补齐（建议优先）

1. 在 `MCPClient` 增加 `tools/list` 与 `tools/call` 返回结构校验（schema guard），避免非法载荷进入运行时。
2. 在 `RuntimeToolRouter` 对 MCP 非法返回统一转换为可观测错误（可回放、可统计），并保留 `isError` 语义。
3. 将当前 `it.fails` 协议差距用例转为常规通过用例（对应代码修复后落地）。

**验收标准**
- MCP 返回 `tools` 非数组时，启动或刷新阶段明确失败，错误信息可定位到 schema。
- MCP 返回 `tools/call` 非法 payload 时，不出现 silent hang，run 最终进入 `run.failed` 或明确 tool failure 路径。

### P1：运行时失败可观测性闭环

1. 增加集成测试：MCP 工具返回非法 schema 时，后端必须写出 `run.failed` 与错误事件。
2. 增加错误分类字段（如 `error.code` 子类）以区分协议错误、连接错误、工具逻辑错误。

**验收标准**
- 异常 MCP 响应可通过 trace 一次性定位到：失败 step、失败 tool、失败类型。

### P1：Web Trace 浏览器级断言

1. Playwright 补充“工具错误卡片”断言：出现 `tool.result.isError=true` 时，Trace 页面正确渲染失败状态与错误信息。
2. 验证从 Chat -> Run -> Trace 的错误路径可见性（不仅成功路径）。

**验收标准**
- 用户无需看后端日志，仅通过 Trace 页面即可确认失败原因。
