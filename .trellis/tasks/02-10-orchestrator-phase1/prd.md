# Phase 1: 串行编排 Orchestrator - 多角色协作 MVP

## 目标

一个 run 里多个 agent_id 轮流发言/执行，串行调度，可回放、易调试、成本可控。

## 需求

### 1. Orchestrator 核心实现（串行）

- 选择策略：先实现 round-robin，预留 policy-driven 扩展点
- 输入：用户输入 + group 配置
- 输出：事件流（复用 SSE）
- 同一 run_id 下汇聚多个 agent 的事件（按 agent_id 区分）

### 2. Runner 生成（Role → AgentRunner）

- Role 提供：system prompt、允许工具、默认行为
- AgentRunner 读取 role 配置构造上下文
- 每个 role 对应一个独立的 AgentRunner 实例

### 3. 结构化沟通落地

- Runner 输出除自然语言外，还产出 message_type + payload
- Orchestrator 根据 message_type 做下一步派发
- 最少支持：PROPOSAL / EVIDENCE / STATUS / DECISION

### 4. 最小 Lead 汇总器

- Lead 角色负责生成 DECISION
- 汇总各角色 PROPOSAL/EVIDENCE 成最终响应

## 验收标准

- [ ] Orchestrator 可串行调度 2~3 个 AgentRunner
- [ ] 每个 Runner 使用 Role 的 system_prompt
- [ ] 事件流中包含不同 agent_id 的事件
- [ ] Lead 产出 DECISION 事件
- [ ] group run API 端点可用
- [ ] TypeScript strict mode 通过
- [ ] ESLint 通过

## 技术说明

### 新增文件

```
src/backend/runtime/orchestrator.ts        # 串行编排器
src/backend/runtime/role-runner-factory.ts  # Role → AgentRunner 工厂
```

### 修改文件

```
src/backend/runtime/executor.ts            # 支持 group run
src/backend/api/groups.ts                  # POST /api/groups/:id/runs
```
