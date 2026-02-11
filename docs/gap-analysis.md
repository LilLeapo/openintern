# OpenIntern 差距分析：对标 Codex CLI & OpenCode

> 更新时间：2026-02-11
> 对标项目：[OpenAI Codex CLI](https://github.com/openai/codex)（Rust）、[OpenCode](https://github.com/opencode-ai/opencode)（Go）
> 基于 P0 runtime 升级（ToolCallScheduler / PromptComposer / TokenBudgetManager / CompactionService / SkillLoader / McpConnectionManager）完成后的状态

---

## 能力总览对比

| 能力维度 | Codex CLI | OpenCode | OpenIntern | 差距等级 |
|---------|-----------|----------|------------|---------|
| 进程级沙箱隔离 | ✅ OS 原生（Seatbelt/Landlock/seccomp） | ❌ 无 | ⚠️ 逻辑层（路径越狱/文件类型/速率限制） | **P0** |
| 网络隔离 | ✅ 默认禁止出站 | ❌ 无 | ❌ 无 | P1 |
| LSP 诊断集成 | ❌ 无 | ✅ 多语言 LSP + 编辑后自动诊断 | ❌ 无 | **P0** |
| 精确字符串替换编辑 | ❌（patch-only） | ✅ edit 工具（old→new） | ❌ 仅 apply_patch | **P0** |
| Read-before-edit 保护 | ✅ patch 语义校验 | ✅ 时间戳追踪 | ❌ 无 | **P0** |
| Human-in-the-loop 审批 | ✅ 四级策略 + 危险命令启发式 | ✅ 粒度授权 + 持久/单次 + 拒绝级联 | ⚠️ 三态决策但无等待确认机制 | **P0** |
| 文件版本历史 / Undo | ✅ Ghost Snapshots | ✅ SQLite 版本链 | ❌ 仅 checkpoint | P1 |
| 会话恢复 | ✅ state_db 持久化 | ✅ SQLite 完整会话 | ⚠️ checkpoint 存在但无恢复逻辑 | P1 |
| 费用追踪 | ✅ | ✅ 精确到模型定价 | ❌ 无 | P1 |
| 多 Provider 广度 | ✅ 8+ provider | ✅ 11 provider | ⚠️ 3 provider（OpenAI/Anthropic/Mock） | P2 |
| 分层配置 | ✅ 全局→项目→CLI→云端 | ✅ 项目级 JSON + contextPaths | ⚠️ 单层 agent.config.json | P2 |
| 项目级指令文件 | ✅ AGENTS.md | ✅ contextPaths | ❌ 无 | P2 |
| Headless / CI 模式 | ✅ exec 子命令 | ✅ RunNonInteractive | ❌ 无 | P2 |
| 多模态输入（图片） | ✅ | ✅ | ❌ | P2 |
| IDE 集成 | ✅ App Server JSON-RPC | ❌ | ❌ | P3 |
| Prompt Caching | ✅ API 级缓存 | ❌ | ❌ | P3 |

---

## P0 差距详解

### 1. 安全沙箱隔离

**Codex CLI 实现**：
- macOS：Seatbelt `sandbox-exec`，默认 `deny default`，白名单放行文件/进程/网络
- Linux：Landlock 文件系统限制 + seccomp 系统调用过滤 + Bubblewrap 容器隔离
- Windows：受限进程令牌 / WSL 走 Linux 沙箱
- 网络默认完全隔离，agent 无法外传代码或数据
- `SandboxManager.transform()` 在命令执行前透明注入沙箱包装

**OpenIntern 现状**：
- `sandbox/path-guard.ts`：路径越狱检测（`../` 遍历、符号链接逃逸）
- `sandbox/file-type-guard.ts`：文件类型黑名单（.exe/.sh/.bat 等）
- `sandbox/rate-limiter.ts`：60 次/分钟速率限制
- `sandbox/permission-matrix.ts`：read/write/execute 三态权限
- `exec_command` 直接 `sh -c` 执行，无进程隔离，无网络限制

**差距**：逻辑层防护无法阻止恶意 shell 命令的系统级操作。需要至少实现 macOS Seatbelt 集成。

**建议方案**：
- 新增 `sandbox/seatbelt-wrapper.ts`，在 `exec_command` 执行前注入 `sandbox-exec -f policy.sb`
- 编写 `.sb` 策略文件：deny-default + 白名单工作目录读写 + 禁止网络
- Linux 环境用 Bubblewrap (`bwrap`) 作为备选
- 涉及文件：`tool-router.ts`（exec_command handler）、新增 `sandbox/` 下平台适配层

### 2. LSP 诊断集成

**OpenCode 实现**：
- 完整 LSP 客户端（`internal/lsp/`）：client、transport、protocol、handlers
- 支持多语言：Go（gopls）、TypeScript（ts-server）、Rust（rust-analyzer）、Python
- 文件编辑后自动调用 `waitForLspDiagnostics()`，将编译错误/类型错误附加到工具返回值
- LLM 在同一轮对话中看到自己引入的错误，实现即时自我修正
- 异步初始化，按语言存储在 Map 中

**OpenIntern 现状**：完全没有 LSP 集成。agent 写完代码后无法感知语法或类型错误。

**建议方案**：
- 新增 `src/backend/runtime/lsp-client.ts`：封装 JSON-RPC over stdio 通信
- 新增 `src/backend/runtime/lsp-manager.ts`：按语言管理 LSP 进程生命周期
- 在 `write_file` / `apply_patch` / 新增 `edit_file` 工具的 handler 末尾调用诊断
- 将诊断结果（errors/warnings）附加到 ToolResult，让 LLM 立即看到
- 初期只支持 TypeScript（ts-server），后续扩展

### 3. 精确字符串替换编辑 + Read-before-edit 保护

**OpenCode 实现**：
- `edit` 工具：接收 `file_path`、`old_string`、`new_string`，要求 old_string 在文件中唯一匹配
- 追踪每个文件的读写时间戳，如果文件在上次 `view` 后被外部修改，拒绝编辑并强制重新读取
- `write` 工具同样检查时间戳，防止覆盖外部修改
- 编辑后自动生成 diff 用于权限审批展示

**Codex CLI 实现**：
- `apply_patch` 工具有 Lark 语法校验器，返回语义级错误（CorrectnessError vs ShellParseError）
- 通过 `ToolOrchestrator` + `ApplyPatchRuntime` 编排复杂 patch 流程
- 自动提取受影响文件路径用于审批

**OpenIntern 现状**：
- `apply_patch`：简单行级 patch 解析，无语法校验，无错误分类
- `write_file`：直接覆盖，无时间戳检查
- 无精确字符串替换工具

**建议方案**：
- 新增 `edit_file` 工具：接收 path/old_string/new_string，要求唯一匹配，生成 diff 返回
- 新增 `FileReadTracker` 类：记录每个文件的最后读取时间戳
- `write_file` / `edit_file` / `apply_patch` 执行前检查时间戳，过期则返回错误要求重新读取
- 涉及文件：`tool-router.ts`（新增 edit_file handler + 时间戳检查逻辑）

### 4. Human-in-the-loop 审批流程

**Codex CLI 实现**（`exec_policy.rs`）：
- 四级审批策略：Always / UnlessTrusted / OnRequest / Never
- `ExecPolicyManager` 对每条 shell 命令做前置评估
- `command_might_be_dangerous()` 启发式检测危险命令（rm -rf、chmod 777 等）
- 决策类型：Allow（执行）/ Prompt（等待用户确认）/ Forbidden（直接禁止）
- Never 模式下 Prompt 自动降级为 Forbidden，不会卡住 CI 流程

**OpenCode 实现**（`permission/permission.go`）：
- `permissions.Request()` 通过 pub/sub 发送审批请求到 TUI
- 调用方 goroutine **阻塞在 channel 上**等待用户响应
- 支持三种响应：Grant Persistent（session 级持久授权）/ Grant Once / Deny
- Deny 触发级联取消：批次中后续所有工具调用自动取消
- 非交互模式调用 `AutoApproveSession()` 跳过所有审批

**OpenIntern 现状**：
- `tool-policy.ts` 的 `check()` 返回 `decision: 'ask'`，但调用方（`tool-router.ts` `callTool`）只检查 `allowed` 布尔值
- 没有等待用户确认的异步机制
- 没有 SSE/WebSocket 通道将审批请求推送到前端
- 没有持久授权 vs 单次授权的区分

**建议方案**：
- 新增 `src/backend/runtime/approval-service.ts`：
  - `requestApproval(runId, toolName, params)` → 返回 Promise，挂起直到用户响应
  - 通过 SSE 推送 `approval.requested` 事件到前端
  - 前端展示审批弹窗，用户点击后 POST `/api/runs/:runId/approve`
  - 支持 grant_persistent / grant_once / deny 三种响应
- 在 `tool-router.ts` 的 `callTool` 中，当 `decision === 'ask'` 时调用 approval-service
- 新增 `approval_policy` 配置项（always / auto_edit / on_request / never）
- 涉及文件：`tool-router.ts`、`tool-policy.ts`、SSE 层、前端审批组件

---

## P1 差距详解

### 5. 文件版本历史与 Undo/Rollback

**OpenCode 实现**（`internal/history/file.go`）：
- 每次文件修改（write/edit/patch）在 SQLite 中记录原始内容和每个后续版本
- 版本号递增追踪：initial → v1 → v2 → ...
- 检测外部修改并存储中间版本
- 支持回滚到任意历史版本，独立于 Git
- 事务重试逻辑处理并发版本创建冲突

**Codex CLI 实现**：
- Ghost Snapshots（v0.73.0）：捕获会话状态用于回放和可复现性
- Ghost Commits：追踪会话中的临时变更，支持 undo
- `/undo` 命令回滚最近操作

**OpenIntern 现状**：仅有 checkpoint 保存 agent 状态快照，无文件级版本历史。

**建议方案**：
- 新增 `src/backend/runtime/file-history-service.ts`
- 每次 write_file / edit_file / apply_patch 成功后，将旧内容存入版本表
- 新增 `undo_file` 工具：回滚指定文件到上一版本
- 存储层复用现有 PostgreSQL，新增 `file_versions` 表

### 6. 会话恢复与持久化

**OpenCode 实现**：
- SQLite 持久化完整会话元数据（消息数、token 用量、费用、摘要指针）
- 父子会话关系：子任务会话、标题生成会话通过 `ParentSessionID` 关联
- `SummaryMessageID` 指向上下文摘要消息，恢复时从摘要点截断历史
- 所有变更通过 pub/sub 事件通知 TUI 响应式更新

**OpenIntern 现状**：
- `CheckpointService` 保存 run/agent/step 级状态快照
- 无显式的会话恢复/续接逻辑
- 无会话列表管理、无父子会话

**建议方案**：
- 扩展 `RunRepository`：新增 `resumeRun(runId)` 方法，从最新 checkpoint 恢复消息历史
- 在 `executor.ts` 中检测 run 是否有可恢复的 checkpoint，有则跳过已完成步骤
- 前端新增会话历史列表页，支持点击恢复

### 7. 费用追踪

**OpenCode 实现**：
- 每个模型定义精确的 per-token 定价（input/output/cached 分别计价）
- `TrackUsage()` 在每次 LLM 调用后计算费用并累加到 session
- TUI 实时显示当前会话费用

**Codex CLI 实现**：
- 内置 token 计费，支持多 provider 不同定价

**OpenIntern 现状**：`TokenBudgetManager` 追踪 token 数量但不计算费用。

**建议方案**：
- 扩展 `TokenBudgetManager`：新增模型定价表和 `cost` 累加字段
- 在 `BudgetState` 中增加 `totalCost` 字段
- 通过 SSE 事件推送费用更新到前端

---

## P2 差距详解

### 8. 多 Provider 支持

**OpenCode 支持 11 个 provider**：Anthropic、OpenAI、Gemini、Groq、OpenRouter、XAI、Bedrock、Azure、VertexAI、Copilot、Local。每个 agent 角色（coder/summarizer/task/title）可独立配置不同模型。

**Codex CLI 支持 8+ provider**：OpenAI、Ollama（本地模型）、OpenRouter（400+ 模型）、Gemini、Mistral、DeepSeek、XAI、Groq，以及任意 OpenAI 兼容 API。支持命名 profile 快速切换。

**OpenIntern 现状**：仅 OpenAI、Anthropic、Mock 三种。`createLLMClient()` 工厂方法硬编码三个分支。

**建议方案**：
- 新增 `bedrock-client.ts`（AWS Bedrock，企业级常用）
- 新增 `openai-compatible-client.ts`（通用 OpenAI 兼容层，覆盖 Ollama/OpenRouter/Groq/XAI）
- 在 `LLMConfig` 中增加 `baseUrl` 字段（已有但未充分利用）
- 优先级：Bedrock > OpenAI 兼容层 > 其他

### 9. 分层配置系统

**Codex CLI**：内置默认 → 全局 `~/.codex/config.toml` → 项目级 `.codex/config.toml` → CLI 覆盖 → 云端策略约束。五层合并，高优先级覆盖低优先级。

**OpenCode**：`.opencode.json` 支持项目级和用户级，`contextPaths` 将项目文档注入 system prompt，运行时 `UpdateAgentModel()` 支持模型热切换。

**OpenIntern 现状**：单层 `agent.config.json`，无合并逻辑，无运行时热切换。

**建议方案**：
- 实现三层配置合并：内置默认 → 全局 `~/.openintern/config.json` → 项目级 `.openintern/config.json`
- 使用 deep-merge 策略，数组替换而非追加
- 新增 `ConfigLoader` 类处理发现和合并逻辑

### 10. 项目级指令文件

**Codex CLI**：`AGENTS.md` 约定——项目根目录和子目录中的 Markdown 文件，自动注入 agent system prompt。支持 monorepo 嵌套。

**OpenCode**：`contextPaths` 配置项指向文件/目录，内容并发读取后拼接到 system prompt 前部。

**OpenIntern 现状**：`SkillLoader` 支持 SKILL.md 发现，但这是技能定义而非项目指令。PromptComposer 没有项目指令注入层。

**建议方案**：
- 在 `PromptComposer` 中新增第 8 层：项目指令注入
- 自动发现 `.openintern/INSTRUCTIONS.md` 或 `AGENTS.md`
- 内容插入到 system prompt 的环境上下文层之后

### 11. Headless / CI 模式

**Codex CLI**：`codex exec` 子命令，无 TUI，接收 prompt 参数，全自动执行，输出结果到 stdout。

**OpenCode**：`RunNonInteractive()` 模式，自动审批所有权限，打印结果后退出。

**OpenIntern 现状**：仅有 Web API 模式，无 CLI 入口，无非交互执行能力。

**建议方案**：
- 新增 `src/cli/exec.ts`：接收 `--prompt` 参数，调用 executor，流式输出到 stdout
- 复用现有 `createRuntimeExecutor`，设置 approval_policy 为 never
- 支持 `--model`、`--max-steps` 等 CLI 参数

---

## 实施路线图

### 第一批：P0（核心体验，建议立即启动）

| 序号 | 项目 | 核心交付物 | 依赖 |
|-----|------|-----------|------|
| 1 | Human-in-the-loop 审批 | `approval-service.ts` + SSE 审批事件 + 前端审批弹窗 | tool-policy.ts |
| 2 | 精确编辑工具 + read-before-edit | `edit_file` 工具 + `FileReadTracker` | tool-router.ts |
| 3 | LSP 诊断集成 | `lsp-client.ts` + `lsp-manager.ts` + 编辑后诊断注入 | write_file/edit_file |
| 4 | 进程级沙箱 | `sandbox/seatbelt-wrapper.ts` + macOS .sb 策略文件 | exec_command |

### 第二批：P1（可靠性与可用性）

| 序号 | 项目 | 核心交付物 | 依赖 |
|-----|------|-----------|------|
| 5 | 文件版本历史 + Undo | `file-history-service.ts` + `undo_file` 工具 + DB migration | write_file/edit_file |
| 6 | 会话恢复 | `RunRepository.resumeRun()` + executor checkpoint 恢复逻辑 | checkpoint-service |
| 7 | 费用追踪 | `TokenBudgetManager` 扩展定价表 + SSE 费用事件 | token-budget-manager |
| 8 | 网络隔离 | 沙箱策略文件增加网络 deny 规则 | 沙箱（#4） |

### 第三批：P2（扩展性与生态）

| 序号 | 项目 | 核心交付物 | 依赖 |
|-----|------|-----------|------|
| 9 | 多 Provider 扩展 | `openai-compatible-client.ts` + `bedrock-client.ts` | llm-client |
| 10 | 分层配置系统 | `ConfigLoader` 三层合并 | 无 |
| 11 | 项目级指令文件 | PromptComposer 第 8 层 + INSTRUCTIONS.md 发现 | prompt-composer |
| 12 | Headless / CI 模式 | `src/cli/exec.ts` CLI 入口 | executor |
| 13 | 多模态输入 | Message 类型扩展 image part + provider 适配 | types/agent |

---

## OpenIntern 已有优势（无需追赶）

以下能力是 OpenIntern 已具备而对标项目部分缺失的：

| 能力 | OpenIntern | Codex CLI | OpenCode |
|------|-----------|-----------|----------|
| 多 Agent 编排 | ✅ SerialOrchestrator + RoleRunnerFactory | ❌ 单 agent | ❌ 单 agent |
| 三层记忆系统 | ✅ core/episodic/archival + 向量检索 | ❌ 无持久记忆 | ❌ 无持久记忆 |
| 技能系统（SKILL.md） | ✅ 发现/加载/隐式注入 | ⚠️ AGENTS.md（仅指令） | ⚠️ contextPaths（仅指令） |
| 多 MCP 服务器管理 | ✅ 命名空间化 + 独立健康追踪 | ✅ 类似 | ✅ 类似 |
| Token 预算自动压缩 | ✅ 阈值触发 + CompactionService | ⚠️ 手动触发 | ⚠️ 手动 Summarize |
| Doom-loop 检测 | ✅ 连续相同调用自动打断 | ❌ | ❌ |
| Web UI + SSE 实时推送 | ✅ React + SSE | ❌ 仅 TUI | ✅ TUI（Bubble Tea） |
| 事件溯源架构 | ✅ 全量事件持久化 + trace 导出 | ⚠️ 部分 | ❌ |
