# item-catalog data

## Source asset

原始文件：source/道具表.xlsx  
工作表：Sheet1  
初始化盘点：5,843 条数据行（导入时仍需重新校验）  
SHA-256（归档时）：C3263039D14AAA3786411D7F712E8E8A889D2D7D557CA4BEE3DA018DA749C4F1

## Mapping

| Excel 字段 | 标准字段 | 说明 |
| --- | --- | --- |
| Id | sourceRowId | 仅用于追踪源行 |
| item_id | code | 指令中的物品代码，字符串，保留前导零 |
| class | class | 目录分类 |
| name | name | 客服搜索和历史展示名称 |

## Handling rules

Runtime source: `source/items.json` contains the same 5,843 catalog rows plus optional image paths. PNG assets are copied to `frontend/public/item-images` and exposed through the `image` field returned by `item-catalog.search`; rows without an asset omit that field.

该文件是唯一原始资产，由 backend 的 item-catalog 导入适配器读取；frontend 不复制或直接解析它。导入前验证字段、空值、重复 code 和前导零，失败批次不得部分覆盖有效目录。标准化快照、导入日志和数据库数据属于派生物，应放在实现后的后端存储/构建产物中，不能覆盖 source 文件。
