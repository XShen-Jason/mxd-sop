# activities

Owner: activities  
Version: v1

活动配置由后端统一保存；拥有 `activities` 工作区的角色可以读取、进入活动页面并整体替换配置，拥有 `request` 工作区的角色也可以读取同一配置用于申请快捷填充。前端仍可使用本地缓存作为离线回退，但服务端数据是跨账号、跨浏览器的唯一来源。

## List

`GET /api/v1/activities`

Each activity may include `visible` (boolean). It defaults to `true` for legacy
records. Readers with the `activities` workspace receive all configured
activities; request-only readers receive only activities whose `visible` value
is not `false`.

Response:

```json
{"activities":[{"id":"event-1","name":"周年庆","description":"","visible":true,"rewards":[{"kind":"cash","quantity":100}],"updatedAt":"2026-09-06T00:00:00.000Z"}]}
```

拥有 `activities` 或 `request` 工作区的已认证角色可以读取。活动按最近更新时间返回。

## Replace

`PUT /api/v1/activities`

Request body is `{ "activities": Activity[] }`. Each activity may set
`visible` to control whether it appears in request quick fill. Each activity requires a stable
`id`, a non-empty `name`, and at least one positive integer reward. Item rewards
require `itemCode`; equipment levels, when present, are integers from 1 to 10.
The operation replaces the complete set atomically and requires the
`activities` workspace.

## Errors

`401 unauthorized`, `403 forbidden`, and `400 invalid-input` use the shared
error envelope.
