# item-catalog

## Purpose

管理物品代码与显示名称的权威映射，为客服选择物品提供有界模糊搜索，并为提交时的 item operation 提供后端校验。

## Scope

In scope:

- 从原始 CSV 导入物品记录。
- 从独立图片映射按物品代码补充可选静态图片 URL。
- 保留物品代码、名称和分类，提供稳定搜索结果。
- 校验提交的物品代码存在，并返回用于历史快照的名称。

Out of scope:

- 生成 drop 指令（由 command-generation 持有）。
- 客服工单状态和权限。
- 前端本地复制或维护另一份物品表。

## Ownership and invariants

原始文件 data/item-catalog/source/道具表-9-5.csv，首行字段为：

| source column | domain meaning |
| --- | --- |
| Id | Excel 源行标识，不作为命令代码 |
| item_id | 物品命令代码，必须按字符串保存并保留前导零 |
| class | 物品分类 |
| name | 用户可见物品名称 |

初始化盘点得到 5,843 条数据行；导入时必须重新验证数量、空值和重复代码，不能把盘点数字当成业务规则。

- item code 非空且唯一；导入不能静默覆盖冲突记录。
- name 非空；class 可为空但不能改变 code/name 映射。
- 搜索按 code 或 name 做大小写不敏感的包含匹配；结果必须有稳定排序和上限。
- 提交后的历史记录保存 code/name 快照，目录更新不回写历史。
- Excel 中的数字样式不能导致前导零丢失；解析器必须以文本语义读取 item_id。
- 图片映射以 item code 为键、PNG 文件名为值；目录行没有映射时仍可用，只省略图片。

## Public surface

| Contract | 用途 |
| --- | --- |
| item-catalog.search | 登录用户按关键词查询物品 |
| item-catalog.by-class | 登录用户按固定分类读取物品 |

提交校验使用模块的内部公开 lookup 能力，具体传输形状由 operation-groups 的后端适配器定义，不让前端直接访问内部存储。

## Dependencies

- CSV/Excel import adapter：读取目录 source 文件。
- image map adapter：读取独立的 item code/PNG 映射。
- persistence adapter：保存标准化目录和导入版本。
- 无需依赖具体前端框架；搜索接口由 backend 暴露。

## Data, configuration, and assets

权威目录数据位于 `data/item-catalog/source/道具表-9-5.csv`，权威图片关联位于 `data/item-catalog/source/item-image-map.json`，静态 PNG 位于 `frontend/public/item-images`。未来生成的标准化数据库快照应放在构建产物或后端存储中，不回写覆盖源文件。导入批次应记录文件哈希、时间和失败行。

## Tests

下一阶段覆盖：前导零、重复 code、空 name、CSV 解析错误、code/name 包含搜索、大小写处理、稳定排序、limit 上限、无结果和目录更新不影响历史快照。

## Migration notes

The backend loads `data/item-catalog/source/道具表-9-5.csv` and joins the independent `data/item-catalog/source/item-image-map.json` by item code. The legacy workbook and JSON snapshot remain available only for explicit compatibility paths. Images are optional; missing mappings remain unset and are rendered as an empty slot.

保持 item_id 到 domain code 的映射和字符串语义。更换 Excel、CSV 或数据库时复用同一映射契约；任何代码重编号都必须作为显式数据迁移并评估历史指令。
