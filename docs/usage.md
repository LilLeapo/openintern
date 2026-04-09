# OpenIntern 使用指南

> 本文档详细说明 OpenIntern 的安装、配置、记忆系统和日常使用方法。

---

## 目录

- [安装与启动](#安装与启动)
- [API 配置](#api-配置)
- [记忆系统](#记忆系统)
  - [Wiki 模式](#wiki-模式)
  - [MemU 模式](#memu-模式)
  - [Dream 服务](#dream-服务)
  - [会话记忆](#会话记忆)
- [技能系统](#技能系统)
- [工作流](#工作流)
- [多渠道集成](#多渠道集成)
- [完整配置参考](#完整配置参考)

---

## 安装与启动

### 前置要求

- Node.js >= 20
- pnpm

### 安装

```bash
git clone <repo-url>
cd openintern
pnpm install
```

### 运行模式

**交互式终端**（日常使用）：

```bash
pnpm dev
```

启动后进入 REPL，直接输入文字对话：

```
Agent loop ready. Workspace: /home/you/.openintern/workspace
Type 'exit' to quit.
You: 帮我分析一下这篇论文
  ↳ reading raw/paper.pdf...
Agent: 这篇论文的主要内容是...
```

**网关模式**（后台服务 + 飞书等渠道集成）：

```bash
pnpm dev -- gateway
```

输出结构化日志，适合生产环境：

```
[gateway] Inbound message channel=feishu chat_id=oc_xxx
[gateway] Outbound message kind=response
```

**Web UI 工作台**：

```bash
pnpm dev:ui
```

访问 `http://127.0.0.1:5173`，包含工作流编排器、审批队列、追踪面板等模块。

### 首次运行

首次启动会自动创建：
- 配置文件：`~/.openintern/config.json`
- 工作空间：`~/.openintern/workspace/`
  - 引导文件：`AGENTS.md`、`SOUL.md`、`USER.md`、`TOOLS.md`
  - 记忆目录：`memory/MEMORY.md`、`memory/HISTORY.md`
  - Wiki 目录（wiki 模式）：`wiki/@shared/`、`raw/`、`WIKI_SCHEMA.md`

---

## API 配置

配置文件位置：`~/.openintern/config.json`

### OpenAI 兼容接口

适用于 OpenAI、DeepSeek、通义千问、Moonshot 等 OpenAI 兼容 API。

```json
{
  "agents": {
    "defaults": {
      "provider": "openaiCompatible",
      "model": "gpt-4o"
    }
  },
  "providers": {
    "openaiCompatible": {
      "apiKey": "sk-xxx",
      "apiBase": "https://api.openai.com/v1"
    }
  }
}
```

常见第三方 API Base：

| 服务 | apiBase |
|------|---------|
| OpenAI | `https://api.openai.com/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |
| Moonshot | `https://api.moonshot.cn/v1` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |

### Anthropic Claude

```json
{
  "agents": {
    "defaults": {
      "provider": "anthropicCompatible",
      "model": "claude-sonnet-4-6"
    }
  },
  "providers": {
    "anthropicCompatible": {
      "apiKey": "sk-ant-xxx",
      "apiBase": "https://api.anthropic.com/v1",
      "anthropicVersion": "2023-06-01"
    }
  }
}
```

### 自动路由

设置 `provider: "auto"`（默认值），系统会根据模型名自动选择：
- 模型名包含 `claude` → 使用 Anthropic 接口
- 其他模型 → 使用 OpenAI 兼容接口
- 如果首选接口未配置 API Key，自动回退到另一个

### 模型参数

```json
{
  "agents": {
    "defaults": {
      "model": "gpt-4o-mini",
      "maxTokens": 4096,
      "temperature": 0.1,
      "maxToolIterations": 40,
      "reasoningEffort": null
    }
  }
}
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `model` | 模型名称 | `gpt-4o-mini` |
| `maxTokens` | 最大输出 token 数 | `4096` |
| `temperature` | 生成温度 | `0.1` |
| `maxToolIterations` | 单次对话最大工具迭代数 | `40` |
| `reasoningEffort` | 推理深度（部分模型支持） | `null` |

---

## 记忆系统

OpenIntern 的记忆系统由三个独立层次组成：

```
┌─────────────────────────────────────────────┐
│  知识管理层（Wiki 或 MemU，二选一）          │
│  持久化的结构化知识，跨会话共享               │
├─────────────────────────────────────────────┤
│  Dream 层                                    │
│  每日自动整合对话，提炼用户画像和行为模式      │
├─────────────────────────────────────────────┤
│  会话记忆层                                   │
│  每个会话独立的短期记忆和历史日志              │
└─────────────────────────────────────────────┘
```

通过 `memory.mode` 切换知识管理层。Wiki 和 MemU **互斥**，不能同时启用。

### Wiki 模式

**默认模式**。受 Karpathy "LLM Wiki" 理念启发——让 LLM 不只是检索，而是主动构建和维护一个持久的结构化知识库。

#### 核心理念

传统 RAG：每次提问 → 检索碎片 → 从零拼接 → 回答（无积累）

Wiki 模式：资料摄入 → 编译为结构化页面 → 持续维护 → 查询时直接从 wiki 回答（知识持续积累）

#### 三层架构

```
workspace/
├── raw/                      # Layer 1: 原始资料（不可变，LLM 只读）
│   ├── paper-2024-xxx.pdf
│   ├── meeting-notes.md
│   └── dataset-description.txt
│
├── wiki/                     # Layer 2: 知识层（LLM 全权维护）
│   ├── @shared/              # 共享命名空间（所有人可见）
│   │   ├── index.md          # 主索引
│   │   ├── log.md            # 操作日志
│   │   ├── sources/          # 每个原始资料的摘要页
│   │   ├── entities/         # 实体页
│   │   ├── concepts/         # 概念页
│   │   └── analyses/         # 分析页
│   ├── @user-alice/          # Alice 的个人命名空间
│   │   └── ...
│   └── @dept-engineering/    # 工程部门命名空间
│       └── ...
│
└── WIKI_SCHEMA.md            # Layer 3: 规则层
```

#### 命名空间

Wiki 内容按命名空间隔离，支持三种命名空间：

| 命名空间 | 格式 | 说明 |
|----------|------|------|
| 共享 | `@shared/` | 所有人可见，默认写入位置 |
| 个人 | `@user-{principalId}/` | 按用户隔离，首次写入时自动创建 |
| 部门 | `@dept-{name}/` | 按部门隔离，通过 metadata 中的部门字段解析 |

**跨命名空间引用**：

```markdown
同一命名空间内：[[concept-name]]
跨命名空间：  [[@shared/concept-name]]
              [[@dept-engineering/api-design-patterns]]
```

**命名空间配置**：

```json
{
  "memory": {
    "mode": "wiki",
    "wiki": {
      "personal": true,
      "shared": true,
      "departmentKey": "department",
      "defaultNamespace": "shared"
    }
  }
}
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `personal` | 启用个人命名空间 | `true` |
| `shared` | 启用共享命名空间 | `true` |
| `departmentKey` | metadata 中部门字段名 | `null`（禁用） |
| `defaultNamespace` | 默认写入命名空间 | `"shared"` |

#### 四种操作

**1. Ingest（摄入）**

将原始资料转化为结构化 wiki 页面。

```
步骤：
1. 把文件放入 workspace/raw/
2. 对话中让 agent 摄入：
   You: 请帮我摄入 raw/paper-2024-xxx.pdf
3. Agent 读取原始资料
4. 与你讨论关键要点（可跳过）
5. 创建/更新 wiki 页面：source summary + entity pages + concept pages
6. 自动更新 index.md 和 log.md
```

Karpathy 建议一次摄入一个资料并全程参与——摄入过程本身就是学习过程。但也支持批量模式。

**2. Query（查询）**

从 wiki 综合回答问题。

```
You: RAG 和 Wiki 模式有什么区别？
Agent: 根据 wiki 中的分析...（引用 [[rag-vs-wiki]] 和 [[@shared/karpathy-llm-wiki]]）
```

如果查询产生了有价值的综合分析，agent 会自动将其存为 `analyses/` 页面，避免下次重新推导。

**3. Lint（健康检查）**

```
You: 帮 wiki 做一次体检
Agent: 检查结果：
  - 3 个断链
  - 1 个孤儿页
  - 2 个跨命名空间重复概念，建议合并到 @shared/
  是否自动修复？
```

**4. Index & Log**

- `{namespace}/index.md`：一行一页的索引，agent 用它定位知识（中小规模下比向量检索更高效）
- `{namespace}/log.md`：操作时间线，记录每次摄入/查询/检查

#### Wiki 页面格式

每个页面以 YAML frontmatter 开头：

```yaml
---
title: "Transformer 注意力机制"
type: concept
namespace: "@shared"
created: 2026-04-09
updated: 2026-04-09
sources: ["raw/attention-is-all-you-need.pdf"]
---

## 概述

Transformer 架构的核心创新是自注意力机制...

## 相关

- [[multi-head-attention]]
- [[@shared/bert]]
- [[@user-alice/transformer-notes]]
```

### MemU 模式

通过外部 MemU 向量记忆服务管理知识，适合大规模检索或已有 MemU 基础设施的场景。

#### 配置

```json
{
  "memory": {
    "mode": "memu",
    "memu": {
      "enabled": true,
      "apiKey": "YOUR_MEMU_KEY",
      "baseUrl": "https://api.memu.so",
      "agentId": "openintern",
      "apiStyle": "cloudV3",
      "scopes": {
        "chat": "chat",
        "papers": "papers"
      },
      "retrieve": true,
      "memorize": true,
      "memorizeMode": "tool"
    },
    "isolation": {
      "tenantId": "your_company_id",
      "scopeOwners": {
        "chat": "principal",
        "papers": "conversation"
      }
    }
  }
}
```

#### 记忆工具

| 工具 | 说明 |
|------|------|
| `memory_retrieve` | 按语义检索记忆。支持 `scope` 参数（`chat` / `papers` / `all`） |
| `memory_save` | 保存新记忆。Agent 会根据策略决定保存/跳过/询问 |
| `memory_delete` | 清除指定作用域的全部记忆。需要用户确认 |

#### 记忆作用域

| 作用域 | 用途 | 默认隔离方式 |
|--------|------|-------------|
| `chat` | 对话偏好、用户上下文 | 按用户（`principal`） |
| `papers` | 文档、知识库 | 按会话（`conversation`） |

#### 记忆模式

| 模式 | 说明 |
|------|------|
| `tool` | Agent 通过工具调用显式保存（默认，更精确） |
| `auto` | 每次对话后自动后台保存（更全面，可能有噪声） |

#### API 风格

| apiStyle | 适用场景 |
|----------|---------|
| `cloudV3` | MemU 云服务（需要 API Key） |
| `localSimple` | 本地部署的简易 MemU 实例 |
| `mem0V1` | Mem0 兼容接口 |

### Dream 服务

Dream（"做梦"）是一个**跨会话的自动记忆整合服务**。就像人在睡眠中整理记忆一样，Dream 每天定时回顾所有会话，提炼出持久的用户洞察。

#### 工作原理

```
每天凌晨 3:00（可配置）
    ↓
扫描 workspace/sessions/ 目录
读取最近 24 小时的所有 session JSONL
    ↓
发送给 LLM 分析
    ↓
提取用户画像 → 写入 USER.md
提取持久事实 → 写入 memory/MEMORY.md
追加时间线 → 写入 memory/HISTORY.md
```

#### Dream 提取的信息类型

**用户画像**（写入 `USER.md`）：
- 用户角色、专业背景
- 沟通偏好（语言、简洁程度、正式度）
- 技术偏好（工具、框架、编码风格）
- 反复出现的兴趣领域
- 工作习惯和协作方式

**行为洞察**（写入 `memory/MEMORY.md`）：
- 用户给出的纠正和反馈（该避免什么、该重复什么）
- 行为模式（哪些问题反复出现、什么令用户不满）
- 重要决策和项目上下文
- 未解决的话题和待跟进事项

#### 配置

```json
{
  "memory": {
    "dream": {
      "enabled": true,
      "cronExpression": "0 3 * * *",
      "maxSessionsPerRun": 20
    }
  }
}
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `enabled` | 启用 dream 服务 | `true` |
| `cronExpression` | Cron 表达式（何时运行） | `0 3 * * *`（每天 3:00） |
| `maxSessionsPerRun` | 每次最多处理的会话数 | `20` |

#### 为什么不用单独的 DREAM.md？

Dream 的产出直接整合进 `USER.md` 和 `memory/MEMORY.md`——这两个文件本来就在每次对话的 system prompt 中加载。不需要额外的文件和加载机制。Agent 越用越"懂"你，是因为它每次对话开始时就已经读到了 Dream 整理的用户画像。

### 会话记忆

无论选择 Wiki 还是 MemU 模式，每个会话都有独立的短期记忆。

#### 存储位置

```
workspace/sessions/
├── cli_direct.jsonl          # CLI 交互的默认会话
├── cron_abc123.jsonl         # Cron 任务会话
└── feishu_oc_xxx.jsonl       # 飞书渠道会话
```

每个 `.jsonl` 文件是一个会话的完整记录：
- 第 1 行：元数据（创建时间、最后更新、整合位置）
- 后续每行：一条消息（role、content、timestamp、tool_calls 等）

#### 记忆整合

当会话消息超过 `memoryWindow`（默认 100 条）时，`MemoryConsolidator` 自动运行：
1. 取出较早的消息
2. 用 LLM 总结为长期记忆和历史条目
3. 写入 `memory/sessions/{session_key}/MEMORY.md` 和 `HISTORY.md`
4. 标记已整合位置，避免重复处理

#### 配置

```json
{
  "agents": {
    "defaults": {
      "memoryWindow": 100
    }
  }
}
```

---

## 技能系统

技能（Skills）是可插拔的提示词包，扩展 Agent 的能力。

### 内置技能

| 技能 | 适用模式 | 说明 |
|------|---------|------|
| `wiki-ingest` | Wiki | 将原始资料摄入 wiki |
| `wiki-query` | Wiki | 从 wiki 查询并综合回答 |
| `wiki-lint` | Wiki | Wiki 健康检查 |
| `dream` | 通用 | 手动触发 dream 整合 |
| `selective-memory` | MemU | 选择性记忆写入策略 |
| `pdf-ingest` | MemU | PDF 文档摄入到 MemU |

### 使用技能

在对话中引用技能名即可。Agent 会自动读取对应的 `SKILL.md` 文件并按流程执行。

```
You: 帮我把 raw/ 里的新论文摄入 wiki
Agent: (读取 wiki-ingest 技能) 发现 raw/new-paper.pdf，正在处理...
```

### 自定义技能

在 `skills/` 目录下创建技能：

```
skills/
└── my-skill/
    └── SKILL.md
```

`SKILL.md` 格式：

```yaml
---
name: my-skill
description: 技能描述，Agent 据此判断何时使用
---

# 技能名

使用说明和流程定义...
```

---

## 工作流

工作流引擎支持 DAG（有向无环图）定义，适合多步骤自动化任务。

### 快速示例

```json
{
  "id": "research_pipeline",
  "trigger": { "type": "manual" },
  "execution": { "mode": "serial" },
  "nodes": [
    {
      "id": "search",
      "role": "researcher",
      "taskPrompt": "搜索关于 {{trigger.topic}} 的最新论文",
      "outputKeys": ["papers"]
    },
    {
      "id": "summarize",
      "role": "scientist",
      "taskPrompt": "总结以下论文：{{search.papers}}",
      "dependsOn": ["search"],
      "outputKeys": ["summary"]
    }
  ]
}
```

### 工作流管理

- **Web UI**：`http://127.0.0.1:5173/workflow`
- **工具**：`trigger_workflow`、`query_workflow_status`、`draft_workflow`
- **存储**：`workspace/workflows/` (已发布) 和 `workspace/workflows/drafts/` (草稿)

### 人工审批（HITL）

在节点上启用审批拦截高风险操作：

```json
{
  "id": "dangerous_step",
  "hitl": {
    "enabled": true,
    "highRiskTools": ["exec", "write_file"],
    "approvalTarget": "owner",
    "approvalTimeoutMs": 7200000
  }
}
```

---

## 多渠道集成

### CLI

默认渠道，`pnpm dev` 启动。支持命令：
- `exit` — 退出
- `/help` — 帮助
- `/new` — 新建会话
- `/stop` — 停止当前任务

### 飞书

配置后自动通过长连接收发消息，无需公网回调地址。

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "appId": "cli_xxx",
      "appSecret": "xxx",
      "allowFrom": ["*"],
      "reactEmoji": "THUMBSUP"
    }
  }
}
```

配置步骤：
1. 飞书开放平台创建企业自建应用
2. 启用事件订阅：`im.message.receive_v1`
3. 设置订阅模式为**长连接**
4. 填入 `appId` 和 `appSecret`
5. 以 `pnpm dev -- gateway` 启动

### MCP 服务器

通过 Model Context Protocol 集成外部工具：

```json
{
  "mcp": {
    "servers": {
      "my-server": {
        "command": "npx",
        "args": ["-y", "@my/mcp-server"],
        "env": { "API_KEY": "xxx" }
      }
    }
  }
}
```

---

## 完整配置参考

`~/.openintern/config.json` 完整结构：

```json
{
  "agents": {
    "defaults": {
      "workspace": "~/.openintern/workspace",
      "model": "gpt-4o-mini",
      "provider": "auto",
      "maxTokens": 4096,
      "temperature": 0.1,
      "maxToolIterations": 40,
      "memoryWindow": 100,
      "reasoningEffort": null
    },
    "subagentConcurrency": {
      "maxConcurrent": 3
    },
    "trace": {
      "enabled": false,
      "level": "basic",
      "includeSubagents": true,
      "mirrorToProgress": true
    }
  },
  "roles": {
    "researcher": {
      "systemPrompt": "You are a research assistant...",
      "allowedTools": ["web_search", "web_fetch", "memory_save", "memory_retrieve"],
      "memoryScope": "papers",
      "maxIterations": 20
    }
  },
  "providers": {
    "openaiCompatible": {
      "apiKey": "",
      "apiBase": "https://api.openai.com/v1"
    },
    "anthropicCompatible": {
      "apiKey": "",
      "apiBase": "https://api.anthropic.com/v1",
      "anthropicVersion": "2023-06-01"
    }
  },
  "memory": {
    "mode": "wiki",
    "dream": {
      "enabled": true,
      "cronExpression": "0 3 * * *",
      "maxSessionsPerRun": 20
    },
    "wiki": {
      "personal": true,
      "shared": true,
      "departmentKey": null,
      "defaultNamespace": "shared"
    },
    "memu": {
      "enabled": false,
      "apiKey": "",
      "baseUrl": "https://api.memu.so",
      "agentId": "openintern",
      "apiStyle": "cloudV3",
      "scopes": { "chat": "chat", "papers": "papers" },
      "timeoutMs": 15000,
      "retrieve": true,
      "memorize": true,
      "memorizeMode": "tool"
    },
    "isolation": {
      "tenantId": "default",
      "scopeOwners": {
        "chat": "principal",
        "papers": "conversation"
      }
    }
  },
  "tools": {
    "web": {
      "proxy": null,
      "search": { "apiKey": "", "maxResults": 5 }
    },
    "exec": { "timeout": 60 },
    "restrictToWorkspace": false
  },
  "channels": {
    "sendProgress": true,
    "sendToolHints": false,
    "feishu": {
      "enabled": false,
      "appId": "",
      "appSecret": "",
      "verificationToken": "",
      "encryptKey": "",
      "allowFrom": [],
      "webhookPath": "/feishu/events",
      "reactEmoji": "THUMBSUP"
    }
  },
  "gateway": {
    "host": "0.0.0.0",
    "port": 18790,
    "heartbeat": {
      "enabled": true,
      "intervalS": 1800
    }
  },
  "mcp": {
    "servers": {}
  }
}
```

> 只需配置你用到的部分，其余使用默认值。配置文件通过 `mergeDeep` 与默认值合并，不会因为缺少字段而报错。
