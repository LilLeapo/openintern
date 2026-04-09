# OpenIntern Agent

[English](./README.en.md) | 简体中文

**面向企业 AI 转型的生产级 Agent 编排平台**

OpenIntern 是一个为企业打造的 AI Agent 自动化框架，专注于将 AI 能力安全、可控地集成到业务流程中。通过工作流编排、人工审批和多渠道集成，帮助企业实现从单点 AI 应用到全流程智能化的跃迁。

> **详细使用指南**：[docs/usage.md](./docs/usage.md) — 包含安装配置、记忆系统（Wiki/MemU/Dream）、命名空间、技能系统、工作流等完整说明。

---

## 🎯 为什么选择 OpenIntern

### 企业级 AI 转型的核心挑战

传统 AI 工具往往面临以下问题：
- **缺乏流程控制**：AI 决策无法融入现有审批流程
- **安全风险高**：工具调用权限难以精细管控
- **孤岛化应用**：各部门独立使用 AI，无法形成协同
- **可观测性差**：AI 行为黑盒，难以追溯和优化

### OpenIntern 的解决方案

**1. 工作流编排引擎**
- DAG（有向无环图）工作流定义，支持串行/并行执行
- 节点级重试、超时和错误处理
- 上下文插值和输出传递（`{{trigger.input}}`, `{{node_id.output}}`）
- 适用场景：文档审核流程、数据处理管道、多步骤研究任务

**2. 人工审批机制（HITL）**
- 高风险工具调用自动拦截（如 `exec`、数据库操作）
- 可配置审批目标（owner/manager/custom）
- 审批超时和降级策略
- Web UI 实时审批队列
- **即将支持**：多级审批、审批历史追溯、审批模板

**3. 多租户和权限隔离**
- 基于角色的工具访问控制（RBAC）
- 会话级内存隔离
- 租户级数据隔离（tenant_id）
- 企业知识库 ACL 控制（规划中）

**4. 全链路可观测性**
- 结构化事件追踪（run → iteration → tool_call → approval → result）
- 主 Agent 和子 Agent 统一追踪
- Web UI 实时监控面板
- 支持导出到企业日志系统

**5. 多渠道集成**
- CLI 交互式终端
- React Web 工作流工作台
- 飞书（Feishu）企业消息集成
- RESTful API 和 Webhook
- MCP（Model Context Protocol）标准支持

---

## 🏢 典型应用场景

### 场景 1：智能文档审核流程
```
用户上传合同 → AI 提取关键条款 → 法务审批 → AI 生成审核报告 → 归档
```
- 节点 1：PDF 解析和信息提取
- 节点 2：风险条款识别（需人工审批）
- 节点 3：生成标准化报告

### 场景 2：数据分析自动化
```
定时触发 → 数据清洗 → 统计分析 → 生成可视化报告 → 发送到飞书群
```
- 支持 Cron 定时调度
- 并行处理多个数据源
- 失败自动重试

### 场景 3：研究助手工作流
```
文献检索 → 全文下载 → Wiki 摄入 → 交叉引用构建 → 生成研究报告
```
- 子 Agent 并行处理多篇论文
- Wiki 模式：每篇论文生成摘要页，自动关联实体和概念页，知识持续积累
- 支持增量摄入，新论文自动整合进现有知识结构

---

## 🚀 快速开始

### 安装和运行

```bash
# 安装依赖
pnpm install

# 启动交互式终端
pnpm dev

# 启动网关模式（后台运行 + 实时日志）
pnpm dev -- gateway

# 启动 Web UI 工作台
pnpm dev:ui
```

首次运行会自动创建配置文件：`~/.openintern/config.json`

### Web UI 访问

启动后访问 `http://127.0.0.1:5173`，包含以下模块：

- `/workflow` - 工作流编排器（草稿 → 发布 → 运行）
- `/runs` - 运行实例管理
- `/hitl` - 人工审批队列
- `/trace` - 可观测性追踪面板
- `/registry` - 角色/工具/技能目录

---

## 📋 核心功能

### 1. Agent 循环引擎

事件驱动的 Agent 主循环：
```
接收消息 → 构建上下文 → LLM 推理 → 工具调用 → 执行工具 → 迭代 → 返回结果
```

**特性**：
- 工具迭代守卫（防止无限循环）
- 会话隔离的长期记忆
- 技能动态加载
- 子 Agent 管理

### 2. 工作流引擎

基于 JSON Schema 的 DAG 工作流定义：

```json
{
  "id": "contract_review",
  "trigger": { "type": "manual" },
  "execution": { "mode": "serial" },
  "nodes": [
    {
      "id": "extract",
      "role": "analyst",
      "taskPrompt": "提取合同 {{trigger.file_path}} 的关键条款",
      "outputKeys": ["clauses"],
      "hitl": {
        "enabled": true,
        "highRiskTools": ["exec"],
        "approvalTarget": "owner"
      }
    },
    {
      "id": "report",
      "role": "writer",
      "taskPrompt": "基于 {{extract.clauses}} 生成审核报告",
      "dependsOn": ["extract"],
      "outputKeys": ["report_path"]
    }
  ]
}
```

**执行模式**：
- `serial`：串行执行（适合有依赖的流程）
- `parallel`：并行执行（可配置最大并发数）

### 3. 内置工具集

**文件系统**：
- `read_file` - 读取文本文件
- `write_file` - 写入文件
- `edit_file` - 编辑文件
- `list_dir` - 列出目录
- `inspect_file` - 检测文件类型

**媒体处理**：
- `read_image` - 图像分析（支持 PNG/JPG/WebP/GIF）

**执行和通信**：
- `exec` - 执行 Shell 命令（高风险，建议启用审批）
- `message` - 发送消息到其他渠道

**网络**：
- `web_search` - 网络搜索
- `web_fetch` - 获取网页内容

**工作流**：
- `trigger_workflow` - 触发工作流
- `query_workflow_status` - 查询工作流状态
- `draft_workflow` - 创建工作流草稿

**记忆系统**（MemU 模式）：
- `memory_retrieve` - 检索记忆
- `memory_save` - 保存记忆
- `memory_delete` - 删除记忆

**知识管理**（Wiki 模式）：
- 通过 `read_file` / `write_file` / `edit_file` 直接操作 wiki 页面
- 配合 `wiki-ingest` / `wiki-query` / `wiki-lint` 技能使用

**自动化**：
- `cron` - 定时任务调度
- `spawn` - 生成子 Agent

### 4. 记忆系统

OpenIntern 提供两种互斥的知识管理模式，通过 `memory.mode` 配置切换：

#### Wiki 模式（默认）

受 Karpathy 提出的 "LLM Wiki" 理念启发。传统 RAG 每次查询都从零检索和拼接，没有积累；Wiki 模式让 LLM 主动构建和维护一个持久化的结构化知识库，知识被编译一次，然后持续维护。

**三层架构**：

```
workspace/
├── raw/                  # Layer 1: 原始资料（不可变，LLM 只读）
│   ├── paper-a.pdf
│   └── article-b.md
├── wiki/                 # Layer 2: 知识层（LLM 全权维护）
│   ├── index.md          # 主索引：所有页面的链接和一句话摘要
│   ├── log.md            # 操作日志：摄入、查询、检查的时间线
│   ├── sources/          # 每个原始资料的摘要页
│   ├── entities/         # 实体页（人物、组织、产品、数据集）
│   ├── concepts/         # 概念页（方法、理论、主题）
│   └── analyses/         # 综合分析页（有价值的查询结果存回）
└── WIKI_SCHEMA.md        # Layer 3: 规则层（定义 wiki 结构和操作约定）
```

**四种操作模式**（对应三个技能）：

| 操作 | 技能 | 说明 |
|------|------|------|
| **Ingest** | `wiki-ingest` | 将 `raw/` 中的新资料读取、提炼、整合进 wiki 页面。支持人在回路讨论要点 |
| **Query** | `wiki-query` | 从 `wiki/index.md` 定位相关页面，综合回答。有价值的分析自动存回 `wiki/analyses/` |
| **Lint** | `wiki-lint` | Wiki 健康检查：断链、矛盾、孤儿页、缺失交叉引用、过时内容 |
| **Index & Log** | 自动 | `index.md` 和 `log.md` 在每次操作后自动更新 |

**Wiki 页面约定**：
- 每个页面以 YAML frontmatter 开头（title, type, created, updated, sources）
- 使用 `[[page-name]]` 语法进行交叉引用
- 矛盾信息保留双方立场并标注来源
- 单个页面超过 ~800 词时拆分

**核心优势**：
- 知识持续积累，不每次重新推导
- 结构化索引文件替代向量检索（中小规模下更高效）
- 可追溯——每个 wiki 页面的信息都能回溯到 `raw/` 中的原始资料
- 探索过程本身也被保留（analyses 页面）

#### MemU 模式

通过外部 MemU 服务进行向量化记忆管理，适合需要大规模检索或已有 MemU 基础设施的场景。

**记忆作用域**：
- `chat`：用户个人偏好和对话上下文
- `papers`：文档和知识库

**记忆工具**：
- `memory_retrieve` — 按语义检索相关记忆
- `memory_save` — 保存新记忆
- `memory_delete` — 清除指定作用域的记忆

**记忆隔离**：
- 租户隔离（`tenant_id`）
- 作用域所有者类型：`principal`（用户）/ `conversation`（会话）/ `knowledgeBase`（知识库）

#### 会话记忆（两种模式共用）

无论选择哪种模式，每个会话都有本地的短期记忆：

- **会话记忆**：`memory/sessions/<session_key>/MEMORY.md`
- **会话历史**：`memory/sessions/<session_key>/HISTORY.md`
- 通过 `memoryWindow` 配置自动整合窗口（默认 100 条消息）

### 5. 多模型支持

**支持的 LLM 提供商**：
- OpenAI 兼容 API（GPT-4o, GPT-4o-mini 等）
- Anthropic 兼容 API（Claude 系列）
- 自动路由（`provider: "auto"`）

**配置示例**：
```json
{
  "agents": {
    "defaults": {
      "provider": "auto",
      "model": "gpt-4o-mini",
      "maxTokens": 4096,
      "temperature": 0.7
    }
  },
  "providers": {
    "openaiCompatible": {
      "apiKey": "YOUR_KEY",
      "apiBase": "https://api.openai.com/v1"
    },
    "anthropicCompatible": {
      "apiKey": "YOUR_KEY",
      "apiBase": "https://api.anthropic.com/v1"
    }
  }
}
```

---

## 🔧 配置指南

### 基础配置

配置文件位置：`~/.openintern/config.json`

**最小配置**：
```json
{
  "agents": {
    "defaults": {
      "workspace": "~/.openintern/workspace",
      "model": "gpt-4o-mini",
      "provider": "auto"
    }
  },
  "providers": {
    "openaiCompatible": {
      "apiKey": "YOUR_OPENAI_KEY"
    }
  }
}
```

### 角色和权限配置

定义不同角色的工具访问权限：

```json
{
  "roles": {
    "analyst": {
      "systemPrompt": "你是一个数据分析专家...",
      "allowedTools": ["read_file", "web_search", "exec"],
      "memoryScope": "papers"
    },
    "writer": {
      "systemPrompt": "你是一个技术写作专家...",
      "allowedTools": ["read_file", "write_file", "edit_file"],
      "memoryScope": "chat"
    }
  }
}
```

### 飞书集成配置

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

**配置步骤**：
1. 在飞书开放平台创建企业自建应用
2. 启用事件订阅：`im.message.receive_v1`
3. 设置订阅模式为**长连接**（无需公网回调地址）
4. 将 `appId` 和 `appSecret` 填入配置

### 记忆模式配置

两种模式互斥，通过 `memory.mode` 切换：

**Wiki 模式（默认）**：

```json
{
  "memory": {
    "mode": "wiki"
  }
}
```

无需额外配置。启动后自动在 workspace 中创建 `raw/`、`wiki/`、`WIKI_SCHEMA.md`。

使用方式：
1. 将原始资料放入 `~/.openintern/workspace/raw/`
2. 对话中使用 `wiki-ingest` 技能摄入资料
3. 使用 `wiki-query` 技能查询知识
4. 定期使用 `wiki-lint` 技能维护质量

**MemU 模式**：

```json
{
  "memory": {
    "mode": "memu",
    "memu": {
      "enabled": true,
      "apiStyle": "cloudV3",
      "baseUrl": "https://api.memu.so",
      "apiKey": "YOUR_MEMU_KEY",
      "agentId": "openintern",
      "scopes": {
        "chat": "chat",
        "papers": "papers"
      },
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

> **兼容性说明**：旧配置中如果已有 `memu.enabled: true` 但没有 `mode` 字段，系统会自动推断为 `mode: "memu"`。

### 追踪和调试配置

```json
{
  "agents": {
    "trace": {
      "enabled": true,
      "level": "basic",
      "includeSubagents": true,
      "mirrorToProgress": true
    }
  }
}
```

**追踪级别**：
- `basic`：生命周期和工具调用事件
- `verbose`：额外包含意图转换文本

---

## 🔐 安全和审批

### 人工审批（HITL）配置

在工作流节点中启用审批：

```json
{
  "id": "risky_node",
  "hitl": {
    "enabled": true,
    "highRiskTools": ["exec", "write_file"],
    "approvalTarget": "owner",
    "approvalTimeoutMs": 7200000
  }
}
```

**审批流程**：
1. Agent 尝试调用高风险工具
2. 系统拦截并创建审批请求
3. 审批人在 Web UI 查看工具调用详情
4. 批准或拒绝
5. Agent 继续执行或终止

**审批目标**：
- `owner`：工作流发起人
- `manager`：发起人的上级（规划中）
- 自定义审批人（规划中）

### 工具权限控制

基于角色限制工具访问：

```json
{
  "roles": {
    "restricted_analyst": {
      "allowedTools": ["read_file", "web_search"]
    }
  }
}
```

未授权的工具调用会被自动拒绝。

---

## 📊 可观测性

### 事件追踪

OpenIntern 提供结构化的事件追踪系统：

```
run (运行)
  ├─ iteration (迭代)
  │   ├─ intent (意图)
  │   ├─ tool_call (工具调用)
  │   │   └─ approval (审批)
  │   └─ result (结果)
  └─ subagent (子 Agent)
```

**事件字段**：
- `runId`：运行 ID
- `spanId`：事件 ID
- `parentSpanId`：父事件 ID
- `sourceType`：来源类型（main_agent/subagent/workflow/system）
- `agentId`：Agent 标识
- `eventType`：事件类型
- `phase`：阶段（start/update/end）
- `status`：状态（running/ok/error/requested/granted）

### Web UI 追踪面板

访问 `/trace` 查看：
- 运行时间线
- 工具调用详情
- 审批状态
- 子 Agent 活动
- 错误和异常

### API 事件流

通过 SSE 订阅实时事件：

```bash
curl -N http://localhost:18790/api/runtime/events/stream
```

---

## 🛠️ 开发和扩展

### 项目结构

```
src/
  ├── agent/              # Agent 循环核心
  │   ├── loop.ts         # 主循环
  │   ├── context/        # 上下文构建
  │   ├── memory/         # 记忆系统
  │   ├── session/        # 会话管理
  │   ├── skills/         # 技能加载
  │   └── subagent/       # 子 Agent 管理
  ├── workflow/           # 工作流引擎
  │   ├── engine.ts       # DAG 执行引擎
  │   ├── schema.ts       # 工作流定义
  │   └── interpolation.ts # 上下文插值
  ├── tools/              # 工具系统
  │   ├── core/           # 工具注册表
  │   └── builtins/       # 内置工具
  ├── llm/                # LLM 提供者
  ├── bus/                # 消息总线
  ├── config/             # 配置管理
  ├── channels/           # 多渠道集成
  ├── cli/                # CLI 入口
  └── ui/                 # Web UI
skills/                   # 可扩展技能
  ├── wiki-ingest/        # Wiki 摄入技能
  ├── wiki-query/         # Wiki 查询技能
  ├── wiki-lint/          # Wiki 健康检查技能
  ├── selective-memory/   # MemU 选择性记忆技能
  └── pdf-ingest/         # PDF 摄入技能
workflows/                # 工作流定义
  ├── *.json              # 已发布工作流
  └── drafts/             # 草稿工作流
```

### 自定义技能

在 `skills/` 目录下创建技能包：

```
skills/
  └── my-skill/
      ├── skill.json      # 技能元数据
      ├── prompt.md       # 系统提示
      └── tools.json      # 工具定义（可选）
```

**skill.json 示例**：
```json
{
  "name": "my-skill",
  "description": "自定义技能描述",
  "version": "1.0.0"
}
```

### 自定义工具

扩展工具注册表：

```typescript
import { ToolRegistry } from './tools/core/tool-registry';

const registry = new ToolRegistry();

registry.register({
  name: 'custom_tool',
  description: '自定义工具',
  inputSchema: {
    type: 'object',
    properties: {
      input: { type: 'string' }
    },
    required: ['input']
  },
  handler: async (args) => {
    // 工具逻辑
    return { result: 'success' };
  }
});
```

### API 集成

启动 API 服务器：

```bash
pnpm dev -- gateway
```

**主要端点**：

```
POST /api/runtime/workflows/start
  启动工作流

GET /api/runtime/workflows/:runId
  查询运行状态

POST /api/runtime/hitl/approvals/:approvalId/approve
  批准审批请求

GET /api/runtime/events/stream
  订阅事件流（SSE）
```

---

## 🧪 测试

```bash
# 类型检查
pnpm typecheck

# 运行测试
pnpm test

# 构建 Web UI
pnpm build:ui
```

---

## 🗺️ 企业级路线图

OpenIntern 正在向完整的企业 AI 转型平台演进。

### 已实现 ✅

- [x] 事件驱动 Agent 循环
- [x] DAG 工作流引擎
- [x] 人工审批机制（HITL）
- [x] 多模型支持（OpenAI/Anthropic）
- [x] 飞书企业消息集成
- [x] Web UI 工作流工作台
- [x] 结构化事件追踪
- [x] 会话级记忆隔离
- [x] MemU 企业记忆集成
- [x] Wiki 知识管理模式（Karpathy LLM Wiki）
- [x] 基于角色的工具权限控制

### 开发中 🚧

- [ ] **多级审批流程**
  - 审批链路配置
  - 审批历史追溯
  - 审批模板和规则引擎

- [ ] **增强的可观测性**
  - 工作流执行时间分析
  - 工具调用成本统计
  - 异常检测和告警

### 规划中 📋

#### 1. 数据库和持久化（Q2 2026）

**目标架构**：
- **主数据库**：PostgreSQL
- **向量搜索**：pgvector
- **对象存储**：MinIO/S3
- **异步队列**：工作队列（chunking/embedding/summarization）

**数据模型**：
```
租户（tenant）
  ├── 用户（user）
  ├── 会话（session）
  ├── 工作流（workflow）
  ├── 运行实例（run）
  └── 知识库（knowledge_base）
      ├── 文档（document）
      └── 向量（embedding）
```

#### 2. 企业知识库（Q2-Q3 2026）

**Wiki 模式增强**：
- 文档摄取管道扩展（PDF/Word/HTML 自动提取文本后摄入 wiki）
- Wiki 页面版本管理（git 追踪）
- 多用户协作 wiki（冲突合并策略）
- 大规模 wiki 的索引优化（当页面超过数百个时引入轻量检索）

**MemU 模式增强**：
- 混合检索（向量 + 关键词 + 元数据过滤）
- ACL 权限控制
- 增量更新和版本管理

**记忆层次**：
```
会话记忆（短期）
  ↓ 定期总结
Wiki 知识库 / MemU 长期记忆
  ↓ 共享和沉淀
组织知识库（企业共享知识 + ACL）
```

#### 3. 多用户和安全基线（Q3 2026）

**安全特性**：
- 所有业务数据携带 `tenant_id`
- 检索前应用 ACL 过滤
- 用户记忆和共享知识分离存储
- 记忆写入版本化和可审计
- 敏感数据脱敏和加密

**身份和权限**：
- SSO 集成（SAML/OAuth）
- 细粒度 RBAC
- 审计日志

#### 4. 评估和质量保障（Q3-Q4 2026）

**评估维度**：
- 检索质量（Recall@K, MRR）
- 生成质量（幻觉检测、事实一致性）
- 工作流成功率
- 用户满意度

**可观测性仪表板**：
- 实时监控
- 性能分析
- 成本优化建议

#### 5. 企业集成（Q4 2026）

**渠道扩展**：
- 钉钉
- 企业微信
- Slack
- Microsoft Teams

**企业认证**：
- LDAP/AD 集成
- 多因素认证（MFA）

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

**开发流程**：
1. Fork 本仓库
2. 创建特性分支（`git checkout -b feature/amazing-feature`）
3. 提交更改（`git commit -m 'Add amazing feature'`）
4. 推送到分支（`git push origin feature/amazing-feature`）
5. 创建 Pull Request

---

## 📄 许可证

[MIT License](./LICENSE)

---

## 📞 联系我们

- **GitHub Issues**：[提交问题](https://github.com/your-org/openintern/issues)
- **企业咨询**：enterprise@example.com

---

## 🙏 致谢

本项目受 `reference/nanobot` 启发，感谢开源社区的贡献。

---

**OpenIntern - 让 AI 成为企业的生产力引擎**
