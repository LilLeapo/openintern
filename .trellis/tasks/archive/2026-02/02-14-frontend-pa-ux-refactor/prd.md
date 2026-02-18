# 前端交互逻辑重构 - 实现PA为中心的用户体验

## 问题陈述

当前前端UI违背了OpenIntern的核心架构设计原则，导致用户体验混乱、认知负担过重。

### 核心架构原则（来自 PA Router Architecture）

> **PA 是入口，Group 是后端服务。用户永远只和自己的 PA 对话。**

PA（Personal Agent）应该是用户的唯一交互对象，PA内部通过Intent Router自动判断是自己处理还是escalate到Group。用户不应该感知到Group的存在，除非主动要求查看细节。

### 当前前端的问题

#### 1. 违背PA自动路由原则

**问题**：用户需要手动选择"个人助手"还是"团队"

```typescript
// ChatPage.tsx 第312-326行
<select value={assistantTarget} onChange={...}>
  <option value={SOLO_ASSISTANT_TARGET}>个人助手</option>
  {groups.map(group => (
    <option key={group.id} value={group.id}>{group.name}</option>
  ))}
</select>
```

**影响**：
- 用户需要理解"个人助手"和"团队"的区别
- 用户需要自己判断什么时候用哪个
- PA的智能路由能力完全没有体现

**应该是**：用户只看到"我的PA"，PA自动判断是否需要调用专家团队。

#### 2. 暴露技术细节

**问题**：用户需要手动选择Provider和Model

```typescript
// ChatPage.tsx 第354-388行
<select value={provider} onChange={...}>
  <option value="anthropic">anthropic</option>
  <option value="gemini">gemini</option>
  <option value="openai">openai</option>
</select>
```

**影响**：
- 普通用户不知道这些是什么
- 增加了不必要的决策负担
- 这是后端路由决策，不应该暴露

**应该是**：PA根据任务类型自动选择最合适的模型，或者放到高级设置中。

#### 3. 信息架构混乱

**问题**：7个页面全部平铺在导航中

- `/` Chat
- `/runs` 任务中心
- `/trace/:runId` 追踪详情
- `/blackboard/:groupId` 团队笔记
- `/orchestrator` 团队工作台
- `/skills` 技能目录
- `/group-run/:runId` 团队讨论

**影响**：
- 用户不知道该去哪个页面
- 暴露了runs、trace、blackboard等技术概念
- 管理功能和用户功能混在一起

**应该是**：
- 用户级：和PA对话、查看历史
- 管理级（Power User）：配置团队、查看技术细节

#### 4. 认知负担过重

**问题**：ChatPage侧边栏有7个配置区块

1. 会话管理
2. 助手选择（Solo/Group）
3. 模型路由（Provider/Model）
4. 任务模板
5. 最近回复
6. 会话任务
7. 使用建议

**影响**：
- 页面过于复杂（453行代码）
- 用户不知道该关注什么
- 核心的聊天体验被淹没

**应该是**：简洁的聊天界面，配置项放到设置中。

---

## 目标

### 核心目标

实现以PA为中心的用户体验，让用户感觉自己在和一个智能助理对话，而不是在操作一个复杂的技术系统。

### 具体目标

1. **简化主界面** - 用户只看到聊天窗口和PA
2. **隐藏技术细节** - 移除Solo/Group选择、Provider/Model选择
3. **重组信息架构** - 区分用户级和管理级功能
4. **保留核心能力** - Escalation感知、团队讨论查看等功能保留但不强制暴露

---

## 设计原则

### 1. PA First

- 用户的唯一入口是PA
- PA的个性要明显（名字、头像、欢迎语）
- 所有交互都通过PA进行

### 2. Progressive Disclosure

- 默认只显示核心功能
- 高级功能通过设置或链接访问
- 技术细节只在必要时显示

### 3. Natural Conversation

- 对话界面要简洁自然
- PA的回复要体现智能路由（"我召集了专家团队来帮你"）
- 用户可以选择查看团队讨论细节，但不是必须的

### 4. Clear Information Architecture

```
用户级（默认可见）
├── 和PA对话（主页）
├── 历史对话
└── 设置

管理级（Power User / 开发者）
├── 团队工作台
├── 技能目录
├── 任务中心
└── 技术追踪
```

---

## 重构范围

### Phase 1: 简化ChatPage（核心）

#### 1.1 移除手动选择

**移除**：
- `assistantTarget` state 和相关UI（第89-154行）
- `runMode` 派生逻辑（第156-159行）
- "助手选择"配置区块（第309-352行）

**修改**：
- `useChat` hook不再接收 `runMode` 和 `groupId` 参数
- `sendMessage` 统一调用 `apiClient.createRun`，由后端PA自动路由

#### 1.2 隐藏Provider/Model选择

**移除**：
- `provider` / `model` state 和相关UI（第87-112行）
- "模型路由"配置区块（第354-388行）
- `llmConfig` 参数传递

**可选**：
- 将Provider/Model选择移到设置页面（高级用户功能）
- 或者完全由后端决定

#### 1.3 简化侧边栏

**保留**：
- 会话管理（创建/切换/删除会话）
- 任务模板（快捷提示）

**移除或移动**：
- 最近回复（冗余，聊天窗口已显示）
- 会话任务（移到历史页面）
- 使用建议（移到帮助文档）

**新增**：
- PA个性化展示（名字、头像、简介）
- 简洁的状态指示（PA正在思考、PA召集了专家团队等）

#### 1.4 优化Escalation体验

**当前**：escalation banner显示"等待团队完成"，有"查看团队讨论"链接

**优化**：
- PA的回复中自然地说明："我召集了[团队名称]来帮你解决这个问题"
- 提供"查看团队讨论过程"的可选链接
- 团队完成后，PA汇总结果并回复

### Phase 2: 重组导航和信息架构

#### 2.1 简化AppShell导航

**当前导航**（5个入口）：
- Assistant（聊天）
- Tasks（任务中心）
- Team Notes（团队笔记）
- Team Studio（团队工作台）
- Skills（技能目录）

**新导航**（用户级）：
- Chat（和PA对话）
- History（历史对话）
- Settings（设置）

**管理导航**（可折叠或独立入口）：
- Admin
  - Team Studio（团队工作台）
  - Skills（技能目录）
  - Tasks（任务中心）
  - Team Notes（团队笔记）

#### 2.2 移除Session Key手动输入

**移除**：AppShell中的Session Key输入框（第121-156行）

**原因**：这是开发者调试功能，不应暴露给普通用户

**替代**：在设置页面或开发者模式中提供

### Phase 3: 优化状态管理

#### 3.1 简化AppPreferencesContext

**移除**：
- `selectedGroupId` / `setSelectedGroupId`（不再需要用户选择Group）

**保留**：
- `sessionKey` / `sessionHistory`（会话管理）
- `locale`（语言偏好）

**可选新增**：
- `showAdvancedFeatures`（是否显示高级功能）
- `paPersonality`（PA个性化配置）

#### 3.2 简化useChat hook

**当前签名**：
```typescript
useChat(sessionKey: string, options: {
  llmConfig?: RunLLMConfig;
  runMode?: 'single' | 'group';
  groupId?: string | null;
})
```

**新签名**：
```typescript
useChat(sessionKey: string)
```

**修改**：
- 移除 `llmConfig`、`runMode`、`groupId` 参数
- `sendMessage` 统一调用 `apiClient.createRun(sessionKey, input, attachmentRefs)`
- 后端PA自动判断是否需要escalate

### Phase 4: 新增PA个性化

#### 4.1 PA Profile组件

**新增组件**：`PAProfile.tsx`

**内容**：
- PA头像
- PA名字（可配置，默认"你的助理"）
- PA简介（"我可以帮你处理各种任务，必要时会召集专家团队"）
- PA状态（空闲、思考中、协调团队中）

**位置**：ChatPage侧边栏顶部

#### 4.2 PA回复优化

**当escalation发生时**，PA的回复应该自然地说明：

```
我注意到这个任务需要专业的[领域]知识，让我召集专家团队来帮你。

[等待中...]

团队已经完成分析，这是他们的结论：
[团队结果]

如果你想了解团队的讨论过程，可以点击这里查看。
```

**实现**：
- 在 `ChatMessage` 组件中检测escalation事件
- 渲染特殊的escalation消息样式
- 提供"查看团队讨论"链接

---

## 实施计划

### Step 1: 修改useChat hook

**文件**：`web/src/hooks/useChat.ts`

**修改**：
1. 移除 `runMode`、`groupId`、`llmConfig` 参数
2. 简化 `sendMessage`，统一调用 `createRun`
3. 保留escalation检测逻辑

**测试**：
- 发送消息能正常创建run
- Escalation事件能正常捕获

### Step 2: 简化ChatPage

**文件**：`web/src/pages/ChatPage.tsx`

**修改**：
1. 移除 `assistantTarget`、`provider`、`model` 相关state和UI
2. 移除 `groups` 加载逻辑
3. 简化侧边栏，只保留会话管理和任务模板
4. 新增PA Profile区块

**测试**：
- 页面能正常渲染
- 聊天功能正常
- 会话切换正常

### Step 3: 优化Escalation体验

**文件**：`web/src/components/Chat/ChatMessage.tsx`

**修改**：
1. 检测escalation相关的消息
2. 渲染特殊样式（"我召集了专家团队..."）
3. 提供"查看团队讨论"链接

**测试**：
- Escalation消息显示正确
- 链接跳转到GroupRunPage正常

### Step 4: 重组导航

**文件**：`web/src/components/Layout/AppShell.tsx`、`web/src/App.tsx`

**修改**：
1. 简化AppShell导航为3个用户级入口
2. 新增Admin子路由（/admin/*）
3. 移除Session Key输入框

**测试**：
- 导航正常工作
- 管理页面可访问

### Step 5: 简化状态管理

**文件**：`web/src/context/AppPreferencesContext.tsx`

**修改**：
1. 移除 `selectedGroupId` 相关逻辑
2. 清理相关localStorage key

**测试**：
- 状态管理正常
- localStorage正常

### Step 6: 新增PA Profile

**文件**：`web/src/components/PA/PAProfile.tsx`（新建）

**内容**：
- PA头像、名字、简介
- PA状态指示

**集成**：在ChatPage侧边栏顶部显示

---

## 验收标准

### 用户体验

- [ ] 用户打开应用，立即看到"和PA对话"的界面，没有复杂的配置
- [ ] 用户发送消息，PA自动处理，不需要选择"个人助手"还是"团队"
- [ ] 当PA调用团队时，用户能看到自然的说明（"我召集了专家团队..."）
- [ ] 用户可以选择查看团队讨论细节，但不是必须的
- [ ] 管理功能（团队工作台、技能目录等）不在主导航中，但仍然可访问

### 技术标准

- [ ] `useChat` hook不再接收 `runMode`、`groupId`、`llmConfig` 参数
- [ ] `sendMessage` 统一调用 `createRun`，由后端PA自动路由
- [ ] `AppPreferencesContext` 不再管理 `selectedGroupId`
- [ ] ChatPage代码行数减少至少30%（从453行降到300行以下）
- [ ] 侧边栏配置区块从7个减少到3-4个

### 功能完整性

- [ ] 聊天功能正常（发送消息、接收回复、文件附件）
- [ ] 会话管理正常（创建、切换、删除）
- [ ] Escalation功能正常（PA调用团队、查看团队讨论）
- [ ] 历史对话可访问
- [ ] 管理功能可访问（团队工作台、技能目录等）

### 代码质量

- [ ] TypeScript类型检查通过
- [ ] ESLint检查通过
- [ ] 组件遵循前端规范（component-guidelines.md）
- [ ] 代码遵循质量标准（quality-guidelines.md）

---

## 非目标（Not in Scope）

以下功能不在本次重构范围内：

- ❌ 后端PA Intent Router实现（已在Phase A-D完成）
- ❌ 新增PA能力或工具
- ❌ 修改Group内部协作逻辑
- ❌ 修改Blackboard或Memory系统
- ❌ 性能优化
- ❌ 移动端适配

---

## 风险和依赖

### 风险

1. **后端API兼容性**：如果后端PA Router还未完全实现，前端简化后可能无法正常工作
   - **缓解**：先确认后端escalate_to_group工具已实现

2. **用户习惯改变**：现有用户可能习惯了手动选择模式
   - **缓解**：提供迁移说明，保留高级设置入口

3. **功能回归**：简化过程中可能遗漏某些功能
   - **缓解**：详细的测试计划，确保所有功能可访问

### 依赖

1. **后端PA Router**：依赖后端已实现escalate_to_group工具（根据journal-1.md，Phase A已完成）
2. **前端规范**：遵循.trellis/spec/frontend/下的规范文档
3. **PA架构文档**：遵循docs/architecture/pa-router-architecture.md的设计原则

---

## 参考文档

- [PA Router Architecture](../../../docs/architecture/pa-router-architecture.md) - PA智能路由架构设计
- [Frontend Guidelines](../../../.trellis/spec/frontend/index.md) - 前端开发规范
- [Component Guidelines](../../../.trellis/spec/frontend/component-guidelines.md) - 组件开发规范
- [Quality Guidelines](../../../.trellis/spec/frontend/quality-guidelines.md) - 代码质量标准
- [Development Journal](../../../.trellis/workspace/openintern/journal-1.md) - PA Router实现历史（Session 1-5）
