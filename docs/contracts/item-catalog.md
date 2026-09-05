# item-catalog

Owner: item-catalog  
Version: v1  
Consumers: 已认证客服、管理前端

## Request/event

GET /api/v1/item-catalog/search?q={query}&cursor={opaque-cursor}&limit={n}

- q 为 1 至 64 个字符，按物品 name 或 code 做大小写不敏感的包含匹配；空白只作为搜索输入，不进入命令。
- limit 默认 20，最大 50；cursor 不透明且与排序版本绑定。
- 认证用户可以搜索，权限不影响目录内容。

GET /api/v1/item-catalog/by-class?class={class}&cursor={opaque-cursor}&limit={n}

- class 为固定目录分类字符串；该接口按 code 升序返回该分类的全部物品。
- limit 默认 20，最大 50；cursor 保持与搜索接口相同的不透明分页语义。
- 认证用户可以读取，权限不影响目录内容。

## Response/handling

~~~json
{
  "items": [
    {"code": "02000000", "name": "金币", "itemClass": "-"}
  ],
  "nextCursor": null,
  "totalCount": 1
}
~~~

`totalCount` 为当前搜索或分类结果的总条数，用于计算分页总页数；不会改变每次响应的 `limit` 上限。

搜索结果按匹配相关性排序，相关性相同按 code 升序；分类结果按 code 升序；两种排序都必须稳定。返回的 code 是字符串，不能丢失前导零。该接口不返回命令模板。

## Errors

unauthorized（401）、invalid-query（400）、invalid-cursor（400）、catalog-unavailable（503）。

## Limits and side effects

只读、有界查询；后端应对 q 做索引/前缀或受控包含搜索，避免全表无界扫描。前端应 debounce 和取消过期请求，但这些是交互优化，不改变契约。

## Compatibility

新增展示字段兼容；code/name 的语义和字符串类型不可改变。目录导入更新不回写已经提交的 operation 快照。

## Image extension

Search results may include an optional `image` field containing a static URL such as `/item-images/02000000.png`. The item-catalog module resolves it from the independent item-code/image mapping, so replacing the CSV does not discard existing image associations. Rows without a matching asset omit the field. Existing `code`, `name`, and `itemClass` fields remain unchanged.

## Examples

q=药水 可以返回名称含“药水”的记录；q=02000000 可以返回 code=02000000。无匹配返回空 items 和可判定的 nextCursor，不返回错误。
