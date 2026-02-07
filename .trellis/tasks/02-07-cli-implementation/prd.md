# 实现 CLI 工具

## 目标

实现 Agent System 的命令行工具，提供开发、运行、调试和诊断功能。

这是实现顺序的第6步（最后阶段），前置依赖（Storage、Backend、Agent Runtime、Python MCP Server、Web UI）已完成。

---

## 需求

### 1. `agent dev` - 开发模式启动 (P0)

**功能**：
- 启动 Backend Server（Express + SSE）
- 启动 Python MCP Server（stdio 模式）
- 启动 Web UI（如果存在）
- 显示启动状态和访问地址

**参数**：
- `--port <number>` - Backend 端口（默认 3000）
- `--mcp-stdio` - 使用 stdio 模式连接 MCP（默认）
- `--no-web` - 不启动 Web UI

**输出示例**：
```
✓ Backend Server started at http://localhost:3000
✓ Python MCP Server connected (stdio)
✓ Web UI started at http://localhost:5173
```

**实现要点**：
- 复用 `src/backend/server.ts` 的 `createServer()`
- 启动 Python MCP Server 子进程
- 优雅关闭（Ctrl+C 时清理资源）

---

### 2. `agent run` - 发起任务执行 (P0)

**功能**：
- 向 Backend 发送 POST /api/runs 请求
- 创建新的 run 并开始执行
- 输出 run_id 和执行状态

**参数**：
- `<text>` - 任务描述（必需）
- `--session <key>` - Session key（默认 "default"）
- `--wait` - 等待执行完成
- `--stream` - 流式输出事件

**输出示例**：
```
Created run: run_abc123
Session: s_default
Status: running

[--wait 模式]
✓ Run completed in 5.2s
```

**实现要点**：
- 调用 Backend API（需要 Backend 运行）
- 如果 Backend 未运行，提示先运行 `agent dev`
- `--stream` 模式连接 SSE 端点

---

### 3. `agent tail` - 流式查看事件 (P0)

**功能**：
- 连接 SSE 端点 `/api/runs/:run_id/stream`
- 实时打印事件流
- 格式化显示（类型、时间戳、关键信息）

**参数**：
- `<run_id>` - Run ID（必需）
- `--format <json|pretty>` - 输出格式（默认 pretty）

**输出示例（pretty 模式）**：
```
[12:34:56] run.started
[12:34:57] step.started (step_0001)
[12:34:58] tool.called: memory_search
[12:34:59] tool.result: 3 items found
[12:35:00] step.completed
```

**实现要点**：
- 使用 EventSource 或 fetch 连接 SSE
- 解析 JSONL 事件
- 彩色输出（可选）

---

### 4. `agent export` - 导出事件日志 (P1)

**功能**：
- 读取 `data/sessions/<session>/runs/<run_id>/events.jsonl`
- 导出到指定文件
- 可选过滤和格式转换

**参数**：
- `<run_id>` - Run ID（必需）
- `--out <file>` - 输出文件（默认 stdout）
- `--format <jsonl|json>` - 输出格式（默认 jsonl）
- `--filter <type>` - 过滤事件类型（可选）

**输出示例**：
```
Exported 127 events to trace.jsonl
```

**实现要点**：
- 复用 `EventStore.readStream()`
- 支持过滤（按 type、时间范围）
- JSON 格式输出为数组

---

### 5. `agent skills list` - 列出工具 (P1)

**功能**：
- 连接 MCP Server
- 调用 `tools/list`
- 显示工具列表（名称、描述、参数）

**参数**：
- `--format <table|json>` - 输出格式（默认 table）

**输出示例（table 模式）**：
```
Available Tools:

Name              Description                    Provider
────────────────  ─────────────────────────────  ──────────
memory_search     Search memory items            mcp:main
memory_get        Get memory item by ID          mcp:main
memory_write      Write new memory item          mcp:main
```

**实现要点**：
- 启动临时 MCP Client
- 调用 `listTools()`
- 表格格式化输出

---

### 6. `agent doctor` - 环境检查 (P1)

**功能**：
- 检查 data 目录权限
- 检查 Python MCP Server 可用性
- 检查 Backend 连通性
- 显示诊断报告

**参数**：
- `--fix` - 自动修复问题（可选）

**输出示例**：
```
Running diagnostics...

✓ Data directory: /path/to/data (writable)
✓ Python MCP Server: Available (python 3.11.0)
✗ Backend Server: Not running
  → Run `agent dev` to start

Summary: 2/3 checks passed
```

**实现要点**：
- 检查文件系统权限
- 尝试启动 MCP Server 测试连通性
- 尝试连接 Backend API

---

## 验收标准

### 基础功能
- [ ] `agent dev` 可以启动 Backend + MCP Server
- [ ] `agent run "<text>"` 可以创建 run 并返回 run_id
- [ ] `agent tail <run_id>` 可以实时显示事件流
- [ ] `agent export <run_id>` 可以导出 events.jsonl
- [ ] `agent skills list` 可以列出 MCP 工具
- [ ] `agent doctor` 可以检查环境状态

### 错误处理
- [ ] Backend 未运行时，提示用户先运行 `agent dev`
- [ ] Run ID 不存在时，显示友好错误信息
- [ ] MCP Server 连接失败时，显示诊断信息

### 代码质量
- [ ] TypeScript strict mode 通过
- [ ] ESLint 通过
- [ ] 遵循 logging-guidelines.md 日志规范
- [ ] 遵循 error-handling.md 错误处理模式

### 用户体验
- [ ] 所有命令有 `--help` 选项
- [ ] 输出格式清晰易读
- [ ] 进度提示（长时间操作）
- [ ] 优雅退出（Ctrl+C）

---

## 技术说明

### 目录结构

```
src/cli/
├── index.ts              # CLI 入口，参数解析
├── commands/
│   ├── dev.ts           # agent dev
│   ├── run.ts           # agent run
│   ├── tail.ts          # agent tail
│   ├── export.ts        # agent export
│   ├── skills.ts        # agent skills
│   └── doctor.ts        # agent doctor
└── utils/
    └── output.ts        # 输出格式化工具
```

### 依赖库

需要添加到 package.json：
- `commander` - CLI 参数解析
- `chalk` - 彩色输出（可选）
- `cli-table3` - 表格输出（可选）

### 可复用组件

| 组件 | 文件路径 | 用途 |
|------|---------|------|
| `createServer()` | `src/backend/server.ts` | dev 命令启动服务器 |
| `EventStore.readStream()` | `src/backend/store/event-store.ts` | tail/export 读取事件 |
| `MCPClient` | `src/backend/agent/mcp-client.ts` | skills 命令 |
| `logger` | `src/utils/logger.ts` | 日志输出 |

### package.json 配置

需要添加 bin 字段：
```json
{
  "bin": {
    "agent": "./dist/cli/index.js"
  }
}
```

### 构建配置

需要配置 TypeScript 编译 CLI 入口：
- 输出到 `dist/cli/`
- 添加 shebang: `#!/usr/bin/env node`

---

## 参考文档

- **Project.md 第8节**：CLI 命令完整规格
- **spec/backend/directory-structure.md**：CLI 目录结构
- **spec/backend/error-handling.md**：错误处理模式
- **spec/backend/logging-guidelines.md**：日志格式规范
