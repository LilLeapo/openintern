# Agent System

> 基于 TypeScript + Python 的单 Agent 系统，支持对话式任务执行、工具调用、事件溯源和 Web UI。

---

## 📋 目录

- [项目简介](#项目简介)
- [核心特性](#核心特性)
- [架构概览](#架构概览)
- [快速开始](#快速开始)
- [CLI 命令](#cli-命令)
- [开发指南](#开发指南)
- [项目结构](#项目结构)
- [常见问题](#常见问题)

---

## 项目简介

Agent System 是一个完整的 AI Agent 运行时系统，提供：

- **Agent Runtime**：支持 plan/act/observe 循环、工具调用、上下文管理
- **事件溯源存储**：使用 JSONL 追加写，无需数据库
- **Web UI**：实时查看对话、事件流、工具调用 trace
- **CLI 工具**：本地开发、任务执行、日志导出
- **Python MCP Server**：提供 memory、retrieval 等工具能力

### 技术栈

- **Backend**: Node.js + TypeScript + Express
- **Frontend**: React + TypeScript
- **Storage**: JSONL 文件（事件溯源）
- **Tools**: Python MCP Server
- **CLI**: Commander.js

---

## 核心特性

### ✅ 已实现（MVP）

- [x] **CLI 工具**（6 个命令）
  - `agent dev` - 启动开发服务器
  - `agent run` - 创建并执行任务
  - `agent tail` - 实时查看事件流
  - `agent export` - 导出事件日志
  - `agent skills list` - 列出 MCP 工具
  - `agent doctor` - 环境诊断

- [x] **Backend API**
  - REST API（创建 run、查询 run、事件流）
  - SSE 实时事件推送
  - Run 队列管理

- [x] **Agent Runtime**
  - Agent loop（plan/act/observe）
  - Context Manager（上下文管理）
  - Tool Router（工具路由）
  - MCP Client（Python 工具调用）

- [x] **Storage Layer**
  - EventStore（JSONL 事件存储）
  - CheckpointStore（状态快照）
  - MemoryStore（记忆存储）
  - ProjectionStore（投影生成）

- [x] **Web UI**
  - Chat 界面
  - Run Trace 回放
  - 实时事件流

- [x] **Python MCP Server**
  - Memory 工具（search/get/write）
  - MCP 协议实现

### 🚧 待实现

- [ ] 多 Agent 调度
- [ ] 向量检索（语义搜索）
- [ ] 完整的权限系统
- [ ] 更多 MCP 工具

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                         Web UI (React)                       │
│                  Chat | Runs | Trace | Tools                │
└─────────────────────────────────────────────────────────────┘
                              ↓ HTTP/SSE
┌─────────────────────────────────────────────────────────────┐
│                    Backend (Node.js/TS)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  REST API    │  │  SSE Stream  │  │  Run Queue   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Agent Runtime                            │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐           │  │
│  │  │Agent Loop│  │Context   │  │Tool      │           │  │
│  │  │          │  │Manager   │  │Router    │           │  │
│  │  └──────────┘  └──────────┘  └──────────┘           │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Storage Layer                            │  │
│  │  EventStore | CheckpointStore | MemoryStore          │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              ↓ MCP (stdio)
┌─────────────────────────────────────────────────────────────┐
│                  Python MCP Server                           │
│              memory_search | memory_get | memory_write       │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    Storage (JSONL Files)                     │
│  data/sessions/<session>/runs/<run_id>/events.jsonl         │
│  data/memory/shared/items/<memory_id>.json                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 快速开始

### 前置要求

- **Node.js** >= 20.0.0
- **Python** >= 3.9
- **pnpm** >= 8.0.0

### 安装

```bash
# 1. 克隆项目
git clone <repository-url>
cd agent-system

# 2. 安装 Node.js 依赖
pnpm install

# 3. 安装 Python 依赖（可选，如果需要 MCP Server）
cd python
pip3 install -e .
cd ..
```

### 启动开发服务器

```bash
# 启动 Backend + MCP Server
pnpm cli dev

# 输出：
# ✓ Backend Server started at http://localhost:3000
# ✓ Python MCP Server connected (stdio)
# ℹ Web UI: Run "pnpm dev:web" in another terminal
```

### 运行第一个任务

```bash
# 在另一个终端
pnpm cli run "计算 1+1" --session demo

# 输出：
# Run ID: run_abc123
# Session: s_demo
# Status: running
```

### 查看事件流

```bash
pnpm cli tail run_abc123

# 输出：
# [12:34:56] run.started
# [12:34:57] step.started (step_0001)
# [12:34:58] llm.called
# [12:34:59] step.completed
```

---

## CLI 命令

### `agent dev` - 启动开发服务器

启动 Backend Server、Python MCP Server 和 Web UI。

```bash
pnpm cli dev [options]

选项：
  -p, --port <number>  Backend 端口（默认：3000）
  --mcp-stdio          使用 stdio 模式连接 MCP（默认）
  --no-mcp-stdio       禁用 MCP Server
  --web                显示 Web UI 信息（默认）
  --no-web             隐藏 Web UI 信息
```

**示例**：

```bash
# 默认启动
pnpm cli dev

# 指定端口
pnpm cli dev --port 8080

# 不启动 MCP Server
pnpm cli dev --no-mcp-stdio
```

---

### `agent run` - 创建并执行任务

向 Backend 发送任务请求，创建新的 run。

```bash
pnpm cli run <text> [options]

参数：
  text                 任务描述（必需）

选项：
  -s, --session <key>  Session key（默认：default）
  -w, --wait           等待执行完成
  --stream             流式输出事件
```

**示例**：

```bash
# 基本用法
pnpm cli run "帮我写一个 Python 函数"

# 指定 session
pnpm cli run "分析这段代码" --session project-a

# 等待完成
pnpm cli run "生成报告" --wait

# 流式输出
pnpm cli run "计算斐波那契数列" --stream
```

---

### `agent tail` - 实时查看事件流

连接 SSE 端点，实时显示 run 的事件流。

```bash
pnpm cli tail <run_id> [options]

参数：
  run_id               Run ID（必需）

选项：
  --format <format>    输出格式（json|pretty，默认：pretty）
```

**示例**：

```bash
# Pretty 格式（默认）
pnpm cli tail run_abc123

# JSON 格式
pnpm cli tail run_abc123 --format json
```

**输出示例（pretty 格式）**：

```
[12:34:56] run.started
[12:34:57] step.started (step_0001)
[12:34:58] tool.called: memory_search
[12:34:59] tool.result: 3 items found
[12:35:00] step.completed
[12:35:01] run.completed
```

---

### `agent export` - 导出事件日志

导出 run 的事件日志到文件。

```bash
pnpm cli export <run_id> [options]

参数：
  run_id                 Run ID（必需）

选项：
  -o, --out <file>       输出文件（默认：stdout）
  -f, --format <format>  输出格式（jsonl|json，默认：jsonl）
  --filter <type>        过滤事件类型
  -s, --session <key>    Session key（默认：default）
```

**示例**：

```bash
# 导出到文件
pnpm cli export run_abc123 --out trace.jsonl

# 导出为 JSON 数组
pnpm cli export run_abc123 --format json --out trace.json

# 过滤特定事件类型
pnpm cli export run_abc123 --filter "tool.called"

# 指定 session
pnpm cli export run_abc123 --session demo --out demo-trace.jsonl
```

---

### `agent skills list` - 列出 MCP 工具

连接 MCP Server，列出所有可用的工具。

```bash
pnpm cli skills list [options]

选项：
  --format <format>  输出格式（table|json，默认：table）
```

**示例**：

```bash
# 表格格式（默认）
pnpm cli skills list

# JSON 格式
pnpm cli skills list --format json
```

**输出示例（table 格式）**：

```
Available Tools:

Name              Description                    Provider
────────────────  ─────────────────────────────  ──────────
memory_search     Search memory items            mcp:main
memory_get        Get memory item by ID          mcp:main
memory_write      Write new memory item          mcp:main
```

---

### `agent doctor` - 环境诊断

检查开发环境配置，诊断常见问题。

```bash
pnpm cli doctor [options]

选项：
  --fix  自动修复问题（可选）
```

**示例**：

```bash
# 运行诊断
pnpm cli doctor

# 自动修复
pnpm cli doctor --fix
```

**输出示例**：

```
Running Diagnostics

✓ Data directory: /path/to/data (writable)
✓ Python MCP Server: Available (python 3.10.12)
✗ Backend Server: Not running
  → Run "agent dev" to start

⚠ 2/3 checks passed
```

---

## 开发指南

### 项目结构

```
agent-system/
├── src/
│   ├── backend/           # Backend 代码
│   │   ├── api/          # REST API
│   │   ├── agent/        # Agent Runtime
│   │   ├── store/        # Storage Layer
│   │   ├── queue/        # Run Queue
│   │   └── server.ts     # Server 入口
│   ├── cli/              # CLI 工具
│   │   ├── commands/     # CLI 命令
│   │   └── utils/        # CLI 工具
│   ├── types/            # TypeScript 类型定义
│   └── utils/            # 工具函数
├── python/               # Python MCP Server
│   └── src/
│       └── mcp_server/
│           ├── server.py # MCP Server 入口
│           ├── tools/    # MCP 工具实现
│           └── protocol/ # MCP 协议
├── data/                 # 运行时数据（gitignored）
│   ├── sessions/         # Session 数据
│   └── memory/           # Memory 数据
├── .trellis/             # Trellis 工作流
│   ├── scripts/          # 工作流脚本
│   ├── spec/             # 开发规范
│   ├── tasks/            # 任务管理
│   └── workspace/        # 工作空间
├── Project.md            # 项目规格文档
├── AGENTS.md             # Agent 系统文档
└── README.md             # 本文档
```

### 开发命令

```bash
# 开发模式（自动重启）
pnpm dev

# 类型检查
pnpm typecheck

# 代码检查
pnpm lint

# 运行测试
pnpm test

# 构建
pnpm build

# CLI 命令（开发模式）
pnpm cli <command>
```

### 代码规范

项目使用 Trellis 工作流管理开发流程，所有代码必须遵循以下规范：

- **Backend**: `.trellis/spec/backend/`
  - 目录结构规范
  - 错误处理规范
  - 日志规范
  - 数据库规范

- **Frontend**: `.trellis/spec/frontend/`
  - 组件规范
  - Hook 规范
  - 类型安全规范
  - 状态管理规范

- **Guides**: `.trellis/spec/guides/`
  - 跨层思考指南
  - 代码复用指南

### 提交规范

使用 Conventional Commits 格式：

```bash
type(scope): description

# 类型
feat:     新功能
fix:      Bug 修复
docs:     文档更新
refactor: 代码重构
test:     测试相关
chore:    构建/工具相关

# 示例
feat(cli): 添加 export 命令
fix(agent): 修复 context 溢出问题
docs(readme): 更新安装说明
```

---

## 常见问题

### 1. Python MCP Server 启动失败

**问题**：`spawn python ENOENT`

**原因**：系统中没有 `python` 命令，只有 `python3`。

**解决方案**：

项目已修复此问题（使用 `python3`），如果仍有问题：

```bash
# 方案 1：设置环境变量
export PYTHON_PATH=python3

# 方案 2：创建软链接
sudo ln -s /usr/bin/python3 /usr/bin/python
```

### 2. Python 包未安装

**问题**：`ModuleNotFoundError: No module named 'mcp_server'`

**解决方案**：

```bash
# 安装 Python 包
cd python
pip3 install -e .
cd ..
```

### 3. Backend Server 端口被占用

**问题**：`Error: listen EADDRINUSE: address already in use :::3000`

**解决方案**：

```bash
# 方案 1：使用其他端口
pnpm cli dev --port 8080

# 方案 2：杀死占用端口的进程
lsof -ti:3000 | xargs kill -9
```

### 4. 事件文件找不到

**问题**：`Run not found: run_abc123`

**原因**：Session 不匹配。

**解决方案**：

```bash
# 创建 run 时指定 session
pnpm cli run "任务" --session demo

# 导出时也要指定相同的 session
pnpm cli export run_abc123 --session demo
```

### 5. 如何清理测试数据

```bash
# 删除所有运行时数据
rm -rf data/

# 删除特定 session
rm -rf data/sessions/s_demo/

# 删除特定 run
rm -rf data/sessions/s_demo/runs/run_abc123/
```

---

## 贡献指南

欢迎贡献！请遵循以下流程：

1. Fork 项目
2. 创建功能分支（`git checkout -b feature/amazing-feature`）
3. 遵循代码规范（`.trellis/spec/`）
4. 提交更改（`git commit -m 'feat: add amazing feature'`）
5. 推送到分支（`git push origin feature/amazing-feature`）
6. 创建 Pull Request

### 开发流程

使用 Trellis 工作流：

```bash
# 1. 初始化开发者身份（首次）
./.trellis/scripts/init-developer.sh your-name

# 2. 获取当前上下文
./.trellis/scripts/get-context.sh

# 3. 创建任务
./.trellis/scripts/task.sh create "任务标题" --slug task-name

# 4. 开发...

# 5. 提交代码
git add .
git commit -m "feat: ..."

# 6. 记录会话
./.trellis/scripts/add-session.sh --title "..." --commit "hash"
```

---

## 许可证

MIT License

---

## 联系方式

- **Issues**: [GitHub Issues](https://github.com/your-repo/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-repo/discussions)

---

**Happy Coding! 🚀**
