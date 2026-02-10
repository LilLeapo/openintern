# OpenIntern vs OpenClaw 差距分析

> 生成时间：2026-02-07
> 基于 P0 四大改进（语义检索、上下文管理、工具沙箱、错误恢复）完成后的状态

---

## P1 - 核心功能缺失（影响可用性）

### 1. LLM 流式响应
- **现状**：OpenAI/Anthropic 客户端均无 streaming，用户需等待完整响应
- **对标**：全链路 streaming（LLM → SSE → Web UI 逐字输出）
- **涉及文件**：`openai-client.ts`, `anthropic-client.ts`, `agent-loop.ts`, `sse.ts`

### 2. 向量搜索未接线
- **现状**：embedding-provider（Hash/API）、vector-index、hybrid-searcher 代码已写好，但未集成到 MemoryStore 和 ToolRouter
- **对标**：自动 embedding + 混合检索默认启用
- **涉及文件**：`tool-router.ts`, `context-manager.ts`, `executor.ts`

### 3. Web UI 实时更新
- **现状**：需手动刷新，SSE 后端已完整但前端未对接
- **对标**：WebSocket/SSE 实时推送到 UI
- **涉及文件**：`web/src/pages/ChatPage.tsx`, `web/src/pages/TracePage.tsx`

### 4. 队列持久化
- **现状**：内存队列，进程重启后丢失所有 pending/running 任务
- **对标**：持久化队列 + 重启恢复
- **涉及文件**：`run-queue.ts`

---

## P2 - 架构能力缺失（影响扩展性）

### 5. 多 Agent 协作
- **现状**：单 Agent，无调度、无 Agent 间通信
- **对标**：Multi-Agent 编排、任务分配、消息传递

### 6. 高级推理策略
- **现状**：简单 Plan/Act/Observe 循环
- **对标**：ReAct、Tree-of-Thought、Reflection 等可插拔策略

### 7. 动态工具发现
- **现状**：工具硬编码注册
- **对标**：运行时发现、按需加载、工具市场

### 8. 认证/授权
- **现状**：API 完全开放，无用户管理
- **对标**：JWT/OAuth + RBAC 权限控制

### 9. API 速率限制
- **现状**：仅工具层有 RateLimiter，API 层无
- **对标**：全链路速率限制（API → Agent → Tool）

---

## P3 - 生产就绪缺失（影响部署）

### 10. 并发执行
- **现状**：队列严格串行，一次只能执行一个 run
- **对标**：并发 worker pool + 优先级队列

### 11. LLM 响应缓存
- **现状**：无缓存，相同请求重复调用 LLM
- **对标**：语义缓存减少重复调用和成本

### 12. 可观测性
- **现状**：基础 winston logger
- **对标**：OpenTelemetry tracing + metrics + 结构化日志

### 13. E2E 测试
- **现状**：16 个单元/集成测试文件，无端到端测试
- **对标**：全链路集成测试 + 性能基准

### 14. Web UI 质量
- **现状**：3 页面 MVP（Chat/Runs/Trace），无设计系统、无状态管理
- **对标**：完整设计系统 + Zustand/Redux + 响应式布局

---

## 建议实施顺序

### 第一批（P1，可控工作量，效果显著）
1. **LLM Streaming** — 用户体验质变
2. **向量搜索接线** — 代码已有，只差初始化注入
3. **Web UI SSE 对接** — 后端已完整，前端接上即可
4. **队列持久化** — 复用 JSONL 模式

### 第二批（P2，架构升级）
5. 认证/授权
6. API 速率限制
7. 动态工具发现
8. 高级推理策略

### 第三批（P3，生产化）
9. 并发执行
10. 多 Agent 协作
11. 可观测性
12. LLM 缓存
13. E2E 测试
14. Web UI 重构

---

## 测试缺口暂存（2026-02-09）

### 已覆盖（当前基线）
- Agent loop 顺序/失败路径单元测试
- Postgres 集成：run 生命周期、SSE、取消、分页
- 多租户隔离：memory_search/get 隔离、run 读取隔离
- MCP 基础协议：握手、tools/list、tools/call、断线重连

### 仍需补齐（建议下一批）
1. MCP schema 强校验落地：将当前协议差距 `it.fails` 用例修复为常规通过。
2. MCP 非法返回的集成级失败闭环：验证 `run.failed` + 错误事件落库，不得 silent hang。
3. Web Trace 错误路径 Playwright：断言工具错误卡片与错误详情渲染。
4. 断点恢复实测：进程中断后从 checkpoints/events 一致性恢复或可重放。
