# 创建跨组织转库单（createTransactionOrder）

> **状态**：v15 实跑建单成功，单号 `INOT20260908YF100008`，形态与 ERP 界面手工建单一致
> （申请人、申请时间正确，行状态 DRAFT / 界面显示「草稿」）。
>
> 本文每一个字段和取值都由实跑逐个验证，不是从 swagger 推断的——
> `OrderCreatePubLineDTO` 在 swagger 里标着 `x-unresolved`，没有字段定义。
>
> 最后更新：2026-09-08

## 一、接口

| 项 | 值 |
|---|---|
| 形态 | openapi（APIGW + IAM 应用令牌） |
| 路径 | `POST /v15/hinv/minv/openapi/v1/createTransactionOrder` |
| 认证 | `Authorization: <IAM access_token>` + `x-renter-id: <租户ID>` |
| 环境 | v15（`https://apigw.his.chinasoftinc.com`）；beta 把 `/v15/` 换成 `/beta/` |
| 平台侧封装 | `packages/tools/src/metaerp/` 的 `metaerp.invoke`，路由见 `config/metaerp-routes.json` |

**注意：ERP 界面走的不是这条接口。** 界面用 `invInotApprovalProcess` 审批流接口，
两者必填集**不同**，不能整体照搬（见第五节）。

## 二、请求 —— 头

```jsonc
{
  "unitCode": "1000",                              // 管理单元
  "organizationCode": "YF1",                       // 发出库存组织
  "organizationName": "扬帆能源库存组织",
  "transferOrganizationCode": "YF2",               // 接收库存组织，必须 ≠ 发出
  "txnOrderTypeCode": "INOT",                      // 单据类型：跨组织转库
  "transactionTypeCode": "ORGANIZATION_TRANSFER",  // 交易类型：直接跨组织转库
  "transactionActionCode": "ORGANIZATION_TRANSFER",// 与上同值
  "infoTransactionActionCode": "",
  "sourceSystemCode": "LYY2",                      // 来源系统
  "sourceCode": "INV",                             // 来源模块，不是业务单号
  "submittedBy": "10000422",                       // 申请人：用户 ID，不是姓名
  "requiredDate": "2026-09-08 14:41:42",           // 申请时间 = 当前时刻
  "uniqueSequenceNumber": "aa11560c-f9cf-46a2-b818-97bf33",  // 幂等键，≤30 字符
  "lineList": [ /* 见下 */ ]
}
```

**不要传** `autoSubmit`、`costMethodCode`、`inventoryStatusControl`（见第五节）。

## 三、请求 —— 行

```jsonc
{
  "lineNumber": "10",
  "operationType": "ADD",
  "unitCode": "1000",
  "organizationCode": "YF1",
  "organizationName": "扬帆能源库存组织",

  "itemCode": "10000008",                 // 物料编码
  "itemVersion": "",
  "lotNumber": "",

  "storehouseCode": "300000",             // 发出存储库
  "locatorCode": "LC001",                 // 发出货位；库启用货位时必填
  "transferStorehouseCode": "1000",       // 接收存储库
  "transferLocatorCode": "",              // 接收货位；接收库未启用货位时留空
  "transferOrganizationCode": "YF2",

  "propertyType": "ORG",  "propertyCode": "YF1",  "propertyTxnCode": "YF1",   // 物权
  "privateType": "NORM",  "privateCode": "YF1",   "privateTxnCode": "YF1",    // 使用权
  "transferPrivateType": "", "transferPrivateCode": "", "transferPrivateTxnCode": "",

  "primaryUomCode": "EA",
  "transactionUomCode": "EA",
  "transactionQuantity": "5",

  "transactionTypeCode": "ORGANIZATION_TRANSFER",
  "transactionActionCode": "ORGANIZATION_TRANSFER",
  "txnOrderTypeCode": "INOT",
  "submittedBy": "10000422",
  "sourceCode": "INV",
  "uniqueSequenceNumber": "<与头同值>",

  "requiredDate": "2026-09-08 14:41:12",  // 交易时间，必须早于当前时刻
  "sourceObjectNumber": "100020260902000001",      // 来源单据号（采购需求）
  "sourceObjectLineId": "2033239140312421456"      // 来源单据行 ID
}
```

## 四、三个最容易踩的坑

### 1. `requiredDate` 在头和行里语义相反

| 位置 | 含义 | 约束 |
|---|---|---|
| 头 | **申请时间** | 填当前时刻。填需求到货日期会让界面上的申请时间显示错误 |
| 行 | **交易时间** | **必须早于当前时刻**，填未来日期直接被拒 |

同名不同义，且都不能填「需求到货日期」。

### 2. 编码字段要的是编码，不是显示名

`在途交易出货`、`直接跨组织转库` 这类中文名一律被拒。已验证的编码：

| 字段 | 值 | 含义 |
|---|---|---|
| `txnOrderTypeCode` | `INOT` | 跨组织转库单 |
| `transactionTypeCode` | `ORGANIZATION_TRANSFER` | 直接跨组织转库 |

### 3. 发出货位必填，而界面上那一栏是空的

成品库（300000）启用了货位控制，缺 `locatorCode` 会被拒。界面会自动补，接口不会。

## 五、openapi 与界面接口的必填集不同

| 字段 | openapi | 界面（`invInotApprovalProcess`） |
|---|---|---|
| `sourceObjectNumber`（行） | **必填** | 不传 |
| `requiredDate`（行） | **必填** | 不传 |
| `autoSubmit` | **不能传**，传 `Y` 会让单据变成「关闭」 | 不传 |
| `costMethodCode` | **不能传**，会报「会计期间」错误 | `"2"` |
| `inventoryStatusControl` | **不能传**，同上 | `"N"` |
| `autoAllocate` / `autoFullfill` | 不传（响应里回 `X`） | `"X"` |

**所以不能拿界面抓包整体照搬**，得逐字段判断。

## 六、响应

```jsonc
{
  "txnOrderHeaderId": "1992778588894074129",
  "txnOrderHeaderNumber": "INOT20260908YF100008",   // 单号
  "submittedBy": "10000422",
  "requiredDate": "2026-09-08 14:41:42",
  "autoAllocate": "X",
  "autoFullfill": "X",
  "lineList": [
    { "txnOrderLineStatus": "DRAFT", "stage": "DRAFT", "errorMessage": "" }
  ]
}
```

**行是逐行成败的**：头可能建出来而行失败，此时 HTTP 仍是 200、外层
`status` 仍是 `SUCCESS`，失败信息只在 `lineList[].errorMessage` 里。
**必须逐行检查 `txnOrderLineStatus`**，否则会把「建了一张空单」当成功。

## 七、错误码速查（均为实跑遇到）

| 错误 | 含义与修法 |
|---|---|
| `ORDER-ServiceLogic-430009` transaction order type code invalid | `txnOrderTypeCode` 错，应为 `INOT` |
| `ORDER-ServiceLogic-430008` transaction type code invalid | `transactionTypeCode` 错，应为 `ORGANIZATION_TRANSFER` |
| `430082` source code is empty | 缺 `sourceCode`（填 `INV`） |
| `430326` sourceSystemCode can not be empty | 缺 `sourceSystemCode` |
| `430324` uniqueSequenceNumber can not be empty | 缺幂等键 |
| `430136` requirement date cannot be empty | 缺 `requiredDate` |
| `430333` sourceObjectNumber can not be empty | 行缺来源单据号（界面接口不需要，openapi 需要） |
| `The transfer storehouse code is invalid.` | 接收存储库无效，或与发出库相同 |
| `transfer organization code is same with organization code.` | 出/入库存组织相同——本单据要求跨组织 |
| `source and target asset storehouse flag not same.` | 资产存储库与非资产存储库之间不能互调 |
| `The locator is enabled, but the locator code is not transferred` | 发出库启用了货位，缺 `locatorCode` |
| `The transaction time must before now.` | 行的 `requiredDate` 晚于当前时刻 |
| `An error occurred when querying limit between item and storehouse limit` | 物料在目标库位上没有限额/关系配置 |
| `An error occurred when querying account period` | 传了 `costMethodCode` / `inventoryStatusControl`（openapi 不认） |

## 八、v15 参考数据（截至 2026-09-08）

**库存组织**：`YF1` 扬帆能源库存组织（发出）、`YF2` 扬帆能源库存组织（接收）

**YF1 的存储库**

| 编码 | 名称 | 资产存储库 | 货位控制 |
|---|---|---|---|
| `300000` | 成品库 | 是 | 预先设置货位（`LC001`） |
| `Stage` | 扬帆待发区 | 是 | 不启用 |
| `200000` | 费用库 | 否 | 不启用 |
| `100000` | 原材料 | 是 | 预先设置货位 |

**YF2 的存储库**：`1000` 原材料库（已验证可作调入方）

**演示物料**（管理单元 1000 / 库存组织 YF1 / 存储库 300000 / 货位 LC001）

| 物料 | 描述 | 现有量 | 可处理量 |
|---|---|---|---|
| `10000007` | 电容 | 100 | 70 |
| `10000008` | 电阻 | 100 | 100 |
| `10000009` | 电感 | 100 | 100 |

可处理量取自 `multiOnhandQuantityQuery` 的 `availableTransQty`。

## 九、平台侧接线

- 常量在 `.env`：`METAERP_SOURCE_SYSTEM_CODE`、`METAERP_TRANSFER_TXN_ORDER_TYPE_CODE`、
  `METAERP_TRANSFER_TRANSACTION_TYPE_CODE`、`METAERP_TRANSFER_ACTION_CODE`、
  `METAERP_TRANSFER_TO_ORGANIZATION_CODE`、`METAERP_TRANSFER_SUBMITTED_BY`、
  `METAERP_TRANSFER_SOURCE_CODE`；`METAERP_TRANSFER_AUTO_SUBMIT` **必须留空**。
- 路由 `config/metaerp-routes.json` → `createTransactionOrder`：
  `allow_real_write: true`（单点放行，其余写操作仍受全局闸口约束）、
  `idempotency_field: "uniqueSequenceNumber"`（运行时用 `runId` 填，Inngest 重放稳定）。
- 行的构造口径写在 `overlays/hc-procurement.json` 的
  `generateAdjustmentOptions.output_contracts.transfer_order_line`。

## 十、待确认

- **单据提交**：当前建出来是草稿。是否有独立的提交动作（`createTransactionOrderFulfill`？），
  还是靠界面审批流推进，尚未验证。
- **`OrderCreatePubLineDTO`** 在 swagger 里是 `x-unresolved`；本文的行字段来自实跑与界面
  抓包，字段全集参考同 yaml 里已解析的 `OrderLineDTO`（57 字段）。
- **探测残留**：过程中在 v15 留下约 15 张只有头、行为 FAILED 的调拨单，演示前建议清理。
