# Feishu Connector API

本文档描述 OpenIntern 中 Feishu 同步相关接口，包含 connector 管理与手动触发同步。

## Base URL

`http://localhost:3000/api`

## 鉴权与作用域

所有 Feishu Connector API 都依赖请求作用域：

- `x-org-id`（必填）
- `x-user-id`（必填）
- `x-project-id`（必填）

说明：

- Connector 作用域绑定 `org_id + project_id`
- 同步后的知识写入 `memories/memory_chunks`，类型为 `archival`，并带 `metadata.source_type=feishu_*`

## Connector Config

创建/更新 connector 时，`config` 字段结构如下：

```json
{
  "folder_tokens": ["fld_xxx"],
  "wiki_node_tokens": ["RJMNwnAHIiVsYzkzhsYcilM0nxd"],
  "file_tokens": ["doccn_xxx"],
  "bitable_app_tokens": ["bascn_xxx"],
  "poll_interval_seconds": 300,
  "max_docs_per_sync": 200,
  "max_records_per_table": 500,
  "chunking": {
    "target_tokens": 600,
    "max_tokens": 1100,
    "min_tokens": 120,
    "media_context_blocks": 2
  }
}
```

说明：

- `wiki_node_tokens` 当前会按 docx token 直读同步
- `folder_tokens` 依赖 Drive API 权限，权限不足时不会阻断其他 token 的同步

## 1) 创建 Connector

- 方法：`POST /feishu/connectors`

请求：

```json
{
  "name": "team-feishu-main",
  "status": "active",
  "config": {
    "folder_tokens": [],
    "wiki_node_tokens": ["RJMNwnAHIiVsYzkzhsYcilM0nxd"],
    "file_tokens": [],
    "bitable_app_tokens": [],
    "poll_interval_seconds": 300,
    "max_docs_per_sync": 200,
    "max_records_per_table": 500,
    "chunking": {
      "target_tokens": 600,
      "max_tokens": 1100,
      "min_tokens": 120,
      "media_context_blocks": 2
    }
  }
}
```

响应（201）：

```json
{
  "id": "fconn_xxx",
  "org_id": "org_default",
  "project_id": "project_default",
  "name": "team-feishu-main",
  "status": "active",
  "config": {},
  "created_by": "user_default",
  "last_sync_at": null,
  "last_success_at": null,
  "last_error": null,
  "last_polled_at": null,
  "created_at": "2026-02-12T06:39:01.000Z",
  "updated_at": "2026-02-12T06:39:01.000Z"
}
```

## 2) 查询 Connector 列表

- 方法：`GET /feishu/connectors`

响应（200）：

```json
{
  "connectors": [
    {
      "id": "fconn_xxx",
      "name": "team-feishu-main",
      "status": "active"
    }
  ]
}
```

## 3) 查询单个 Connector

- 方法：`GET /feishu/connectors/:connector_id`

响应（200）：

```json
{
  "id": "fconn_xxx",
  "org_id": "org_default",
  "project_id": "project_default",
  "name": "team-feishu-main",
  "status": "active",
  "config": {}
}
```

## 4) 更新 Connector

- 方法：`PATCH /feishu/connectors/:connector_id`

请求（字段均可选）：

```json
{
  "status": "paused"
}
```

响应（200）：

```json
{
  "id": "fconn_xxx",
  "status": "paused",
  "updated_at": "2026-02-12T06:40:00.000Z"
}
```

## 5) 手动触发同步

- 方法：`POST /feishu/connectors/:connector_id/sync`

请求：

```json
{
  "wait": true
}
```

说明：

- `wait=true`：同步执行完成后返回 job
- `wait=false`：快速返回已创建 job（后台继续执行）

响应（202）：

```json
{
  "id": "fsjob_xxx",
  "connector_id": "fconn_xxx",
  "trigger": "manual",
  "status": "completed",
  "started_at": "2026-02-12T06:39:01.000Z",
  "ended_at": "2026-02-12T06:39:02.000Z",
  "stats": {
    "discovered": 1,
    "processed": 1,
    "skipped": 0,
    "failed": 0,
    "docx_docs": 1,
    "bitable_tables": 0,
    "chunk_count": 1
  },
  "error_message": null,
  "created_at": "2026-02-12T06:39:01.000Z",
  "updated_at": "2026-02-12T06:39:02.000Z"
}
```

## 6) 查询同步任务

- 方法：`GET /feishu/connectors/:connector_id/jobs?limit=20`

响应（200）：

```json
{
  "jobs": [
    {
      "id": "fsjob_xxx",
      "status": "completed",
      "trigger": "manual"
    }
  ]
}
```

## 错误码

- `VALIDATION_ERROR`
  - 缺少 `x-org-id/x-user-id/x-project-id` 或请求体不合法
- `NOT_FOUND`
  - connector 不存在或不在当前 scope
- `FEISHU_SYNC_DISABLED`
  - 未配置可用 Feishu 凭据（`feishu.appId` / `feishu.appSecret`）
- `INTERNAL_ERROR`
  - 服务端未分类错误

## 运行要求

在 `agent.config.json` 增加：

```json
{
  "feishu": {
    "enabled": true,
    "appId": "cli_xxx",
    "appSecret": "xxxx",
    "baseUrl": "https://open.feishu.cn",
    "timeoutMs": 20000,
    "maxRetries": 3,
    "pollIntervalMs": 120000
  }
}
```

## 快速验证示例

```bash
curl -X POST http://localhost:3000/api/feishu/connectors \
  -H 'content-type: application/json' \
  -H 'x-org-id: org_default' \
  -H 'x-user-id: user_default' \
  -H 'x-project-id: project_default' \
  -d '{
    "name":"demo-feishu",
    "config":{
      "folder_tokens":[],
      "wiki_node_tokens":["RJMNwnAHIiVsYzkzhsYcilM0nxd"],
      "file_tokens":[],
      "bitable_app_tokens":[],
      "poll_interval_seconds":300,
      "max_docs_per_sync":50,
      "max_records_per_table":200,
      "chunking":{"target_tokens":600,"max_tokens":1100,"min_tokens":120,"media_context_blocks":2}
    }
  }'
```
