# PA Permission & Memory - Phase C

> 实现 PA Router Architecture 的 Phase C：权限透传与记忆分离
>
> 前置文档：[PA Router Architecture RFC](../../../docs/architecture/pa-router-architecture.md)
> 前置任务：Phase A (escalate_to_group tool), Phase B (intelligent routing)

---

## 目标

实现 PA Router 的核心安全和记忆机制，确保：

1. **权限透传（Permission Passthrough）**：当 PA 代表用户 escalate 到 Group 时，Group 内的 Agents 继承用户的权限边界，实现 `Group Agent permissions = PA permissions ∩ Role permissions`
2. **记忆分离（Memory Separation）**：PA 的个人记忆（用户偏好）与 Group 的任务记忆分离，各自使用不同的检索优先级
3. **知识沉淀（Knowledge Deposition）**：Group 执行完成后，关键结果自动沉淀到企业知识库（org/project-level archival memory）

**核心价值**：
- 安全性：防止 Group 越权访问用户不允许的资源
- 个性化：PA 记住用户偏好，不被 Group 任务记忆污染
-知识积累：Group 的工作成果自动成为企业资产

---

## 需求

### 1. 权限透传（Permission Passthrough）

#### 1.1 数据模型扩展

**`runs` 表新增字段**：
```sql
ALTER TABLE runs ADD COLUMN delegated_permissions JSONB;
```

**`delegated_permissions` 结构**：
```typescript
interface DelegatedPermissions {
  allowed_tools?: string[];  // 用户允许的工具列表
  denied_tools?: string[];   // 用户禁止的工具列表
}
```

**说明**：
- 当 PA run 创建时，`delegated_permissions` 为 `null`（PA 直接继承用户的完整权限）
- 当 PA escalate 到 Group 时，PA 的权限边界（`allowed_tools`, `denied_tools`）被复制到 child run 的 `delegated_permissions` 字段
- Group 内的每个 Agent 在执行工具调用时，必须同时满足：
  - Role 的 `allowed_tools` / `denied_tools`（来自 `roles` 表）
  - `delegated_permissions`（来自 parent PA run）

#### 1.2 权限检查逻辑

**当前逻辑** (`ToolPolicy.check()`):
```typescript
check(agent: AgentContext, tool: string): 'allow' | 'deny' | 'ask'
```

**Phase C 扩展**：
```typescript
interface AgentContext {
  agentId: string;
  roleId?: string;
  allowedTools?: string[];
  deniedTools?: string[];
  delegatedPermissions?: DelegatedPermissions;  // 新增
}

class ToolPolicy {
  // 新增方法：考虑 delegated permissions 的权限检查
  checkWithDelegated(
    agent: AgentContext,
    tool: string
  ): 'allow' | 'deny' | 'ask';
}
```

**检查逻辑**（优先级从高到低）：
1. 如果 `agent.delegatedPermissions` 存在：
   - 如果 `delegatedPermissions.denied_tools` 包含 tool → `deny`
   - 如果 `delegatedPermissions.allowed_tools` 存在且不包含 tool → `deny`
2. 如果 `agent.deniedTools` 包含 tool → `deny`
3. 如果 `agent.allowedTools` 存在且包含 tool → `allow`
4. 否则按 risk level 默认策略

**实现交集逻辑**：
```
Effective permissions = Role permissions ∩ Delegated permissions

具体规则：
- denied_tools = Role.denied_tools ∪ Delegated.denied_tools（并集，任一禁止即禁止）
- allowed_tools = Role.allowed_tools ∩ Delegated.allowed_tools（交集，两者都允许才允许）
```

#### 1.3 Escalation 流程改造

**`EscalationService.escalate()` 修改**：
```typescript
interface EscalateInput {
  parentRunId: string;
  scope: ScopeContext;
  sessionKey: string;
  groupId?: string;
  goal: string;
  context?: string;
  delegatedPermissions?: DelegatedPermissions;  // 新增
}

class EscalationService {
  async escalate(input: EscalateInput): Promise<string> {
    // 1. 获取 parent run 的权限边界
    const parentRun = await this.runRepository.getRunById(input.parentRunId);

    // 2. 如果 parent 已有 delegated_permissions，继承它；否则从 parent 的 role 构建
    const delegatedPermissions = input.delegatedPermissions
      || parentRun.delegatedPermissions
      || this.buildDelegatedPermissionsFromRole(parentRun.roleId);

    // 3. 创建 child run 时传递 delegated_permissions
    const childRunId = await this.runRepository.createRun({
      ...
      parentRunId: input.parentRunId,
      delegatedPermissions,  // 传递给 child
    });

    // ...
  }
}
```

#### 1.4 Executor 集成

**`executeGroupRun()` 修改**：
```typescript
async function executeGroupRun(runId: string) {
  const run = await runRepository.getRunById(runId);

  // 读取 delegated_permissions
  const delegatedPermissions = run.delegatedPermissions;

  // 为每个 Role Runner 构建 AgentContext 时，注入 delegatedPermissions
  const agentContext: AgentContext = {
    agentId: member.agentInstanceId,
    roleId: member.roleId,
    allowedTools: role.allowedTools,
    deniedTools: role.deniedTools,
    delegatedPermissions,  // 注入
  };

  // ...
}
```

**`RuntimeToolRouter.callTool()` 修改**：
```typescript
async callTool(name: string, args: unknown, agentContext?: AgentContext) {
  // 使用新的 checkWithDelegated 方法
  const decision = this.toolPolicy.checkWithDelegated(agentContext, name);

  if (decision === 'deny') {
    throw new ToolError(
      `Tool '${name}' is denied by policy`,
      'PERMISSION_DENIED'
    );
  }

  // ...
}
```

---

### 2. 记忆分离（Memory Separation）

#### 2.1 PA 专属记忆检索

**当前状态**：
- `SingleAgentRunner` 使用 `memory_search()`（flat search）
- `SerialOrchestrator` 使用 `memory_search_tiered()`（4-tier search for groups）

**Phase C 改进**：
- PA 使用新的 `memory_search_pa()` 方法，实现 PA 专属的检索优先级

**PA 检索优先级**（RFC section 6.3）：
```
Tier 1: 用户偏好（User Preferences）
  - scope: { userId, agentInstanceId }
  - metadata: { pa_preference: true }
  - type: core

Tier 2: 企业知识（Enterprise Knowledge）
  - scope: { orgId } (no userId, no projectId, no groupId)
  - type: archival

Tier 3: 历史任务记忆（Historical Task Memory）
  - scope: { userId, projectId } (no groupId)
  - type: episodic
```

**实现**：
```typescript
// src/backend/runtime/memory-service.ts
class MemoryService {
  async memory_search_pa(
    query: string,
    scope: MemoryScopeContext,
    limit: number = 10
  ): Promise<MemorySearchResult[]> {
    const results: MemorySearchResult[] = [];

    // Tier 1: User preferences
    const tier1 = await this.pool.query(
      `SELECT * FROM memory_search($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        query,
        scope.orgId,
        scope.userId,
        null, // projectId
        null, // groupId
        scope.agentInstanceId,
        'core',
        Math.ceil(limit * 0.3)
      ]
    );
    results.push(...tier1.rows.map(r => ({ ...r, tier: 1 })));

    // Tier 2: Enterprise knowledge
    const tier2 = await this.pool.query(
      `SELECT * FROM memory_search($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        query,
        scope.orgId,
        null, // userId
        null, // projectId
        null, // groupId
        null, // agentInstanceId
        'archival',
        Math.ceil(limit * 0.4)
      ]
    );
    results.push(...tier2.rows.map(r => ({ ...r, tier: 2 })));

    // Tier 3: Historical task memory
    const tier3 = await this.pool.query(
      `SELECT * FROM memory_search($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        query,
        scope.orgId,
        scope.userId,
        scope.projectId,
        null, // groupId
        null, // agentInstanceId
        'episodic',
        Math.ceil(limit * 0.3)
      ]
    );
    results.push(...tier3.rows.map(r => ({ ...r, tier: 3 })));

    return results.slice(0, limit);
  }
}
```

#### 2.2 用户偏好存储

**约定**：用户偏好使用 `core` 类型 + metadata 标记

**写入示例**：
```typescript
await memoryService.memory_write({
  content: "User prefers concise reports in Chinese",
  scope: {
    orgId: 'org_123',
    userId: 'user_456',
    agentInstanceId: 'pa_789'
  },
  type: 'core',
  metadata: {
    pa_preference: true,
    category: 'communication_style'
  }
});
```

#### 2.3 Agent Runner 集成

**`SingleAgentRunner` 修改**：
```typescript
// src/backend/runtime/agent-runner.ts
class SingleAgentRunner {
  async run() {
    // 使用 PA 专属检索
    const memories = await this.memoryService.memory_search_pa(
      query,
      this.scope,
      10
    );

    // ...
  }
}
```

---

### 3. 知识沉淀（Knowledge Deposition）

#### 3.1 自动沉淀机制

**触发时机**：Group run 完成时（`run.status = 'completed'`）

**沉淀内容**：
- Group 的 DECISION 类型 episodic memories
- Group 的最终输出（final message）
- Group blackboard 中的关键结论

**沉淀目标**：
- 从 `{ orgId, projectId, groupId }` scope
- 提升到 `{ orgId, projectId }` scope（去掉 `groupId`）
- 类型改为 `archival`

#### 3.2 实现方案

**新增服务**：`KnowledgeDepositor`

```typescript
// src/backend/runtime/knowledge-depositor.ts
interface DepositInput {
  runId: string;
  scope: ScopeContext;
}

class KnowledgeDepositor {
  constructor(
    private memoryService: MemoryService,
    private runRepository: RunRepository
  ) {}

  async depositGroupResults(input: DepositInput): Promise<void> {
    // 1. 查询 group run 的 DECISION memories
    const decisions = await this.memoryService.pool.query(
      `SELECT * FROM memories
       WHERE group_id = $1
       AND type = 'episodic'
       AND metadata->>'memory_type' = 'DECISION'`,
      [input.runId]
    );

    // 2. 查询 group run 的最终输出
    const finalOutput = await this.getFinalOutput(input.runId);

    // 3. 写入 archival memory（去掉 groupId）
    for (const decision of decisions.rows) {
      await this.memoryService.memory_write({
        content: decision.content,
        scope: {
          orgId: input.scope.orgId,
          projectId: input.scope.projectId,
          // 不设置 groupId 和 agentInstanceId
        },
        type: 'archival',
        metadata: {
          source: 'group_run',
          source_run_id: input.runId,
          original_memory_id: decision.id,
          deposited_at: new Date().toISOString()
        }
      });
    }

    // 4. 写入最终输出
    if (finalOutput) {
      await this.memoryService.memory_write({
        content: `Group Run Result: ${finalOutput}`,
        scope: {
          orgId: input.scope.orgId,
          projectId: input.scope.projectId,
        },
        type: 'archival',
        metadata: {
          source: 'group_run_output',
          source_run_id: input.runId,
          deposited_at: new Date().toISOString()
        }
      });
    }
  }

  private async getFinalOutput(runId: string): Promise<string | null> {
    // 从 run_events 中获取最后一条 assistant message
    const result = await this.runRepository.pool.query(
      `SELECT payload FROM run_events
       WHERE run_id = $1 AND event_type = 'message.created'
       ORDER BY created_at DESC LIMIT 1`,
      [runId]
    );

    if (result.rows.length === 0) return null;

    const message = result.rows[0].payload;
    return message.content?.[0]?.text || null;
  }
}
```

#### 3.3 Executor 集成

**`processEvent()` 修改**：
```typescript
// src/backend/runtime/executor.ts
async function processEvent(event: RunEvent) {
  if (event.eventType === 'run.completed') {
    const run = await runRepository.getRunById(event.runId);

    // 如果是 group run，触发知识沉淀
    if (run.groupId) {
      await knowledgeDepositor.depositGroupResults({
        runId: run.id,
        scope: {
          orgId: run.orgId,
          projectId: run.projectId,
        }
      });
    }

    // ...
  }
}
```

---

## 验收标准

### 功能验收

#### 权限透传
- [ ] PA escalate 到 Group 时，`delegated_permissions` 正确传递到 child run
- [ ] Group 内 Agent 调用工具时，同时检查 Role 权限和 delegated permissions
- [ ] 当 delegated permissions 禁止某工具时，即使 Role 允许，也应该被拒绝
- [ ] 当 Role 禁止某工具时,即使 delegated permissions 允许，也应该被拒绝
- [ ] 权限检查失败时，返回清晰的 `PERMISSION_DENIED` 错误

#### 记忆分离
- [ ] PA 使用 `memory_search_pa()` 检索，优先返回用户偏好
- [ ] PA 的用户偏好记忆不会被 Group 任务记忆污染
- [ ] Group 使用 `memory_search_tiered()` 检索，优先返回 Group blackboard
- [ ] 用户偏好可以通过 metadata `pa_preference: true` 标记和检索

#### 知识沉淀
- [ ] Group run 完成后，DECISION memories 自动沉淀到 project-level archival
- [ ] Group run 的最终输出自动沉淀到 project-level archival
- [ ] 沉淀的 memory 不包含 `groupId`（可被其他 Groups 检索）
- [ ] 沉淀的 memory 包含 `source_run_id` metadata（可追溯来源）

### 技术验收

- [ ] `runs` 表有 `delegated_permissions JSONB` 字段
- [ ] `RunRecord` 和 `RunCreateInput` 包含 `delegatedPermissions` 字段
- [ ] `AgentContext` 包含 `delegatedPermissions` 字段
- [ ] `ToolPolicy.checkWithDelegated()` 方法实现并测试
- [ ] `MemoryService.memory_search_pa()` 方法实现并测试
- [ ] `KnowledgeDepositor` 服务实现并测试
- [ ] 所有新增代码有单元测试
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过

### 代码质量

- [ ] 遵循 `.trellis/spec/backend/` 所有规范
- [ ] 数据库迁移使用 idempotent pattern
- [ ] 错误处理使用项目标准 Error 类
- [ ] 所有 SQL 查询使用参数化查询
- [ ] 新增服务遵循 Repository → Service → API 分层

---

## 技术方案

### 文件修改清单

| 文件 | 修改内容 |
|------|---------|
| `src/backend/db/schema.ts` | 添加 `delegated_permissions JSONB` 列到 `runs` 表（idempotent migration） |
| `src/backend/runtime/models.ts` | 1. `RunRecord` 添加 `delegatedPermissions?: DelegatedPermissions`<br>2. `RunCreateInput` 添加 `delegatedPermissions?: DelegatedPermissions`<br>3. 新增 `DelegatedPermissions` 接口 |
| `src/backend/runtime/run-repository.ts` | 1. `createRun()` 写入 `delegated_permissions`<br>2. `mapRunRow()` 读取 `delegated_permissions`<br>3. `getRunById()` 返回 `delegatedPermissions` |
| `src/backend/runtime/tool-policy.ts` | 1. `AgentContext` 添加 `delegatedPermissions?: DelegatedPermissions`<br>2. 新增 `checkWithDelegated()` 方法<br>3. 实现交集逻辑 |
| `src/backend/runtime/escalation-service.ts` | 1. `EscalateInput` 添加 `delegatedPermissions?: DelegatedPermissions`<br>2. `escalate()` 方法传递 `delegatedPermissions` 到 child run<br>3. 新增 `buildDelegatedPermissionsFromRole()` 私有方法 |
| `src/backend/runtime/tool-router.ts` | 1. `escalate_to_group` handler 传递 `delegatedPermissions`<br>2. `callTool()` 使用 `checkWithDelegated()` |
| `src/backend/runtime/executor.ts` | 1. `executeGroupRun()` 读取 `delegatedPermissions` 并注入到 `AgentContext`<br>2. `executeSingleRun()` 使用 `memory_search_pa()`<br>3. `processEvent()` 在 `run.completed` 时触发知识沉淀 |
| `src/backend/runtime/memory-service.ts` | 新增 `memory_search_pa()` 方法 |
| `src/backend/runtime/agent-runner.ts` | 使用 `memory_search_pa()` 替代 `memory_search()` |

### 新增文件

| 文件 | 用途 |
|------|------|
| `src/backend/runtime/knowledge-depositor.ts` | 知识沉淀服务 |
| `src/backend/runtime/knowledge-depositor.test.ts` | 单元测试 |
| `src/backend/runtime/tool-policy.test.ts` | 更新测试（delegated permissions） |

---

## 实施步骤

### Step 1: 数据模型扩展

1. 在 `schema.ts` 中添加 `delegated_permissions` 列（idempotent migration）
2. 在 `models.ts` 中添加 `DelegatedPermissions` 接口和字段
3. 在 `run-repository.ts` 中实现读写逻辑
4. 编写单元测试

### Step 2: 权限透传实现

1. 修改 `tool-policy.ts`：
   - `AgentContext` 添加 `delegatedPermissions` 字段
   - 实现 `checkWithDelegated()` 方法
2. 修改 `escalation-service.ts`：
   - `EscalateInput` 添加 `delegatedPermissions` 字段
   - `escalate()` 方法传递权限到 child run
3. 修改 `executor.ts`：
   - `executeGroupRun()` 注入 `delegatedPermissions` 到 `AgentContext`
4. 修改 `tool-router.ts`：
   - `callTool()` 使用 `checkWithDelegated()`
5. 编写单元测试和集成测试

### Step 3: 记忆分离实现

1. 在 `memory-service.ts` 中实现 `memory_search_pa()` 方法
2. 修改 `agent-runner.ts` 使用 PA 专属检索
3. 编写单元测试

### Step 4: 知识沉淀实现

1. 创建 `knowledge-depositor.ts` 服务
2. 实现 `depositGroupResults()` 方法
3. 修改 `executor.ts` 在 `run.completed` 时触发沉淀
4. 编写单元测试

### Step 5: 集成测试

- 端到端测试：
  1. PA escalate 到 Group，验证权限正确传递
  2. Group Agent 尝试调用被 delegated permissions 禁止的工具，验证被拒绝
  3. PA 检索记忆，验证优先返回用户偏好
  4. Group 完成后，验证结果沉淀到 archival memory

---

## 风险与限制

### 风险

1. **权限模型复杂度**：交集逻辑可能导致意外的权限拒绝
2. **记忆检索性能**：PA 的 3-tier 检索可能增加延迟
3. **知识沉淀噪音**：如果 Group 产生大量 DECISION memories，可能污染 archival

### 限制

1. **Phase C 不支持细粒度权限**：只支持工具级别的 allow/deny，不支持参数级别的权限控制
2. **Phase C 不支持动态权限**：权限在 run 创建时固定，不支持运行时动态调整
3. **Phase C 不支持权限审计日志**：没有记录权限检查的详细日志

### 缓解措施

1. **权限复杂度**：提供清晰的错误信息，说明哪个权限规则导致拒绝
2. **检索性能**：限制每个 tier 的结果数量，总结果不超过 10 条
3. **沉淀噪音**：只沉淀 DECISION 类型和最终输出，不沉淀所有 episodic memories

---

## 后续迭代

完成 Phase C 后，可以继续实现：
- **Phase C+**：细粒度权限控制（参数级别、资源级别）
- **Phase C++**：权限审计日志和可视化
- **Phase D**：用户直通 Group UI

---

## 参考文档

- [PA Router Architecture RFC](../../../docs/architecture/pa-router-architecture.md) - Sections 6.2, 6.3
- [Phase A PRD](../02-13-pa-escalation-tool/prd.md)
- [Phase B PRD](../02-13-pa-intelligent-routing/prd.md)
- [Backend Directory Structure](../../../.trellis/spec/backend/directory-structure.md)
- [Backend Database Guidelines](../../../.trellis/spec/backend/database-guidelines.md)
- [Backend Error Handling](../../../.trellis/spec/backend/error-handling.md)
- [Cross-Layer Thinking Guide](../../../.trellis/spec/guides/cross-layer-thinking-guide.md)
