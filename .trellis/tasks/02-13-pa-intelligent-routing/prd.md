# PA Intelligent Routing - Phase B

> 实现 PA Router Architecture 的 Phase B：智能路由
>
> 前置文档：[PA Router Architecture RFC](../../../docs/architecture/pa-router-architecture.md)
> 前置任务：Phase A (escalate_to_group tool)

---

## 目标

让 PA (Personal Agent) 能够智能地选择合适的 Group 进行 escalation，而不需要用户显式提供 `group_id`。PA 应该：

1. 了解当前可用的 Groups 及其能力描述
2. 基于对话内容自主决定选择哪个 Group
3. 可选：通过工具查询可用 Groups 列表

**核心价值**：降低使用门槛，用户无需了解 Group 的内部结构，PA 自动选择最合适的专家组。

---

## 需求

### 1. 修改 `escalate_to_group` 工具：`group_id` 变为可选

**当前状态** (Phase A)：
```typescript
{
  name: 'escalate_to_group',
  parameters: {
    properties: {
      group_id: { type: 'string', ... },
      goal: { type: 'string', ... },
      context: { type: 'string', ... }
    },
    required: ['goal', 'group_id']  // group_id 是必需的
  }
}
```

**Phase B 改进**：
```typescript
{
  name: 'escalate_to_group',
  parameters: {
    properties: {
      group_id: {
        type: 'string',
        description: 'Optional. The ID of the group to escalate to. If not provided, a suitable group will be selected automatically based on the goal.'
      },
      goal: { type: 'string', ... },
      context: { type: 'string', ... }
    },
    required: ['goal']  // group_id 变为可选
  }
}
```

**工具行为变化**：
- 如果提供 `group_id`：按 Phase A 逻辑执行（验证 group 存在）
- 如果未提供 `group_id`：调用自动选择逻辑
  1. 查询当前 project 下的所有可用 Groups
  2. 基于 `goal` 和 Groups 的 `description` 进行匹配
  3. 选择最合适的 Group（初期可以简单选择第一个，后续可以用 LLM 做智能匹配）
  4. 如果没有可用 Group，返回错误

### 2. 新增 `list_available_groups` 工具

让 PA 能够主动查询可用的 Groups 及其能力描述。

**工具定义**：
```typescript
{
  name: 'list_available_groups',
  description: 'List all available groups that can be escalated to, along with their capabilities.',
  parameters: {
    type: 'object',
    properties: {
      project_id: {
        type: 'string',
        description: 'Optional. Filter groups by project. If not provided, uses the current run\'s project.'
      }
    }
  },
  metadata: {
    risk_level: 'low',
    mutating: false,
    supports_parallel: true
  }
}
```

**工具返回格式**：
```json
{
  "groups": [
    {
      "id": "grp_abc123",
      "name": "竞品分析组",
      "description": "专注于市场竞品分析，包含搜索专家和数据分析师",
      "capabilities": ["market research", "data analysis", "competitor analysis"],
      "members": [
        { "role": "researcher", "description": "负责信息搜集" },
        { "role": "analyst", "description": "负责数据分析" }
      ]
    },
    {
      "id": "grp_def456",
      "name": "代码审查组",
      "description": "专注于代码质量审查和重构建议",
      "capabilities": ["code review", "refactoring", "best practices"],
      "members": [
        { "role": "senior_dev", "description": "资深开发者" },
        { "role": "architect", "description": "架构师" }
      ]
    }
  ]
}
```

### 3. PA System Prompt 注入可用 Groups

在 PA 的 System Prompt 中自动注入可用 Groups 的列表，让 PA 了解自己可以调用哪些后端资源。

**注入位置**：在 `PromptComposer.buildSystemPrompt()` 中新增一层 "Available Groups Catalog"

**注入格式**：
```markdown
## Available Groups

You have access to the following specialized groups for complex tasks:

1. **竞品分析组** (grp_abc123)
   - Capabilities: market research, data analysis, competitor analysis
   - Members: researcher, analyst
   - Use when: User needs market insights or competitor analysis

2. **代码审查组** (grp_def456)
   - Capabilities: code review, refactoring, best practices
   - Members: senior_dev, architect
   - Use when: User needs code quality review or architecture advice

To escalate a task to a group, use the `escalate_to_group` tool. You can either:
- Specify a group_id explicitly if you know which group to use
- Let the system auto-select by only providing the goal
- Use `list_available_groups` to see all available groups first
```

### 4. 数据模型扩展

#### 4.1 GroupRepository 新增方法

```typescript
// src/backend/runtime/group-repository.ts
interface GroupWithCapabilities extends Group {
  members: Array<{
    role_id: string;
    role_name: string;
    role_description: string;
  }>;
}

class GroupRepository {
  // 新增方法：获取 Groups 及其成员的 Role 信息
  async listGroupsWithRoles(projectId?: string): Promise<GroupWithCapabilities[]>;
}
```

**实现思路**：
- JOIN `groups` 表、`group_members` 表、`roles` 表
- 返回 Group 信息 + 每个成员的 Role 名称和描述

### 5. EscalationService 新增自动选择逻辑

```typescript
// src/backend/runtime/escalation-service.ts
interface EscalateInput {
  parentRunId: string;
  scope: ScopeContext;
  sessionKey: string;
  groupId?: string;  // 变为可选
  goal: string;
  context?: string;
}

class EscalationService {
  // 新增方法：自动选择 Group
  private async selectGroup(
    goal: string,
    projectId?: string
  ): Promise<string>;
}
```

**自动选择策略** (Phase B 简化版)：
1. 查询 `projectId` 下的所有 Groups
2. 如果只有一个 Group，直接选择
3. 如果有多个 Groups，选择第一个（后续可以用 LLM 做智能匹配）
4. 如果没有 Group，抛出 `ToolError`

**未来优化** (Phase B+)：
- 使用 LLM 分析 `goal` 和 Groups 的 `description`，选择最匹配的
- 支持基于 capabilities 标签的精确匹配

---

## 验收标准

### 功能验收

- [ ] PA 调用 `escalate_to_group` 时可以不提供 `group_id`
- [ ] 未提供 `group_id` 时，系统自动选择合适的 Group
- [ ] PA 可以调用 `list_available_groups` 查询可用 Groups
- [ ] PA 的 System Prompt 中包含可用 Groups 的列表
- [ ] 自动选择失败时（无可用 Group），返回清晰的错误信息

### 技术验收

- [ ] `escalate_to_group` 的 `required` 字段只包含 `['goal']`
- [ ] `EscalateInput.groupId` 是可选字段
- [ ] `GroupRepository.listGroupsWithRoles()` 方法实现并测试
- [ ] `PromptComposer` 新增 Group Catalog 层
- [ ] `list_available_groups` 工具注册并可用
- [ ] 自动选择逻辑有单元测试

### 代码质量

- [ ] 遵循 `.trellis/spec/backend/` 所有规范
- [ ] 新增代码有单元测试
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过

---

## 技术方案

### 文件修改清单

| 文件 | 修改内容 |
|------|---------|
| `src/backend/runtime/tool-router.ts` | 1. 修改 `escalate_to_group` 的 `required` 字段<br>2. 修改 handler 支持 `groupId` 可选<br>3. 注册 `list_available_groups` 工具<br>4. 添加 `groupRepository` 到 `RuntimeToolRouterConfig` |
| `src/backend/runtime/escalation-service.ts` | 1. `EscalateInput.groupId` 变为可选<br>2. 新增 `selectGroup()` 私有方法<br>3. 修改 `escalate()` 方法支持自动选择 |
| `src/backend/runtime/group-repository.ts` | 新增 `listGroupsWithRoles()` 方法 |
| `src/backend/runtime/prompt-composer.ts` | 1. `ComposeInput` 新增 `availableGroups` 字段<br>2. 新增 `buildGroupCatalog()` 私有方法<br>3. 在 `buildSystemPrompt()` 中插入 Group Catalog 层 |
| `src/backend/runtime/executor.ts` | 1. 传递 `groupRepository` 到 `RuntimeToolRouterConfig`<br>2. 在 `executeSingleRun()` 中查询可用 Groups 并传递给 `PromptComposer` |

### 新增测试文件

| 文件 | 用途 |
|------|------|
| `src/backend/runtime/escalation-service.test.ts` | 更新测试：验证 `groupId` 可选和自动选择逻辑 |
| `src/backend/runtime/group-repository.test.ts` | 测试 `listGroupsWithRoles()` 方法 |
| `src/backend/runtime/prompt-composer.test.ts` | 测试 Group Catalog 注入 |

---

## 实施步骤

### Step 1: GroupRepository 扩展

1. 在 `src/backend/runtime/group-repository.ts` 中新增 `listGroupsWithRoles()` 方法
2. 实现 JOIN 查询：`groups` + `group_members` + `roles`
3. 编写单元测试

### Step 2: EscalationService 改造

1. 修改 `EscalateInput` 接口，`groupId` 变为可选
2. 新增 `selectGroup()` 私有方法（简化版：选择第一个可用 Group）
3. 修改 `escalate()` 方法：
   - 如果 `groupId` 存在，按原逻辑执行
   - 如果 `groupId` 不存在，调用 `selectGroup()` 获取
4. 更新单元测试

### Step 3: PromptComposer 注入 Groups

1. 修改 `ComposeInput` 接口，新增 `availableGroups?: GroupWithCapabilities[]`
2. 新增 `buildGroupCatalog()` 私有方法，生成 Markdown 格式的 Group 列表
3. 在 `buildSystemPrompt()` 中插入 Group Catalog 层（建议在 environment context 之后）
4. 编写单元测试

### Step 4: Tool Router 改造

1. 修改 `escalate_to_group` 工具定义：
   - `required: ['goal']`（移除 `group_id`）
   - 更新 `group_id` 的 description
2. 修改 `escalate_to_group` handler：
   - 支持 `groupId` 可选
   - 调用 `escalationService.escalate()` 时传递可选的 `groupId`
3. 注册 `list_available_groups` 工具：
   - 定义工具参数
   - 实现 handler（调用 `groupRepository.listGroupsWithRoles()`）
4. 修改 `RuntimeToolRouterConfig`，新增 `groupRepository` 字段

### Step 5: Executor 集成

1. 修改 `getSharedToolRouter()`，传递 `groupRepository` 到 `RuntimeToolRouterConfig`
2. 修改 `executeSingleRun()`：
   - 在创建 `PromptComposer` 之前，调用 `groupRepository.listGroupsWithRoles()`
   - 将结果传递给 `PromptComposer` 的 `ComposeInput.availableGroups`

### Step 6: 测试

- 单元测试：所有新增/修改的方法
- 集成测试：
  1. PA 调用 `list_available_groups` 查询 Groups
  2. PA 调用 `escalate_to_group` 不提供 `group_id`，验证自动选择
  3. PA 调用 `escalate_to_group` 提供 `group_id`，验证仍然正常工作
- E2E 测试：通过 API 创建 PA run，在对话中触发自动 escalation

---

## 风险与限制

### 风险

1. **自动选择不准确**：Phase B 的简化版只选择第一个 Group，可能不是最合适的
2. **Group 信息过多**：如果 Groups 很多，System Prompt 可能过长
3. **性能影响**：每次 PA run 都要查询 Groups 和 Roles，可能增加延迟

### 限制

1. **Phase B 不支持智能匹配**：只是简单选择第一个 Group（Phase B+ 才用 LLM 做智能匹配）
2. **Phase B 不支持动态创建 Group**：只能从已有 Groups 中选择
3. **Phase B 不支持跨 Project 选择**：只能选择当前 Project 的 Groups

### 缓解措施

1. **自动选择不准确**：在工具 description 中明确说明 PA 可以先调用 `list_available_groups` 查看再决定
2. **Group 信息过多**：限制 System Prompt 中只显示前 5 个 Groups，其余通过 `list_available_groups` 查询
3. **性能影响**：考虑缓存 Groups 信息（TTL 5 分钟）

---

## 后续迭代

完成 Phase B 后，可以继续实现：
- **Phase B+**：使用 LLM 做智能 Group 匹配（分析 goal 和 Group descriptions）
- **Phase C**：权限透传与记忆分离
- **Phase D**：用户直通 Group UI

---

## 参考文档

- [PA Router Architecture RFC](../../../docs/architecture/pa-router-architecture.md)
- [Phase A PRD](../02-13-pa-escalation-tool/prd.md)
- [Backend Directory Structure](../../../.trellis/spec/backend/directory-structure.md)
- [Backend Error Handling](../../../.trellis/spec/backend/error-handling.md)
- [Cross-Layer Thinking Guide](../../../.trellis/spec/guides/cross-layer-thinking-guide.md)
