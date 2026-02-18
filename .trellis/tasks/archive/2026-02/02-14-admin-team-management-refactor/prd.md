# 团队管理界面重构 - 现代化管理控制台

## 问题陈述

当前的OrchestratorPage（团队工作台）存在严重的可用性和功能问题：

### 当前问题

1. **功能不足**
   - 只能创建，无法编辑或删除已有的Role/Group/Member
   - 没有详细查看功能（使用统计、运行历史）
   - 没有批量操作（批量删除、导入导出配置）
   - 没有权限管理（无法控制谁可以使用哪些Group）
   - 没有搜索和过滤功能

2. **UI/UX问题**
   - 4个表单堆在一起，视觉混乱
   - 没有清晰的视觉层次和引导
   - 表单样式简陋，缺少图标和视觉反馈
   - 成功/错误消息显示位置不明显
   - 不符合现代管理界面的设计标准

3. **工作流问题**
   - 创建和管理功能混在一起
   - 没有清晰的操作流程引导
   - 用户需要在多个表单之间切换
   - 无法快速查看和编辑已有配置

4. **代码质量问题**
   - 427行代码全部在一个组件中
   - 22个state变量，状态管理混乱
   - 没有组件拆分和复用
   - 难以维护和扩展

---

## 目标

### 核心目标

构建一个现代化的团队管理控制台，提供完整的CRUD功能、批量操作、详细监控和权限控制。

### 具体目标

1. **完整的管理功能**
   - Role/Group/Member的完整CRUD操作
   - 批量操作和导入导出
   - 详细查看和使用统计
   - 权限和访问控制

2. **优秀的用户体验**
   - 列表+详情模式（Master-Detail Pattern）
   - 现代简洁的UI风格
   - 清晰的视觉层次和操作引导
   - 快速响应和实时反馈

3. **良好的代码质量**
   - 组件化设计，职责清晰
   - 合理的状态管理
   - 可维护和可扩展
   - 遵循前端开发规范

---

## 设计原则

### 1. Master-Detail Pattern

采用经典的列表+详情模式：
- **左侧**：资源列表（可搜索、过滤、排序）
- **右侧**：选中项的详情和编辑表单
- **顶部**：全局操作（创建、批量操作、导入导出）

### 2. 现代简洁风格

- 卡片式布局，清晰的视觉层次
- 图标引导，降低认知负担
- 合理的留白和间距
- 一致的交互模式

### 3. 渐进式披露

- 默认显示核心信息
- 详细信息按需展开
- 高级功能放在次级入口

### 4. 即时反馈

- 操作后立即更新UI
- 加载状态清晰可见
- 错误提示明确具体
- 成功操作有视觉确认

---

## 功能需求

### 1. Role管理

#### 1.1 Role列表

**功能**：
- 显示所有Role的列表
- 每个Role显示：名称、描述、是否为Lead、创建时间
- 支持搜索（按名称）
- 支持过滤（Lead/非Lead）
- 支持排序（按名称、创建时间）

**UI**：
- 卡片式列表，每个Role一张卡片
- Lead Role有特殊标识（图标或徽章）
- 选中的Role高亮显示
- 空状态提示（没有Role时）

#### 1.2 Role详情

**功能**：
- 显示Role的完整信息：
  - 基本信息：名称、描述、System Prompt
  - 权限配置：Allowed Tools、Denied Tools
  - 使用统计：被多少个Group使用、总运行次数
  - 创建信息：创建时间、创建者
- 编辑按钮，进入编辑模式
- 删除按钮（需确认）

**UI**：
- 分区显示不同类型的信息
- System Prompt使用代码块样式
- 工具列表使用标签（Tag）样式
- 使用统计使用数字卡片

#### 1.3 创建/编辑Role

**功能**：
- 表单字段：
  - 名称（必填）
  - 描述（可选）
  - System Prompt（必填，多行文本）
  - 是否为Lead（复选框）
  - Allowed Tools（可选，标签输入）
  - Denied Tools（可选，标签输入）
- 表单验证
- 保存和取消按钮

**UI**：
- 模态对话框或侧边抽屉
- 表单字段清晰分组
- 实时验证反馈
- 保存按钮在底部固定

#### 1.4 删除Role

**功能**：
- 检查是否被Group使用
- 如果被使用，显示警告并列出相关Group
- 确认对话框
- 删除后更新列表

**UI**：
- 确认对话框，清晰说明影响
- 危险操作使用红色按钮

### 2. Group管理

#### 2.1 Group列表

**功能**：
- 显示所有Group的列表
- 每个Group显示：名称、描述、成员数量、创建时间
- 支持搜索（按名称）
- 支持过滤（按成员数量）
- 支持排序（按名称、创建时间、成员数量）

**UI**：
- 卡片式列表
- 成员数量用徽章显示
- 选中的Group高亮显示
- 空状态提示

#### 2.2 Group详情

**功能**：
- 显示Group的完整信息：
  - 基本信息：名称、描述
  - 成员列表：显示所有Member（Role名称、优先级）
  - 使用统计：总运行次数、成功率、平均耗时
  - 运行历史：最近的运行记录（Run ID、状态、时间）
  - 创建信息：创建时间、创建者
- 编辑按钮
- 删除按钮
- 管理成员按钮

**UI**：
- 分区显示不同类型的信息
- 成员列表使用表格或卡片
- 使用统计使用图表或数字卡片
- 运行历史使用时间线

#### 2.3 创建/编辑Group

**功能**：
- 表单字段：
  - 名称（必填）
  - 描述（可选）
- 表单验证
- 保存和取消按钮

**UI**：
- 模态对话框或侧边抽屉
- 简洁的表单

#### 2.4 管理Group成员

**功能**：
- 显示当前成员列表
- 添加成员：
  - 选择Role（下拉框）
  - 设置优先级（数字输入）
  - 添加按钮
- 删除成员：每个成员有删除按钮
- 重新排序：拖拽或调整优先级数字
- 保存和取消按钮

**UI**：
- 模态对话框或侧边抽屉
- 成员列表可排序
- 添加成员表单在顶部
- 实时更新预览

#### 2.5 删除Group

**功能**：
- 检查是否有运行中的Run
- 确认对话框
- 删除后更新列表

**UI**：
- 确认对话框
- 危险操作使用红色按钮

### 3. 批量操作

#### 3.1 批量删除

**功能**：
- 多选模式：列表项可多选
- 批量删除按钮
- 确认对话框（显示将删除的数量）
- 删除后更新列表

**UI**：
- 复选框选择
- 顶部显示已选数量
- 批量操作按钮在顶部

#### 3.2 导出配置

**功能**：
- 导出所有Role配置为JSON文件
- 导出所有Group配置为JSON文件
- 导出按钮在顶部工具栏

**UI**：
- 下拉菜单：导出Roles、导出Groups、导出全部
- 点击后自动下载文件

#### 3.3 导入配置

**功能**：
- 上传JSON配置文件
- 解析并验证配置
- 预览将要导入的内容
- 确认导入
- 导入后更新列表

**UI**：
- 文件上传按钮
- 预览对话框（显示将导入的Role/Group）
- 确认和取消按钮

### 4. 搜索和过滤

#### 4.1 搜索

**功能**：
- 实时搜索（按名称）
- 搜索结果高亮
- 清除搜索按钮

**UI**：
- 搜索框在列表顶部
- 搜索图标
- 清除按钮（X）

#### 4.2 过滤

**功能**：
- Role过滤：Lead/非Lead
- Group过滤：按成员数量
- 多个过滤条件可组合

**UI**：
- 过滤按钮或下拉菜单
- 当前过滤条件显示为标签
- 清除过滤按钮

### 5. 权限控制（Phase 2）

**功能**：
- 为每个Group设置访问规则
- 规则类型：
  - 允许所有用户
  - 仅特定用户
  - 仅特定组织
- 规则管理界面

**UI**：
- 在Group详情中显示权限设置
- 权限编辑对话框
- 规则列表

---

## 页面结构

### 布局

```
┌─────────────────────────────────────────────────────────────┐
│ Header: 团队管理控制台                                        │
│ [创建Role] [创建Group] [批量操作▼] [导入] [导出]              │
├──────────────────┬──────────────────────────────────────────┤
│ 左侧列表 (30%)    │ 右侧详情 (70%)                            │
│                  │                                          │
│ [搜索框]          │ ┌──────────────────────────────────────┐ │
│ [过滤器]          │ │ Role/Group 详情                       │ │
│                  │ │                                      │ │
│ ┌──────────────┐ │ │ [基本信息]                            │ │
│ │ Role 1       │ │ │ [权限配置]                            │ │
│ │ Lead         │ │ │ [使用统计]                            │ │
│ └──────────────┘ │ │ [运行历史]                            │ │
│ ┌──────────────┐ │ │                                      │ │
│ │ Role 2       │ │ │ [编辑] [删除]                         │ │
│ └──────────────┘ │ └──────────────────────────────────────┘ │
│ ┌──────────────┐ │                                          │
│ │ Group 1      │ │                                          │
│ │ 3 members    │ │                                          │
│ └──────────────┘ │                                          │
│                  │                                          │
└──────────────────┴──────────────────────────────────────────┘
```

### 组件结构

```
TeamManagementPage
├── TeamManagementHeader (顶部工具栏)
│   ├── CreateRoleButton
│   ├── CreateGroupButton
│   ├── BatchActionsMenu
│   ├── ImportButton
│   └── ExportButton
├── TeamManagementLayout (左右布局)
│   ├── ResourceList (左侧列表)
│   │   ├── SearchBar
│   │   ├── FilterBar
│   │   ├── ResourceTabs (Roles / Groups)
│   │   └── ResourceCards
│   │       ├── RoleCard
│   │       └── GroupCard
│   └── ResourceDetail (右侧详情)
│       ├── RoleDetail
│       │   ├── RoleBasicInfo
│       │   ├── RolePermissions
│       │   ├── RoleUsageStats
│       │   └── RoleActions
│       └── GroupDetail
│           ├── GroupBasicInfo
│           ├── GroupMembers
│           ├── GroupUsageStats
│           ├── GroupRunHistory
│           └── GroupActions
└── Modals/Drawers
    ├── CreateRoleModal
    ├── EditRoleModal
    ├── CreateGroupModal
    ├── EditGroupModal
    ├── ManageMembersModal
    ├── ImportConfigModal
    └── ConfirmDeleteModal
```

---

## 实施计划

### Phase 1: 核心重构（优先）

#### Step 1: 创建新的页面结构

**文件**：
- `web/src/pages/TeamManagementPage.tsx` (新建)
- `web/src/pages/TeamManagementPage.module.css` (新建)

**内容**：
- 基本的左右布局
- 顶部工具栏
- 路由配置更新

#### Step 2: 实现Resource列表

**文件**：
- `web/src/components/TeamManagement/ResourceList.tsx` (新建)
- `web/src/components/TeamManagement/RoleCard.tsx` (新建)
- `web/src/components/TeamManagement/GroupCard.tsx` (新建)
- `web/src/components/TeamManagement/SearchBar.tsx` (新建)
- `web/src/components/TeamManagement/FilterBar.tsx` (新建)

**功能**：
- 显示Role和Group列表
- 搜索和过滤
- 选中状态管理

#### Step 3: 实现Role详情和CRUD

**文件**：
- `web/src/components/TeamManagement/RoleDetail.tsx` (新建)
- `web/src/components/TeamManagement/CreateRoleModal.tsx` (新建)
- `web/src/components/TeamManagement/EditRoleModal.tsx` (新建)

**功能**：
- 显示Role详情
- 创建Role
- 编辑Role
- 删除Role

#### Step 4: 实现Group详情和CRUD

**文件**：
- `web/src/components/TeamManagement/GroupDetail.tsx` (新建)
- `web/src/components/TeamManagement/CreateGroupModal.tsx` (新建)
- `web/src/components/TeamManagement/EditGroupModal.tsx` (新建)
- `web/src/components/TeamManagement/ManageMembersModal.tsx` (新建)

**功能**：
- 显示Group详情
- 创建Group
- 编辑Group
- 管理成员
- 删除Group

#### Step 5: 实现批量操作

**文件**：
- `web/src/components/TeamManagement/BatchActionsMenu.tsx` (新建)
- `web/src/components/TeamManagement/ImportConfigModal.tsx` (新建)

**功能**：
- 批量删除
- 导入配置
- 导出配置

#### Step 6: 添加使用统计和监控

**文件**：
- `web/src/components/TeamManagement/UsageStats.tsx` (新建)
- `web/src/components/TeamManagement/RunHistory.tsx` (新建)

**功能**：
- 显示使用统计
- 显示运行历史
- 可能需要新的API端点

#### Step 7: 更新API客户端

**文件**：
- `web/src/api/client.ts`

**新增方法**：
- `updateRole(roleId, data)` - 更新Role
- `deleteRole(roleId)` - 删除Role
- `updateGroup(groupId, data)` - 更新Group
- `deleteGroup(groupId)` - 删除Group
- `removeGroupMember(groupId, memberId)` - 删除成员
- `getRoleUsageStats(roleId)` - 获取Role使用统计
- `getGroupUsageStats(groupId)` - 获取Group使用统计
- `getGroupRunHistory(groupId)` - 获取Group运行历史

**注意**：这些API可能需要后端支持，如果后端还没有，需要先实现后端API。

#### Step 8: 样式和UI优化

**文件**：
- 所有组件的CSS Module文件

**内容**：
- 现代简洁的样式
- 卡片式布局
- 图标和视觉引导
- 响应式设计

#### Step 9: 替换旧页面

**文件**：
- `web/src/App.tsx` - 更新路由
- 删除或重命名 `web/src/pages/OrchestratorPage.tsx`

**内容**：
- 将 `/orchestrator` 路由指向新的 `TeamManagementPage`
- 保留旧页面作为备份（重命名为 `OrchestratorPage.old.tsx`）

### Phase 2: 高级功能（后续）

#### 权限控制

**功能**：
- Group访问规则设置
- 用户/组织权限管理

#### 高级监控

**功能**：
- 性能指标图表
- 实时运行状态
- 告警和通知

#### 模板和快速创建

**功能**：
- Role模板库
- Group模板库
- 一键创建常用配置

---

## API需求

### 需要新增的后端API

如果后端还没有这些API，需要先实现：

1. **Role管理**
   - `PUT /api/roles/:role_id` - 更新Role
   - `DELETE /api/roles/:role_id` - 删除Role
   - `GET /api/roles/:role_id/stats` - 获取使用统计

2. **Group管理**
   - `PUT /api/groups/:group_id` - 更新Group
   - `DELETE /api/groups/:group_id` - 删除Group
   - `GET /api/groups/:group_id/stats` - 获取使用统计
   - `GET /api/groups/:group_id/runs` - 获取运行历史

3. **Member管理**
   - `DELETE /api/groups/:group_id/members/:member_id` - 删除成员
   - `PUT /api/groups/:group_id/members/:member_id` - 更新成员（优先级）

4. **批量操作**
   - `POST /api/roles/batch-delete` - 批量删除Role
   - `POST /api/groups/batch-delete` - 批量删除Group

---

## 验收标准

### 功能完整性

- [ ] Role的完整CRUD操作
- [ ] Group的完整CRUD操作
- [ ] Member的添加、删除、排序
- [ ] 搜索和过滤功能
- [ ] 批量删除功能
- [ ] 导入导出配置
- [ ] 使用统计显示
- [ ] 运行历史显示

### 用户体验

- [ ] 列表+详情模式清晰易用
- [ ] 操作流程直观，无需说明
- [ ] 视觉设计现代简洁
- [ ] 响应速度快，无明显延迟
- [ ] 错误提示清晰具体
- [ ] 成功操作有明确反馈

### 代码质量

- [ ] 组件职责清晰，单一职责
- [ ] 状态管理合理，无冗余
- [ ] TypeScript类型完整
- [ ] ESLint检查通过
- [ ] 遵循前端开发规范
- [ ] 代码可维护和可扩展

### 性能

- [ ] 列表渲染流畅（100+项）
- [ ] 搜索响应及时（<100ms）
- [ ] 页面加载快速（<1s）

---

## 非目标（Not in Scope）

以下功能不在本次重构范围内：

- ❌ 权限控制（Phase 2）
- ❌ 高级监控和图表（Phase 2）
- ❌ 模板库（Phase 2）
- ❌ 拖拽排序（可以用数字调整优先级）
- ❌ 实时协作（多人同时编辑）
- ❌ 版本历史和回滚
- ❌ 移动端优化

---

## 风险和依赖

### 风险

1. **后端API不完整**：部分功能需要新的后端API支持
   - **缓解**：先确认后端API现状，优先实现前端可以独立完成的功能

2. **数据迁移**：新旧页面切换可能影响用户
   - **缓解**：保留旧页面作为备份，提供切换入口

3. **功能回归**：重构过程中可能遗漏某些功能
   - **缓解**：详细的功能清单和测试计划

### 依赖

1. **后端API**：依赖后端提供完整的CRUD API
2. **前端规范**：遵循 `.trellis/spec/frontend/` 下的规范
3. **设计系统**：需要统一的图标库和样式变量

---

## 参考文档

- [Frontend Guidelines](../../../.trellis/spec/frontend/index.md) - 前端开发规范
- [Component Guidelines](../../../.trellis/spec/frontend/component-guidelines.md) - 组件开发规范
- [Quality Guidelines](../../../.trellis/spec/frontend/quality-guidelines.md) - 代码质量标准
- [Current OrchestratorPage](../../../web/src/pages/OrchestratorPage.tsx) - 当前实现（需要重构）
