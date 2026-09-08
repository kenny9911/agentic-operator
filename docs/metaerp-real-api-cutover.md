# 接真实 Meta ERP

> 现状：代码已就位，**默认全关**——不配任何东西，系统行为与接入前完全一致（所有 ERP 操作走本地 mock）。
> 打开是两步，且读、写分开。

## 一句话架构

`metaerp.invoke` 仍是 agent 触达 ERP 的唯一出口（manifest 只能选操作名，不能选 URL），
出口下面挂三种 transport，由 `config/metaerp-routes.json` **按操作**决定走哪个：

| transport | 打到哪 | 认证 |
|---|---|---|
| `mock` | 本地 mock ERP（默认） | 无 |
| `openapi` | APIGW | IAM 账号密钥 → 应用令牌 + `x-renter-id` |
| `uiapi` | 门户网关 `/gateway/...` | 门户账号登录 → CSB 联邦 → Cookie + `x-csrf-token` + `Referer` |

**按操作而不是按租户**，因为两个场景都同时需要两种真实 transport：`poHeader`、
`queryReservation`、`queryItemMinMaxLevel` 是 UI 形态，其余是 openapi 形态。
路由表里没列的操作永远走 mock——那正是 ERP 没有对应接口、由平台自己模拟的部分。

## 两道闸口

```bash
METAERP_TRANSPORT_MODE=mock      # 默认。路由表不生效，全部走 mock
METAERP_ALLOW_REAL_WRITES=false  # 默认。写操作即使被路由到真实 ERP 也退回 mock
```

分成两道是因为读和写的风险不对称：读错了顶多是数据不对、运行失败；
**写下去就是真实的计划、采购包和调拨单，而 Inngest 会重放 step**。
所以读可以只凭路由表放行，写必须再明说一次。

被闸口拦下时不是静默降级——步骤的 meta 里会带上：

```json
{ "transport": "mock", "simulated": true,
  "declaredTransport": "openapi", "simulatedBecause": "METAERP_TRANSPORT_MODE is not 'real'" }
```

看运行记录的人需要知道"这一步是模拟的"，而不只是"这一步成功了"。

## 打开步骤

1. 连上 OpenVPN。
2. 填 `metaerp-openapi-call/config.local`（`ACCOUNT` / `SECRET` / `PROJECT` / `RENTER_ID`；
   要用 UI 形态接口再加 `PORTAL_USER` / `PORTAL_PASSWORD`）。
   worktree 里没有这个目录，`.env` 已用 `METAERP_CONFIG_FILE` 指向主检出的绝对路径。
3. **先跑探针**，只读、不产生任何单据：

```bash
pnpm erp:probe
```

   每个操作给一个结论，四种失败各有各的修法：

| 结论 | 含义 |
|---|---|
| ✅ 通 | 调通了 |
| ✅ 链路已通（业务参数不满足） | 路由/认证/授权都对，只是空入参不满足业务校验——这也算通 |
| ⚠️ 未授权 | 在 APIG 给这个 appId 授权即可 |
| ❌ 未注册 | 路径或环境前缀不对 |
| ❌ 网络不通 | 先确认 VPN |

4. 探针全绿后再 `METAERP_TRANSPORT_MODE=real`，此时**只有读**走真实 ERP。
5. 写操作单独评估后再开 `METAERP_ALLOW_REAL_WRITES=true`。

## 为什么响应必须归一化

真实 ERP 的业务失败是 **HTTP 200 + `{"status":"ERROR", ...}`**。
只看状态码就会把"什么都没查到"当成功，agent 拿着空数据继续跑——
CLAUDE.md 里记的 RoboHire `match-resume` 就是这么全员 `matchScore: null` 却"调用成功"的。

所以 `envelope.ts` 是失败关闭的边界：非 2xx、非 JSON、`status != SUCCESS` 一律抛错；
`SUCCESS` 才解包 `data`。三种网关特有的报错还会被翻译成对应的修法，
因为它们长得都像同一个不透明的 200，但补救措施完全不同。

## 平台模拟的部分（ERP 侧确无接口）

| 操作 | 说明 |
|---|---|
| `queryProcPackageHeader` / `queryProcPackageLine` | ERP 只有 `createProcPackageLines` 和 `queryProcPackageLineExecuteMode`（只返回寻源执行方式），没有采购包头/行查询 |
| `queryTransactionOrders` | ERP 只有 create/modify/cancel/execute Fulfill，没有库存单据/调拨单状态查询 |
| `queryPurchaseCategory` | ERP 无采购品类用途查询接口 |

除此之外，预警、待办、操作日志、合并建议、倒排工期、组包方案、审核意见等
都是数字员工的运行期派生数据，本来就不该向 ERP 要——场景一的文档自己也写成
「(Agent内部) 能力，无需外部 API」。

## 已知待办

- `queryPoLine`：注册路径与文档路径不同形，swagger 缺失，**入参需实测**。
- `createPbp`：真实接口的请求体是**数组**，不是对象；切写操作前要改 payload 形状。
- `queryOnhandQuantity`：真实接口是批量版 `multiOnhandQuantityQuery`，入参形状与 mock 不同。
- 真实环境不存在 `PBP-2027-0101` 这类种子单号，prompt 与端到端测试里的样例数据要一并换。
- HCS 用自签证书，故 v15/beta 两个预设默认不校验证书（与 skill 的 Python 脚本一致）。
  这是**按 preset 固定**的，不是全局开关，不会外溢到其它 origin；部署 CA 后置
  `METAERP_TLS_INSECURE=false`。
