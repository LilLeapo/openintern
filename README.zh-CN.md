# OpenIntern Agent（TypeScript）

[English README](./README.md)

OpenIntern 是一个受 `reference/nanobot` 启发的 TypeScript Agent 项目，目标是保持核心紧凑，同时保留可扩展的多工具、多子 Agent、工作流编排能力。

## 当前能力

- 事件驱动 Agent Loop：`LLM -> tool calls -> LLM`
- 会话持久化（JSONL）
- 命令：`/help`、`/new`、`/stop`
- 双模式知识管理（`memory.mode` 切换，互斥）：
  - **Wiki 模式**（默认）：三层架构（`raw/` 原始资料 → `wiki/` 知识页面 → `WIKI_SCHEMA.md` 规则），知识持续积累
  - **MemU 模式**：外部向量记忆服务，`memory_retrieve` / `memory_save` / `memory_delete`
- 会话记忆（两种模式共用）：
  - 会话隔离的长期记忆：`memory/sessions/<session_key>/MEMORY.md`
  - 会话隔离的历史日志：`memory/sessions/<session_key>/HISTORY.md`
- Skills 发现与注入
- 内置工具：
  - `read_file`
  - `inspect_file`
  - `read_image`
  - `write_file`
  - `edit_file`
  - `list_dir`
  - `exec`
  - `message`
  - `web_search`、`web_fetch`
  - `cron`
  - `spawn`
  - `trigger_workflow`、`query_workflow_status`、`draft_workflow`
  - `memory_retrieve`、`memory_save`、`memory_delete`（MemU 模式时）
- 工作流与自动化：
  - cron 调度
  - heartbeat
  - 子 Agent 后台执行
  - DAG workflow engine
- Provider：
  - OpenAI-compatible
  - Anthropic-compatible
  - `auto` 自动路由

## 新增能力

### 结构化 Trace / Debug 流

现在运行时支持结构化调试事件流：

```text
run -> iteration -> intent -> tool_call -> approval -> result
```

特点：

- 主 Agent 和子 Agent 使用同一套事件模型
- 每条调试信息都可以带 `agentId / agentName`
- 可以选择是否镜像到现有 progress 输出
- 不改 UI 也能在 CLI / channel 中看到

相关配置：

```json
{
  "agents": {
    "trace": {
      "enabled": false,
      "level": "basic",
      "includeSubagents": true,
      "mirrorToProgress": true
    }
  }
}
```

说明：

- `enabled = true`：开启 trace
- `level = "basic"`：显示生命周期、工具、结果
- `level = "verbose"`：额外显示 tool call 前的意图过渡话术
- `includeSubagents = true`：包含子 Agent trace
- `mirrorToProgress = true`：把 trace 输出到现有 progress 流

CLI 中的输出示例：

```text
↳ [main][iteration] Iteration 1 started.
↳ [workspace_explorer#10a3a4db][tool_call] list_dir({"path":"."})
```

### 专门的文件/媒体读取工具

`read_file` 现在是“文本专用”工具，不再适合读取图片或其他二进制文件。

推荐使用方式：

- `inspect_file(path)`：先判断文件类型，并给出推荐工具
- `read_file(path)`：读取文本文件
- `read_image(path, prompt?)`：读取并分析图片

示例：

```text
inspect_file(path="docs/images/diagram.png")
read_image(path="docs/images/diagram.png", prompt="请总结图表内容，并提取可见文本。")
```

这样做的原因：

- 避免把 PNG/PDF 等二进制内容误读成乱码文本
- 避免把超长 tool result 直接回灌给模型，触发 provider 的输入长度上限
- 让图片分析走多模态输入，而不是走 `read_file`

另外，tool result 在写回模型上下文前也会统一截断，进一步降低 `input length` 类错误。

## 快速开始

```bash
pnpm install
pnpm dev
```

首次运行会自动创建配置文件：

```text
~/.openintern/config.json
```

网关模式：

```bash
pnpm dev -- gateway
```

这会启动后台 Agent runtime，并在终端持续打印：

- inbound/outbound 事件
- 子 Agent 活动
- approval
- cron
- heartbeat

## 前端工作流 Studio

项目内置 React + Tailwind 的运行时工作流面板，支持：

- 工作流草稿 / 发布 / 运行
- HITL 审批队列
- Trace 面板
- Roles / Tools / Skills 注册表
- 运行记录

启动：

```bash
pnpm dev:ui
```

默认地址：

```text
http://127.0.0.1:5173
```

主要路由：

- `/workflow`
- `/runs`
- `/hitl`
- `/trace`
- `/registry`

## LLM 配置示例

最小配置：

```json
{
  "agents": {
    "defaults": {
      "provider": "auto",
      "model": "gpt-4o-mini"
    },
    "trace": {
      "enabled": false,
      "level": "basic",
      "includeSubagents": true,
      "mirrorToProgress": true
    }
  },
  "providers": {
    "openaiCompatible": {
      "apiKey": "YOUR_OPENAI_COMPAT_KEY",
      "apiBase": "https://api.openai.com/v1"
    },
    "anthropicCompatible": {
      "apiKey": "YOUR_ANTHROPIC_KEY",
      "apiBase": "https://api.anthropic.com/v1",
      "anthropicVersion": "2023-06-01"
    }
  }
}
```

Provider 说明：

- `agents.defaults.provider = "openaiCompatible"`：强制走 OpenAI-compatible
- `agents.defaults.provider = "anthropicCompatible"`：强制走 Anthropic-compatible

记忆模式说明：

- `memory.mode = "wiki"`（默认）：Wiki 知识管理模式，workspace 自动创建 `raw/`、`wiki/`、`WIKI_SCHEMA.md`
- `memory.mode = "memu"`：MemU 向量记忆模式，需配置 `memory.memu.enabled = true` 和 API Key
- 两种模式互斥。旧配置中 `memu.enabled = true` 会自动推断为 `mode = "memu"`
- `memory.isolation.tenantId`：设置默认企业租户命名空间（MemU 模式）
- `memory.isolation.scopeOwners.chat = "principal"`：聊天记忆默认跟随发送者身份隔离（MemU 模式）

## Upgrade Notes

- 现有 `~/.openintern/workspace/TOOLS.md` 不会自动覆盖
- 升级后请重启运行中的 Agent 进程
- 如果想看到结构化调试输出，需要在 `~/.openintern/config.json` 中开启 `agents.trace`

## 测试

```bash
pnpm typecheck
pnpm test
```
