# OpenIntern API（全量）

本文档覆盖当前后端服务暴露的全部 HTTP API。

Base URL（默认）：

- `http://localhost:3000`

---

## 1. 通用约定

### 1.1 JSON 与时间

- 请求与响应默认 `application/json`
- 时间字段统一 ISO 8601（UTC 字符串）

### 1.2 Scope Header（多租户）

部分接口要求作用域（scope）：

- `x-org-id`
- `x-user-id`
- `x-project-id`（仅部分接口必需）

### 1.3 统一错误格式

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "xxx",
    "details": {}
  }
}
```

---

## 2. 端点总览

### 2.1 Health

- `GET /health`

### 2.2 Runs

- `POST /api/runs`（需要 scope）
- `GET /api/runs/:run_id`（需要 scope）
- `GET /api/sessions/:session_key/runs?page&limit`（需要 scope）
- `GET /api/runs/:run_id/events?cursor&limit&type`（需要 scope）
- `GET /api/runs/:run_id/stream`（SSE，需要 scope）
- `POST /api/runs/:run_id/cancel`（需要 scope）

### 2.3 Roles

- `POST /api/roles`
- `GET /api/roles`
- `GET /api/roles/:role_id`

### 2.4 Groups

- `POST /api/groups`
- `GET /api/groups?project_id=...`
- `GET /api/groups/:group_id`
- `POST /api/groups/:group_id/members`
- `GET /api/groups/:group_id/members`
- `POST /api/groups/:group_id/runs`（需要 scope）

### 2.5 Blackboard

- `GET /api/groups/:groupId/blackboard`（需要 scope）
- `GET /api/groups/:groupId/blackboard/:memoryId`（需要 scope）
- `POST /api/groups/:groupId/blackboard`（需要 scope）

### 2.6 Skills

- `POST /api/skills`
- `GET /api/skills`
- `GET /api/skills/:skill_id`
- `DELETE /api/skills/:skill_id`

### 2.7 Feishu Connectors

- `POST /api/feishu/connectors`（需要 scope，且 `x-project-id` 必填）
- `GET /api/feishu/connectors`（需要 scope，且 `x-project-id` 必填）
- `GET /api/feishu/connectors/:connector_id`（需要 scope，且 `x-project-id` 必填）
- `PATCH /api/feishu/connectors/:connector_id`（需要 scope，且 `x-project-id` 必填）
- `POST /api/feishu/connectors/:connector_id/sync`（需要 scope，且 `x-project-id` 必填）
- `GET /api/feishu/connectors/:connector_id/jobs?limit=20`（需要 scope，且 `x-project-id` 必填）

Feishu 详细字段见：`docs/api/feishu-connectors.md`

---

## 3. Health

### GET `/health`

响应示例：

```json
{
  "status": "ok",
  "timestamp": "2026-02-12T06:39:01.000Z",
  "queue": {
    "length": 0,
    "processing": false
  },
  "sse": {
    "clients": 0
  }
}
```

---

## 4. Runs

### 4.1 创建 Run

`POST /api/runs`

请求体：

```json
{
  "session_key": "s_demo",
  "input": "请总结最近一次运行",
  "agent_id": "main",
  "llm_config": {
    "provider": "openai",
    "model": "gpt-4o"
  }
}
```

响应：

```json
{
  "run_id": "run_xxx",
  "status": "pending",
  "created_at": "2026-02-12T06:39:01.000Z"
}
```

### 4.2 查询 Run

`GET /api/runs/:run_id`

响应字段：

- `run_id`
- `session_key`
- `status`（`pending/running/completed/failed/cancelled`）
- `started_at`
- `ended_at`
- `duration_ms`
- `event_count`
- `tool_call_count`

### 4.3 查询 Session Runs

`GET /api/sessions/:session_key/runs?page=1&limit=20`

响应：

```json
{
  "runs": [],
  "total": 0,
  "page": 1,
  "limit": 20
}
```

### 4.4 查询 Run Events

`GET /api/runs/:run_id/events?cursor=0&limit=200&type=tool.called`

响应：

```json
{
  "events": [],
  "total": 0,
  "next_cursor": null
}
```

### 4.5 SSE 订阅

`GET /api/runs/:run_id/stream`

事件名：

- `run.event`
- `ping`
- `connected`

### 4.6 取消 Run

`POST /api/runs/:run_id/cancel`

响应：

```json
{
  "success": true,
  "run_id": "run_xxx"
}
```

---

## 5. Roles

### 5.1 创建 Role

`POST /api/roles`

请求体示例：

```json
{
  "name": "Researcher",
  "description": "资料调研",
  "system_prompt": "你是研究助手",
  "allowed_tools": [],
  "denied_tools": [],
  "style_constraints": {},
  "is_lead": false
}
```

### 5.2 查询 Roles

`GET /api/roles`

响应：

```json
{
  "roles": []
}
```

### 5.3 查询单个 Role

`GET /api/roles/:role_id`

---

## 6. Groups

### 6.1 创建 Group

`POST /api/groups`

请求体：

```json
{
  "name": "group1",
  "description": "default group",
  "project_id": null
}
```

### 6.2 查询 Groups

`GET /api/groups?project_id=project_default`

### 6.3 查询单个 Group

`GET /api/groups/:group_id`

### 6.4 添加成员

`POST /api/groups/:group_id/members`

请求体：

```json
{
  "role_id": "role_xxx",
  "ordinal": 0
}
```

### 6.5 查询成员

`GET /api/groups/:group_id/members`

### 6.6 发起 Group Run

`POST /api/groups/:group_id/runs`

请求体：

```json
{
  "input": "请给出方案",
  "session_key": "s_group_demo",
  "llm_config": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514"
  }
}
```

响应：

```json
{
  "run_id": "run_xxx",
  "group_id": "grp_xxx",
  "status": "pending",
  "created_at": "2026-02-12T06:39:01.000Z"
}
```

---

## 7. Blackboard

### 7.1 查询 Group Blackboard

`GET /api/groups/:groupId/blackboard`

响应：

```json
{
  "memories": []
}
```

### 7.2 查询单条 Blackboard Memory

`GET /api/groups/:groupId/blackboard/:memoryId`

### 7.3 写入 Blackboard

`POST /api/groups/:groupId/blackboard`

请求体：

```json
{
  "type": "episodic",
  "text": "这是一条黑板记录",
  "metadata": {
    "tag": "decision"
  },
  "importance": 0.8,
  "role_id": "role_xxx"
}
```

响应：

```json
{
  "id": "uuid"
}
```

---

## 8. Skills

### 8.1 创建 Skill

`POST /api/skills`

请求体示例：

```json
{
  "name": "FileSkill",
  "description": "file tools",
  "tools": [
    {
      "name": "read_file",
      "description": "read file",
      "parameters": {}
    }
  ],
  "risk_level": "low",
  "provider": "builtin",
  "allow_implicit_invocation": false
}
```

### 8.2 查询 Skills

`GET /api/skills`

### 8.3 查询单个 Skill

`GET /api/skills/:skill_id`

### 8.4 删除 Skill

`DELETE /api/skills/:skill_id`

响应：`204 No Content`

---

## 9. Feishu Connectors

该部分字段较多，完整文档见：

- `docs/api/feishu-connectors.md`

核心流程：

1. `POST /api/feishu/connectors` 创建 connector
2. `POST /api/feishu/connectors/:connector_id/sync` 触发同步
3. `GET /api/feishu/connectors/:connector_id/jobs` 查看 job 状态

---

## 10. 常见错误码

- `VALIDATION_ERROR`：参数校验失败
- `NOT_FOUND`：资源不存在
- `RUN_NOT_CANCELLABLE`：运行状态不允许取消
- `RUN_ALREADY_FINISHED`：运行已结束
- `FORBIDDEN`：黑板写入权限不足（非 lead 写 core/decision）
- `FEISHU_SYNC_DISABLED`：Feishu 同步未启用或缺少凭据
- `INTERNAL_ERROR`：未分类服务端异常

