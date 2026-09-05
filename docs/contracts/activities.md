# activities

Owner: activities  
Version: v1

活动配置由后端统一保存，所有已认证角色都可以读取；管理和超级管理可以整体替换配置。前端仍可使用本地缓存作为离线回退，但服务端数据是跨账号、跨浏览器的唯一来源。

## List

`GET /api/v1/activities`

Response:

```json
{"activities":[{"id":"event-1","name":"周年庆","description":"","rewards":[{"kind":"cash","quantity":100}],"updatedAt":"2026-09-06T00:00:00.000Z"}]}
```

任何已认证角色都可以读取。活动按最近更新时间返回。

## Replace

`PUT /api/v1/activities`

Request body is `{ "activities": Activity[] }`. Each activity requires a stable
`id`, a non-empty `name`, and at least one positive integer reward. Item rewards
require `itemCode`; equipment levels, when present, are integers from 1 to 10.
The operation replaces the complete set atomically and is limited to manager
and super-admin roles.

## Errors

`401 unauthorized`, `403 forbidden`, and `400 invalid-input` use the shared
error envelope.
