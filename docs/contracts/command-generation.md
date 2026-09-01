# command-generation.generate

Owner: command-generation  
Version: v1  
Consumers: backend manager projection（内部模块接口）

## Request/event

输入是已校验、已保存快照的角色 ID 和有序 operations；v1 默认要求 characterId 是匹配 ^[0-9]+$ 的数字字符串；该接口不得直接接受未经 operation-groups 授权的客服请求。

~~~json
{
  "characterId": "123456",
  "operations": [
    {"type": "item", "itemCode": "02000000", "quantity": 2888},
    {"type": "cash", "quantity": 500},
    {"type": "warp"},
    {"type": "ban"}
  ]
}
~~~

## Response/handling

~~~json
{
  "commands": [
    {"operationIndex": 0, "sequence": 0, "text": "drop@123456@02000000@1000"},
    {"operationIndex": 0, "sequence": 1, "text": "drop@123456@02000000@1000"},
    {"operationIndex": 0, "sequence": 2, "text": "drop@123456@02000000@888"},
    {"operationIndex": 1, "sequence": 0, "text": "cashid@123456@500"},
    {"operationIndex": 2, "sequence": 0, "text": "herwarp@123456"},
    {"operationIndex": 3, "sequence": 0, "text": "ban@123456"}
  ]
}
~~~

模板固定为：

| type | output |
| --- | --- |
| warp | herwarp@characterId |
| item | drop@characterId@itemCode@quantityChunk |
| cash | cashid@characterId@quantity |
| ban | ban@characterId |
| kick | herwarp@characterId |

所有 text 必须没有空格、制表符、换行或未转义的 @ 字段分隔歧义。commands 顺序严格为输入 operation 顺序，再按 item chunk 顺序。

## Errors

invalid-character-id（非纯数字）、invalid-operation、invalid-quantity、unknown-operation-type、unsafe-command-field。错误不依赖具体语言或框架异常文本。

## Limits and side effects

item quantity 的每个 chunk 最大 1000；quantity=2888 输出 1000、1000、888，quantity=1000 输出一条，quantity=1001 输出 1000、1。quantity 使用后端精确的正整数表示，不使用浮点数。输入 operations 初始最多 100 条；生成是确定性的同步纯计算，不写数据库、不执行外部命令。
单次生成最多 10,000 个 item chunk；超过该有界工作预算返回 invalid-quantity。

## Compatibility

保持 @ 分隔、无空格和拆分顺序。新增 operation type 可追加；改变既有模板或上限需新版本并迁移消费者。

## Examples

正常：itemCode=02000000、characterId=123456、quantity=2888 产生三条 drop。失败：quantity=0、characterId=12A456 或 characterId 含空白返回稳定错误，不产生部分结果。
