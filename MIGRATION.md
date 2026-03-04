# Claude Agent SDK 迁移总结

## 概述

项目已成功从自定义 agent 实现迁移到 Claude Agent SDK。

## 核心变更

### 1. Agent Loop
- **原实现**: `src/agent/loop.ts` - 自定义 LLM 调用和工具执行循环
- **新实现**: `src/agent/sdk-agent.ts` - 使用 SDK 的 `query()` 函数
- **优势**: SDK 内置工具执行、上下文管理、错误处理

### 2. 工具系统
- **原实现**: 自定义工具注册和执行（`src/tools/`）
- **新实现**: SDK 内置工具（Read, Write, Edit, Bash, Glob, Grep, Task）
- **优势**: 无需维护工具实现代码

### 3. 会话管理
- **原实现**: 自定义会话存储（`src/agent/session/`）
- **新实现**: SDK 内置会话管理（`resume` 和 `sessionId` 选项）
- **优势**: 自动持久化和恢复

### 4. MCP 集成
- **原实现**: 自定义 MCP 管理器（`src/mcp/`）
- **新实现**: SDK 的 `mcpServers` 选项
- **优势**: 简化配置和连接管理

### 5. 子代理
- **原实现**: 自定义子代理管理器（`src/agent/subagent/`）
- **新实现**: SDK 的 `agents` 选项和 Task 工具
- **优势**: 内置子代理调用和上下文隔离

### 6. Hooks
- **原实现**: 自定义事件总线（`src/bus/`）
- **新实现**: SDK 的 `hooks` 选项
- **优势**: 标准化的生命周期钩子

## 保留的扩展功能

以下功能继续使用原实现：

1. **飞书集成** (`src/channels/feishu.ts`)
2. **定时任务** (`src/cron/`)
3. **消息总线** (`src/bus/`) - 用于扩展功能通信

## 文件结构

```
src/
  agent/
    sdk-agent.ts          # 新的 SDK agent 实现
    loop.ts               # 原实现（保留）
  cli/
    repl-full.ts          # 完整版 CLI（SDK + 扩展功能）
    repl-sdk.ts           # 简化版 CLI（仅 SDK）
    repl.ts               # 原实现（保留）
  index.ts                # 入口（使用 repl-full.ts）
```

## 使用方式

### 环境变量
```bash
export ANTHROPIC_API_KEY=your-api-key
```

### 运行
```bash
pnpm dev
```

### 命令
- `/help` - 显示帮助
- `/new` - 开始新会话
- `/stop` - 停止当前任务
- `exit` - 退出程序

## 配置

配置文件位置：`~/.openintern/config.json`

关键配置项：
- `agents.defaults.model` - 模型名称
- `mcp.servers` - MCP 服务器配置
- `channels.feishu` - 飞书集成配置

## 内置子代理

- `code-reviewer` - 代码审查专家
- `test-runner` - 测试运行器

使用示例：
```
请使用 code-reviewer 代理审查 src/agent/sdk-agent.ts
```

## 下一步

1. 测试所有功能
2. 根据需要添加更多自定义 hooks
3. 配置更多 MCP 服务器
4. 添加更多子代理定义
