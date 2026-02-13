# PA Escalation Tool - Phase A

> 实现 PA Router Architecture 的 Phase A：Escalation 工具（最小可用）
>
> 前置文档：[PA Router Architecture RFC](../../../docs/architecture/pa-router-architecture.md)

---

## 目标

让 PA (Personal Agent / SingleAgentRunner) 能够在对话中判断任务超出自身能力时，自动调用 `escalate_to_group` 工具来启动一个 Group Run，等待其完成，并将结果注入回 PA 的对话流程。

**核心价值**：用户只和 PA 对话，PA 在后台自动"摇人"（Group）解决复杂问题，对用户透明。

---

## 需求

### 1. 新增 `escalate_to_group` Builtin Tool

在 `RuntimeToolRouter` 中注册新工具：

**工具定义**：
```typescript
{
  name: 'escalate_to_group',
  description: 'Escalate a complex task to a specialized group of agents. Use this when the task requires expertise or capabilities beyond your own.',
  parameters: {
    type: 'object',
    properties: {
      group_id: {
        type: 'string',
        description: 'The ID of the group to escalate to (e.g., grp_abc123). If not provided, a suitable group will be selected automatically.'
      },
      goal: {
        type: 'string',
        description: 'Clear description of what the group should accomplish'
      },
      context: {
        type: 'string',
        description: 'Relevant context from the current conversation that the group needs to know'
      }
    },
    required: ['goal']
  },
  metadata: {
    risk_level: 'medium',
    mutating: true,
    supports_parallel: false
  }
}
```

**工具行为**：
1. 验证 `group_id` 存在且有成员（如果提供）
2. 创建一个新的 Group Run，设置 `parent_run_id` 为当前 PA 的 run_id
3. 将当前 PA run 的状态设为 `waiting`
4. 等待 Group Run 完成（轮询或事件订阅）
5. 提取 Group Run 的最终输出
6. 将 PA run 状态恢复为 `running`
7. 返回 Group Run 的结果作为工具调用结果

### 2. 数据模型扩展

#### 2.1 新增 `waiting` 状态

修改 `src/types/run.ts` 和 `src/backend/db/schema.ts`：

```typescript
// src/types/run.ts
export type RunStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
```

```sql
-- src/backend/db/schema.ts
ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_status_check;
ALTER TABLE runs ADD CONSTRAINT runs_status_check
  CHECK (status IN ('pending', 'running', 'waiting', 'completed', 'failed', 'cancelled'));
```

#### 2.2 新增 `parent_run_id` 字段

```sql
-- src/backend/db/schema.ts
ALTER TABLE runs ADD COLUMN IF NOT EXISTS parent_run_id TEXT REFERENCES runs(id);
CREATE INDEX IF NOT EXISTS runs_parent_run_id_idx ON runs(parent_run_id);
```

### 3. Run Queue 改造（解决死锁）

**问题**：当前 Run Queue 是串行的（一次只运行一个 run）。如果 PA 的工具 handler 创建了子 Group Run 并等待其完成，会导致死锁：
- PA run 在 `waiting` 状态，占用 queue
- 子 Group Run 在 queue 中排队，但无法开始（因为 PA run 还没结束）

**解决方案**：

**选项 A（推荐）**：Run Queue 支持嵌套运行
- 当 run 进入 `waiting` 状态时，queue 认为该 run "暂时释放"
- Queue 可以开始处理下一个 pending run（包括子 run）
- 当子 run 完成时，父 run 从 `waiting` 恢复为 `running`，重新进入 queue

**选项 B**：子 run 在独立的 executor 中运行
- 不通过 queue，直接调用 `executeGroupRun()`
- 风险：绕过 queue 的并发控制，可能导致资源竞争

**本次实现选择**：选项 A（修改 Run Queue 支持嵌套）

### 4. 工具实现细节

#### 4.1 等待子 Run 完成的机制

**方案**：轮询 + 超时

```typescript
async function waitForRunCompletion(
  runId: string,
  runRepository: RunRepository,
  timeoutMs: number = 300000 // 5 minutes
): Promise<Run> {
  const startTime = Date.now();
  const pollIntervalMs = 1000; // 1 second

  while (Date.now() - startTime < timeoutMs) {
    const run = await runRepository.getRunById(runId);
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      return run;
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  throw new ToolError(`Group run ${runId} did not complete within ${timeoutMs}ms`);
}
```

#### 4.2 提取 Group Run 结果

从 Group Run 的最终输出中提取结果。Group Run 的输出通常在最后一个 `run.completed` 事件的 `output` 字段中。

```typescript
const groupRun = await waitForRunCompletion(childRunId, runRepository);
if (groupRun.status === 'failed') {
  return {
    success: false,
    error: `Group run failed: ${groupRun.error ?? 'Unknown error'}`
  };
}
const result = groupRun.output ?? 'Group completed but produced no output';
return { success: true, result };
```

---

## 验收标准

### 功能验收

- [ ] PA 在对话中可以调用 `escalate_to_group` 工具
- [ ] 调用后，PA run 进入 `waiting` 状态
- [ ] 子 Group Run 被创建并执行
- [ ] 子 Group Run 完成后，PA run 恢复 `running` 状态
- [ ] PA 收到 Group Run 的结果并继续对话
- [ ] 全流程可在 Trace 中回放（能看到父子 run 关系）

### 技术验收

- [ ] `runs` 表有 `parent_run_id` 字段和索引
- [ ] `RunStatus` 类型包含 `waiting`
- [ ] DB schema constraint 包含 `waiting` 状态
- [ ] Run Queue 支持嵌套运行（父 run waiting 时，子 run 可以开始）
- [ ] 工具 handler 有超时保护（默认 5 分钟）
- [ ] 工具 handler 有错误处理（子 run 失败时返回清晰错误）

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
| `src/types/run.ts` | 添加 `'waiting'` 到 `RunStatus` |
| `src/backend/runtime/models.ts` | 同步 `RunStatus` 类型 |
| `src/backend/db/schema.ts` | 添加 `parent_run_id` 字段、`waiting` 状态约束 |
| `src/backend/runtime/tool-router.ts` | 注册 `escalate_to_group` 工具 |
| `src/backend/runtime/run-repository.ts` | 添加 `updateRunStatus()` 方法（如果没有） |
| `src/backend/queue/run-queue.ts` | 修改 `processQueue()` 支持嵌套运行 |
| `src/backend/runtime/executor.ts` | 处理 `parent_run_id` 关系 |

### 新增文件

| 文件 | 用途 |
|------|------|
| `src/backend/runtime/escalation-service.ts` | 封装 escalation 逻辑（创建子 run、等待完成、提取结果） |
| `src/backend/runtime/escalation-service.test.ts` | 单元测试 |

---

## 实施步骤

### Step 1: 数据模型扩展

1. 修改 `src/types/run.ts` 添加 `waiting` 状态
2. 修改 `src/backend/db/schema.ts` 添加 `parent_run_id` 和 `waiting` 约束
3. 运行 migration（启动服务时自动执行）

### Step 2: Escalation Service

创建 `src/backend/runtime/escalation-service.ts`：
- `createChildGroupRun()` - 创建子 Group Run
- `waitForRunCompletion()` - 轮询等待完成
- `extractRunResult()` - 提取结果

### Step 3: Tool Registration

在 `src/backend/runtime/tool-router.ts` 的 `registerBuiltinTools()` 中注册 `escalate_to_group`。

Tool handler 调用 `EscalationService` 的方法。

### Step 4: Run Queue 改造

修改 `src/backend/queue/run-queue.ts`：
- 当 run 进入 `waiting` 状态时，释放 queue 锁
- 允许下一个 pending run 开始
- 当子 run 完成时，父 run 重新入队

### Step 5: 测试

- 单元测试：`escalation-service.test.ts`
- 集成测试：创建一个 PA run，调用 escalate_to_group，验证子 run 执行并返回结果
- E2E 测试：通过 API 创建 PA run，在对话中触发 escalation

---

## 风险与限制

### 风险

1. **Run Queue 死锁**：如果 queue 改造不正确，可能导致父子 run 互相等待
2. **超时处理**：如果子 Group Run 运行时间过长，可能超时
3. **错误传播**：子 run 失败时，错误信息需要清晰传递给 PA

### 限制

1. **Phase A 不支持自动选择 Group**：必须显式提供 `group_id`（Phase B 才实现智能路由）
2. **Phase A 不支持权限透传**：子 run 使用 Group 的默认权限（Phase C 才实现）
3. **Phase A 不支持用户直通 Group**：用户无法直接查看 Group 讨论（Phase D 才实现）

---

## 后续迭代

完成 Phase A 后，可以继续实现：
- **Phase B**：智能路由（PA 自动选择合适的 Group）
- **Phase C**：权限透传与记忆分离
- **Phase D**：用户直通 Group UI

---

## 参考文档

- [PA Router Architecture RFC](../../../docs/architecture/pa-router-architecture.md)
- [Backend Directory Structure](../../../.trellis/spec/backend/directory-structure.md)
- [Backend Error Handling](../../../.trellis/spec/backend/error-handling.md)
- [Cross-Layer Thinking Guide](../../../.trellis/spec/guides/cross-layer-thinking-guide.md)
