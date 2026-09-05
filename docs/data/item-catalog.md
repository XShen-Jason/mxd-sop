# item-catalog data

## Source assets

目录文件：source/道具表-9-5.csv
图片映射：source/item-image-map.json
文件格式：UTF-8 CSV + UTF-8 JSON
初始化盘点：5,847 条有效数据行（另有 11 条空名称行会按导入规则跳过）
CSV SHA-256（归档时）：013D5ED7DBB0B414F004162345BB2A252CF50347156E7B34AAB8A55C82179C44
图片映射 SHA-256（归档时）：E0381CA34D943FCA39DBA59399C505214DD1ACDFACEC046D8C6A71544A4E3341

## Mapping

| CSV 字段 | 标准字段 | 说明 |
| --- | --- | --- |
| Id | sourceRowId | 仅用于追踪源行 |
| item_id | code | 指令中的物品代码，字符串，保留前导零 |
| class | class | 目录分类 |
| name | name | 客服搜索和历史展示名称 |

`item-image-map.json` 的 `images` 对象单独维护 `item_id -> PNG 文件名`。当前有
5,644 个物品代码映射到 `frontend/public/item-images` 下的 5,273 个 PNG；带后缀的
变体代码可以显式复用基础物品图片。图片文件名不进入 CSV，切换目录数据源时仍按
物品代码合并。

## Handling rules

Runtime catalog data comes from `source/道具表-9-5.csv`; image metadata comes
from `source/item-image-map.json`. The backend joins them by `item_id` and returns
the mapped static URL. Rows without a matching image remain valid and omit the
optional `image` field.

两个源文件均由 backend 的 item-catalog 导入适配器读取；frontend 不复制或直接解析目录数据，只提供映射所引用的静态 PNG。导入前验证字段、空值、重复 code、前导零和图片文件名，失败批次不得部分覆盖有效目录。标准化快照、导入日志和数据库数据属于派生物，应放在实现后的后端存储/构建产物中，不能覆盖 source 文件。
