下面是一份**可以直接丢给 AI 开发**的“实现规格文档（MVP）”。目标是：**TS + Python** 的单 Agent 系统（带 CLI + Web UI + Backend），**持久化不用数据库**，用 **JSONL 事件溯源 + 文件投影**，并且**为多 Agent 预留可即插即用接口**。

---

# TS+Python Agent System（MVP）实现规格文档

## 0. 目标与范围

### 目标（MVP 必须交付）

1. **单 Agent 可用**：支持对话式任务执行，具备 agent loop（plan/act/observe）、工具调用、上下文管理、记忆检索与写入。
2. **Web UI**：可聊天、可流式输出、可查看每次 run 的 step/工具调用 trace（可回放）。
3. **Backend**：提供 runs/sessions、事件流（SSE/WS）、工具调用代理、存储读写。
4. **CLI**：用于本地开发启动、运行任务、查看 tail、导出 trace。
5. **存储不依赖数据库**：使用 JSONL 追加写作为事实源（event sourcing），辅以索引文件与快照文件实现分页与恢复。
6. **技能（skills）支持 Python**：Python 侧提供工具能力，TS runtime 通过 **MCP**（优先）或本地适配层调用。

### 非目标（MVP 不做或只留接口）

* 多 Agent 的完整调度与并行执行（只做接口与事件结构支持）
* 复杂权限系统/组织级多租户（只做基础风险分级 + 审批 hooks）
* 完整向量数据库服务（MVP 可先关键词检索；语义检索留可插拔接口）

---

## 1. 总体架构

### 1.1 组件

* **Web UI（React）**

  * Chat、Runs 列表、Run Trace 回放、Tools/Memory 面板（MVP 可简化）
* **Backend + Agent Runtime（Node/TypeScript）**

  * Agent loop、ContextManager、ToolRouter、MCP Client、EventStore、CheckpointStore、MemoryStore
* **Python Skills（MCP Server）**

  * 提供 tools：memory、retrieval、python_exec（可选）、domain tools

### 1.2 数据流（核心）

用户输入 → Backend 创建 run → Agent loop 产生 step →（需要时）调用工具（MCP）→ 写事件 JSONL → 通过 SSE/WS 推送事件到 UI → UI 渲染 trace

---

## 2. 关键概念与实体

* **session_key**：会话域隔离的主键（所有 state/memory/events 都挂在 session_key 下）
* **run_id**：一次任务执行（一次对话触发的一次 agent run）
* **step_id**：run 内的步进编号（每次模型推理/工具调用的一组动作）
* **agent_id**：预留多 Agent；MVP 固定 `"main"`
* **event sourcing**：所有事实只追加写入 `events.jsonl`，其他一切（UI 列表、统计、索引、摘要）都是投影（projection）

---

## 3. 存储设计（无数据库）

### 3.1 目录结构（必须遵循）

```
data/
  sessions/<session_key>/
    runs/<run_id>/
      events.jsonl            # 事实源（append-only）
      events.idx.jsonl        # 索引（可选，推荐）
      checkpoint.latest.json  # 最新状态快照
      checkpoint/
        000001.json           # 历史快照（可选）
      projections/
        run.meta.json         # run 元信息（标题/状态/起止/统计）
        trace.compact.json    # UI 快速加载用的压缩投影（可选）
  memory/
    shared/
      items/<memory_id>.json  # 记忆条目（结构化）
      index/
        keyword.json          # 倒排索引（MVP）
        vectors.*             # 向量索引文件（预留）
```

### 3.2 JSONL 事件格式（统一标准）

**每行一个 JSON 对象**，最小字段如下：

```json
{
  "v": 1,
  "ts": "2026-02-05T12:34:56.789Z",
  "session_key": "s_demo",
  "run_id": "run_123",
  "agent_id": "main",
  "step_id": "step_0007",
  "type": "tool.called",
  "span_id": "sp_abc",
  "parent_span_id": "sp_prev",
  "payload": {},
  "redaction": { "contains_secrets": false }
}
```

#### 事件类型（MVP 必须支持）

* `run.started`
* `run.completed`
* `run.failed`
* `step.started`
* `step.completed`
* `model.started`（可选）
* `model.delta`（流式 token，可选）
* `model.completed`
* `tool.called`
* `tool.result`
* `memory.written`
* `memory.retrieved`
* `checkpoint.saved`

> 说明：多 Agent 预留只需要事件里带 `agent_id` + `parent_span_id`（MVP 固定 main）。

### 3.3 events 索引（不靠 DB 实现分页）

`events.idx.jsonl`：每隔 N 行（如 200）写一条索引记录：

```json
{
  "v": 1,
  "ts_min": "2026-02-05T12:00:00.000Z",
  "ts_max": "2026-02-05T12:05:00.000Z",
  "line_start": 0,
  "line_end": 199,
  "byte_offset": 0
}
```

UI 查询（分页/按时间）：

1. 先读 idx 粗定位 byte_offset
2. 再顺扫小范围 lines 过滤

### 3.4 Checkpoint（断点恢复）

`checkpoint.latest.json` 保存可恢复状态：

```json
{
  "v": 1,
  "session_key": "s_demo",
  "run_id": "run_123",
  "agent_id": "main",
  "step_id": "step_0007",
  "state": {
    "goal": "...",
    "plan": [...],
    "working_summary": "...",
    "tool_state": {...},
    "context_cursor": {...}
  }
}
```

> 恢复逻辑（必须实现）：读取 checkpoint.latest.json → 从 events.jsonl 对齐到 step_id 后继续执行（或从最新 step 开始）。

### 3.5 并发写入规则（强制）

* **单写者原则**：同一 `(session_key, run_id)` 的 events 文件只能由一个 writer 写入（Backend/Orchestrator）。
* **写入必须 append + fsync（或等效保证）**，避免断电丢尾。
* 允许多读者（UI/调试）。

---

## 4. Agent Runtime（TypeScript）

### 4.1 Agent Loop（状态机）

MVP 采用显式步骤状态机（每个 step 一次模型推理 + 可选工具调用）：

1. Observe：拿到用户输入/系统事件
2. Retrieve：从 MemoryStore 做检索（可选）
3. BuildContext：拼装上下文（预算控制 + 裁剪）
4. Decide：LLM 输出下一步 action（消息/工具调用/结束）
5. Act：若需工具，调用 ToolRouter（MCP tools/call）
6. Reflect：判断是否满足目标，否则进入下一 step
7. Commit：写 checkpoint + 关键记忆写入（可选）

**退出条件（必须）**

* 模型输出 final
* 超过 max_steps / max_tool_calls
* 预算耗尽（token/cost/time）
* 人工中止 / 审批未通过

### 4.2 ContextManager（上下文管理）

输入源：

* system 指令（固定）
* 对话历史（来自 events 投影）
* working_summary（来自 checkpoint）
* retrieved memory（MemoryStore）
* tool results（结构化优先，文本作为回退）

策略（MVP）：

* token 预算：system 不裁剪；history 先裁剪；tool raw 输出只保留摘要+引用 id
* 需要大块内容时：保存为 resource（文件）并在上下文里引用（减少 token）

### 4.3 ToolRouter（工具路由）

工具来源：

* MCP tools/list 动态发现
* 内置本地工具（读写文件、event 查询、debug）

统一工具描述：

* name / description
* inputSchema（JSON Schema）
* outputSchema（可选）
* provider：`local` | `mcp:<server_id>`

执行策略：

* 参数校验（必须）
* 超时（必须）
* 重试（可选，幂等工具才允许）
* 结果归一：优先 `structuredContent`，否则用 `content.text`

### 4.4 MCP Client（TS）

* 启动时连接 Python MCP server（stdio 或 HTTP）
* 初始化握手：initialize → notifications/initialized
* 拉工具列表：tools/list
* 调用工具：tools/call

---

## 5. Python Skills（MCP Server）

### 5.1 Skill 组织结构（建议）

```
skills/
  memory_skill/
    manifest.json
    server.py
    tools/
      memory_search.py
      memory_get.py
      memory_write.py
```

### 5.2 MVP 必备工具（建议最小集合）

1. `memory_search(query, top_k, filters)` → 返回 memory_id 列表 + 摘要
2. `memory_get(memory_id)` → 返回完整条目
3. `memory_write(text, metadata)` → 写入结构化条目
4. （可选）`python_exec(code, sandbox)` → 受限执行（若做需加安全策略）

> memory 的持久化可以直接由 TS 的 MemoryStore 实现；Python 也可以只做“逻辑层工具”，最终落盘由 TS 来做（推荐：落盘只在 TS 单写者侧）。

---

## 6. Backend API 设计（TS）

### 6.1 REST（MVP）

* `POST /api/sessions` → 创建/返回 session_key
* `POST /api/runs` `{session_key, input}` → 创建 run 并开始执行，返回 run_id
* `GET /api/runs?session_key=` → run 列表（从 projections/run.meta.json）
* `GET /api/runs/:run_id` → run 详情（meta + 最新 checkpoint）
* `GET /api/runs/:run_id/events?cursor=&limit=` → 分页读 events（基于 idx/byte_offset）
* `POST /api/runs/:run_id/cancel` → 中止（写事件 + 停止 loop）
* `GET /api/memory/search?q=` / `GET /api/memory/:id`（如果你希望 UI 直接查）

### 6.2 事件流（SSE 或 WebSocket，MVP 推荐 SSE）

* `GET /api/runs/:run_id/stream` → 持续推送新事件（每条即一行 JSON）

事件推送格式：直接推 event JSON（与 events.jsonl 同结构），UI 原样渲染即可。

---

## 7. Web UI（MVP 页面）

1. **Chat**

   * 输入框 + 流式输出
   * 显示当前 run 状态（running/completed/failed）
2. **Run Trace**

   * 左侧 step 列表（按事件聚合）
   * 右侧显示：模型输出、工具调用入参/出参、错误栈（脱敏）
3. （可选）Memory/Skills 面板

   * Memory：本 run 命中的记忆
   * Skills：已连接 MCP server + tools 列表

---

## 8. CLI（MVP 命令）

* `agent dev`：启动 backend + web + skills（stdio）
* `agent run "<text>" --session <key>`：发起 run，输出 run_id
* `agent tail <run_id>`：流式打印 events（等价 SSE client）
* `agent export <run_id> --out trace.jsonl`：导出 events.jsonl
* `agent skills list`：列出 MCP server 与工具
* `agent doctor`：检查 data 目录权限、MCP 连通性

---

## 9. 安全与脱敏（MVP 最小要求）

* events.jsonl **不得写入明文 secrets**（API key、token、cookie）
* 工具结果若包含敏感字段，写事件前做 redact：

  * payload 里仅保存摘要/哈希/引用文件 id
  * redaction.contains_secrets = true
* 高风险工具预留审批 hook（MVP 可先只实现“阻断 + UI 提示”）：

  * 文件删除、网络写、执行代码、发送消息等

---

## 10. 多 Agent 预留接口（必须留，但不实现调度）

### 10.1 事件层支持

* event 必带 `agent_id`，未来可以出现 `worker-1`, `critic-1`
* `span_id/parent_span_id` 支持树状 trace（多 agent/多工具链路）

### 10.2 Runtime 接口（只定义）

* `AgentRunner` 接口：

  * `run(input, ctx) -> AsyncIterator<Event>`
* `Orchestrator`（未来）：

  * `spawnAgent(agentSpec) -> agent_id`
  * `send(agent_id, message)`
  * `collect(agent_id)`

MVP：`Orchestrator` 只实例化一个 `main` runner。

---

## 11. 验收标准（MVP）

1. `agent dev` 一条命令可跑起：Web UI 打开可聊天。
2. 每次 `POST /api/runs` 都会生成：

   * `events.jsonl` 持续追加写入
   * `checkpoint.latest.json` 每 step 更新
3. UI 能看到：

   * step 列表
   * 每个工具调用的参数与结果（脱敏后）
4. 服务重启后：

   * `/api/runs` 仍能列出历史 run
   * 可打开某 run 并回放 events
5. MCP 工具调用成功（至少 memory_search/memory_get/memory_write 可用）

---

## 12. 推荐实现顺序（给 AI 开发的任务分解）

1. **Storage 层**

* EventStore：append/read（带 idx）
* CheckpointStore：save/load
* Projection：run.meta.json（从事件滚动生成）

2. **Backend**

* Runs API + SSE stream
* 简单内存队列（run 级串行执行）

3. **Agent Runtime**

* 单 agent loop（max_steps + tool calls）
* ContextManager（先简单裁剪）
* ToolRouter（先接 MCP）

4. **Python MCP Server**

* memory tools（最小可用）

5. **Web UI**

* Chat + Run Trace（基于事件流渲染）

6. **CLI**

* dev/run/tail/export

