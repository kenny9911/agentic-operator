#!/usr/bin/env node
/**
 * Stage 场景二「数字化员工的智能作业实践」(业务领域 HC-数字员工) into the layout
 * the platform's ontology compiler and the mock Meta ERP both consume.
 *
 *   node scripts/stage-hc-digital-worker-ontology.mjs \
 *     [--source ontology-packages/hc-digital-worker/source] \
 *     [--out ontology-packages/hc-digital-worker/package]
 *
 * The source directory is produced by
 * `scripts/extract-hc-digital-worker-source.mjs`, which carves 场景二 out of the
 * `procurement-hc-formal` bundle. 场景一 keeps its own source, staging script
 * and model directory, untouched — see that script's header for why the two
 * cannot share one staging pass.
 *
 * This is the sibling of `scripts/stage-hc-procurement-ontology.mjs` and follows
 * the same contract: every mapping is a declared table rather than an inference,
 * so the projection from ontology → runnable manifest stays reviewable, and the
 * output is byte-stable for a fixed input.
 *
 * NAMING: the compiler only grants a read-scoped `metaerp.invoke` for external
 * calls whose operation id starts with `query`. The ontology's `tool_use` names
 * several reads `get*` / `multi*Query`; ACTION_MAP restates each in the catalog's
 * `query*` vocabulary and records the ontology's own name in the description, so
 * the rename stays traceable rather than looking like a typo.
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NAMESPACE = "allmeta";
const DOMAIN = "hc-digital-worker";
const CATALOG_BASE = "/metaerp/openapi/v1";

// ── Actions ↔ ERP APIs (transformation map #2) ───────────────────────────────
// `kind` is the COMPILER kind:
//   prompt   → one LLM `logic` step; `queries` become a read-scoped metaerp.invoke
//   external → rule gates + manual steps + a write-scoped metaerp.invoke
//
// An action compiles to `external` exactly when the ontology gives it a manual
// step or a real write; everything else IS the digital employee's reasoning and
// compiles to a prompt agent. The ontology's `tool_use[]` is the authority for
// which operations an action may touch; nothing is added that it did not declare.
const ACTION_MAP = {
  // ① 圈范围 —— 拉全集团已审批需求计划头行
  scanApprovedDemandPlan: {
    kind: "prompt",
    queries: [
      { operation: "queryPbpHeader", description: "查询已审批的采购业务计划头，过滤草稿/已取消/已删除（本体 tool_use 名 queryPbpHeader）。" },
      { operation: "queryPbpLine", description: "查询计划行：物料、数量、需求到货日期、计划行类型（本体 tool_use 名 queryPbpLine）。" },
    ],
  },
  // ② 合并比对 —— 纯推理，无 ERP 取数
  analyzeDemandMerge: { kind: "prompt", queries: [] },
  // ③ 拆分 —— 计划员确认后才写回，故为带人工门的执行动作
  splitOversizedDemand: {
    kind: "external",
    operation: "splitDemandLine",
    target: "Procurement_Plan_Line",
  },
  // ④ 库存校验 —— 现有量 / 预留 / 高低水位三张表
  verifyInventoryAvailability: {
    kind: "prompt",
    queries: [
      { operation: "queryOnhandQuantity", description: "按物料+库存组织查合格现有量（本体 tool_use 名 multiOnhandQuantityQuery）。" },
      { operation: "queryReservation", description: "查已预留量，用于扣减出可用量。" },
      { operation: "queryItemMinMaxLevel", description: "查最大库存与安全库存两条水位线。" },
    ],
  },
  // ⑤ 可调度分支 —— 生成调拨申请单，采购路径到此结束
  createInventoryTransferOrder: {
    kind: "external",
    operation: "createTransactionOrder",
    target: "Stock_Transfer_Request",
  },
  // ⑥ 倒排工期 —— 按业务类型套阶段周期逐级倒推
  derivePurchaseSchedule: {
    kind: "prompt",
    queries: [
      { operation: "queryStageCycleConfig", description: "取业务类型对应的各阶段标准周期（本体 tool_use 名 getStageCycleConfig）。" },
    ],
  },
  // ⑦ 生成执行计划草稿 —— 写回 metaERP
  generateExecutionPlanDraft: {
    kind: "external",
    operation: "createPbp",
    target: "Procurement_Plan",
  },
  // ⑧ 年度计划合规校验 —— 集采目录、阈值、历史价
  auditAnnualPlanCompliance: {
    kind: "prompt",
    queries: [
      { operation: "queryCentralCatalogConfig", description: "取集采目录，判定是否必须走集中采购（本体 tool_use 名 getCentralCatalogConfig）。" },
      { operation: "queryAuditThresholdConfig", description: "取校验阈值：价格偏离、金额上限、必填项（本体 tool_use 名 getAuditThresholdConfig）。" },
      { operation: "queryPoLine", description: "取历史订单行，作为价格曲线的样本。" },
      { operation: "queryContract", description: "取合同价，作为价格偏离的对照基准（本体 tool_use 名 getContractByQuery）。" },
    ],
  },
  // ⑨ 退回整改 —— 派待办给计划员并留痕
  returnPlanForRectification: {
    kind: "external",
    operation: "pushTask",
    target: "Digital_Employee_Task",
  },
  // ⑩ 组包建议 —— 纯推理，只读阈值配置
  recommendPackagingScheme: {
    kind: "prompt",
    queries: [
      { operation: "queryAuditThresholdConfig", description: "取组包合规阈值：单包金额上限、品类混装限制（本体 tool_use 名 getAuditThresholdConfig）。" },
    ],
  },
  // ⑪ 框架/集采标注 —— 写回采购包行
  annotateFrameAndCentralPurchase: {
    kind: "external",
    operation: "createProcPackageLines",
    target: "Sourcing_Package_Line",
  },
  // ⑫ 组包合规预警 —— 派待办
  raisePackagingComplianceAlert: {
    kind: "external",
    operation: "pushTask",
    target: "Digital_Employee_Task",
  },
  // ⑬ 计划员确认计划与组包 —— 两道人工门后留痕
  confirmPlanAndPackage: {
    kind: "external",
    operation: "writeOperationLog",
    target: "Digital_Employee_Operation_Log",
  },
  // ⑭ 提交审批 —— 交回 metaERP 审批流
  submitPlanForApproval: {
    kind: "external",
    operation: "submitApproval",
    target: "Procurement_Plan",
  },
};

// ── Data Objects ↔ ERP entities (transformation map #1) ──────────────────────
// Entities shared with 场景一 keep that scenario's table names on purpose: the
// two domains read the same metaERP, and a second name for `ss_pbp_header_t`
// would be a second copy of the truth.
const OBJECT_MAP = {
  // shared with 场景一
  Procurement_Plan: { entity: "ss_pbp_header_t", query: "queryPbpHeader" },
  Procurement_Plan_Line: { entity: "ss_pbp_line_t", query: "queryPbpLine" },
  Purchase_Requisition: { entity: "pr_header_t", query: "queryPr" },
  Sourcing_Package: { entity: "ss_proc_package_header_t", query: "queryProcPackageHeader" },
  Purchase_Contract: { entity: "clm_contract_t", query: "queryContract" },
  Purchase_Order: { entity: "po_header_t", query: "queryPoHeader" },
  Stage_Cycle_Standard: { entity: "cfg_stage_cycle_standard_t", query: "queryStageCycleConfig" },
  Stock_Transfer_Request: { entity: "inv_transaction_order_t", query: "queryTransactionOrders" },
  // 场景二 own objects
  Inventory_Onhand_Balance: { entity: "inv_onhand_balance_t", query: "queryOnhandQuantity" },
  Inventory_Reservation: { entity: "inv_reservation_t", query: "queryReservation" },
  Inventory_MinMax_Level: { entity: "inv_min_max_level_t", query: "queryItemMinMaxLevel" },
  Central_Purchase_Catalog: { entity: "cfg_central_catalog_t", query: "queryCentralCatalogConfig" },
  Audit_Threshold_Setting: { entity: "cfg_audit_threshold_t", query: "queryAuditThresholdConfig" },
  Frame_Agreement: { entity: "ss_spa_header_t", query: "querySpaList" },
  Frame_Agreement_Item: { entity: "ss_spa_line_t", query: "querySpaLine" },
  Purchase_Category: { entity: "cfg_purchase_category_t", query: "queryPurchaseCategory" },
  Sourcing_Package_Line: { entity: "ss_proc_package_line_t", query: "queryProcPackageLine" },
  Demand_Merge_Suggestion: { entity: "dw_demand_merge_suggestion_t", query: "queryDemandMergeSuggestions" },
  Stock_Check_Result: { entity: "dw_stock_check_result_t", query: "queryStockCheckResults" },
  Backward_Schedule_Plan: { entity: "dw_backward_schedule_plan_t", query: "queryBackwardSchedulePlans" },
  Backward_Schedule_Stage: { entity: "dw_backward_schedule_stage_t", query: "queryBackwardScheduleStages" },
  Package_Scheme: { entity: "dw_package_scheme_t", query: "queryPackageSchemes" },
  Plan_Audit_Opinion: { entity: "dw_plan_audit_opinion_t", query: "queryPlanAuditOpinions" },
  Plan_Audit_Finding: { entity: "dw_plan_audit_finding_t", query: "queryPlanAuditFindings" },
  Packaging_Compliance_Finding: { entity: "dw_packaging_finding_t", query: "queryPackagingFindings" },
  Digital_Employee_Task: { entity: "dw_employee_task_t", query: "queryEmployeeTasks" },
  Digital_Employee_Operation_Log: { entity: "dw_operation_log_t", query: "queryOperationLogs" },
};

// Read ops with no owning Data Object — ERP ledgers the reasoning reads but the
// ontology deliberately does not model (whitepaper §六: only build what a
// decision must SEE). They still need a catalog entry.
const EXTRA_QUERY_OPS = {
  queryPoLine: {
    entity: "po_line_t",
    label: "订单行台账（历史价格曲线的样本）",
  },
};

// ── stub tables for apps/mock-erp ────────────────────────────────────────────
// One worked example threaded end to end: 检修一部 提了两条同物料的断路器需求,
// 需求日期相差 12 天（≤30 天 → 可合并）；库存现有量 4 台、预留 2 台、安全库存
// 6 台 —— 可用量 2 台顶不住合并后的 20 台，判定「需采购」，进入倒排工期。
// 另有一条 M-CAB-240 电缆需求，需求日期相差 74 天（>60 天 → 需拆分），
// 走人工确认的拆分分支。
const STUB_TABLES = {
  ss_pbp_header_t: [
    {
      PBP_HEADER_ID: "PBP-2027-0101",
      PLAN_NO: "PBP-2027-0101",
      BUSINESS_TYPE: "物资",
      PLAN_TYPE: "年度计划",
      STATUS: "已批准",
      DEMAND_ORGANIZATION: "华东检修分公司",
      DEMAND_DEPARTMENT: "检修一部",
      PLANNER: "张计划",
      DEPARTMENT_LEADER: "李部长",
      DIVISION_LEADER: "王分管",
      SUBMITTED_AT: "2026-11-20T09:00:00+08:00",
      APPROVED_AT: "2026-11-28T16:30:00+08:00",
      ANNUAL_PLAN_FLAG: true,
      TOTAL_AMOUNT: 4_800_000,
    },
    {
      PBP_HEADER_ID: "PBP-2027-0102",
      PLAN_NO: "PBP-2027-0102",
      BUSINESS_TYPE: "物资",
      PLAN_TYPE: "年度计划",
      STATUS: "已批准",
      DEMAND_ORGANIZATION: "华东检修分公司",
      DEMAND_DEPARTMENT: "检修二部",
      PLANNER: "赵计划",
      DEPARTMENT_LEADER: "李部长",
      DIVISION_LEADER: "王分管",
      SUBMITTED_AT: "2026-11-21T09:00:00+08:00",
      APPROVED_AT: "2026-11-29T10:10:00+08:00",
      ANNUAL_PLAN_FLAG: true,
      TOTAL_AMOUNT: 2_100_000,
    },
    {
      PBP_HEADER_ID: "PBP-2027-0199",
      PLAN_NO: "PBP-2027-0199",
      BUSINESS_TYPE: "物资",
      PLAN_TYPE: "年度计划",
      STATUS: "草稿",
      DEMAND_ORGANIZATION: "华东检修分公司",
      DEMAND_DEPARTMENT: "检修三部",
      PLANNER: "钱计划",
      ANNUAL_PLAN_FLAG: true,
      TOTAL_AMOUNT: 500_000,
    },
  ],
  ss_pbp_line_t: [
    {
      PBP_LINE_ID: "PBPL-2027-0101-01",
      PBP_HEADER_ID: "PBP-2027-0101",
      LINE_TYPE_CODE: "MAT-STD",
      MATERIAL_CODE: "M-BRK-126",
      MATERIAL_NAME: "126kV SF6 断路器",
      QUANTITY: 12,
      UNIT: "台",
      ESTIMATED_UNIT_PRICE: 285_000,
      REQUIRED_ARRIVAL_DATE: "2027-05-20",
      INVENTORY_ORG: "ORG-HD-01",
      SPLIT_FLAG: false,
      STATUS: "已批准",
    },
    {
      PBP_LINE_ID: "PBPL-2027-0102-01",
      PBP_HEADER_ID: "PBP-2027-0102",
      LINE_TYPE_CODE: "MAT-STD",
      MATERIAL_CODE: "M-BRK-126",
      MATERIAL_NAME: "126kV SF6 断路器",
      QUANTITY: 8,
      UNIT: "台",
      ESTIMATED_UNIT_PRICE: 292_000,
      REQUIRED_ARRIVAL_DATE: "2027-06-01",
      INVENTORY_ORG: "ORG-HD-01",
      SPLIT_FLAG: false,
      STATUS: "已批准",
    },
    {
      PBP_LINE_ID: "PBPL-2027-0101-02",
      PBP_HEADER_ID: "PBP-2027-0101",
      LINE_TYPE_CODE: "MAT-STD",
      MATERIAL_CODE: "M-CAB-240",
      MATERIAL_NAME: "240mm² 交联电缆",
      QUANTITY: 6_000,
      UNIT: "米",
      ESTIMATED_UNIT_PRICE: 180,
      REQUIRED_ARRIVAL_DATE: "2027-03-10",
      INVENTORY_ORG: "ORG-HD-01",
      SPLIT_FLAG: false,
      STATUS: "已批准",
    },
    {
      PBP_LINE_ID: "PBPL-2027-0102-02",
      PBP_HEADER_ID: "PBP-2027-0102",
      LINE_TYPE_CODE: "MAT-STD",
      MATERIAL_CODE: "M-CAB-240",
      MATERIAL_NAME: "240mm² 交联电缆",
      QUANTITY: 4_000,
      UNIT: "米",
      ESTIMATED_UNIT_PRICE: 176,
      REQUIRED_ARRIVAL_DATE: "2027-05-23",
      INVENTORY_ORG: "ORG-HD-01",
      SPLIT_FLAG: false,
      STATUS: "已批准",
    },
  ],
  inv_onhand_balance_t: [
    {
      ONHAND_BALANCE_ID: "OH-M-BRK-126-ORG-HD-01",
      MATERIAL_CODE: "M-BRK-126",
      INVENTORY_ORG: "ORG-HD-01",
      QUALIFIED_ONHAND_QTY: 4,
      UNIT: "台",
      SNAPSHOT_AT: "2026-12-01T00:00:00+08:00",
    },
    {
      ONHAND_BALANCE_ID: "OH-M-CAB-240-ORG-HD-01",
      MATERIAL_CODE: "M-CAB-240",
      INVENTORY_ORG: "ORG-HD-01",
      QUALIFIED_ONHAND_QTY: 12_000,
      UNIT: "米",
      SNAPSHOT_AT: "2026-12-01T00:00:00+08:00",
    },
  ],
  inv_reservation_t: [
    {
      RESERVATION_RECORD_ID: "RSV-0001",
      MATERIAL_CODE: "M-BRK-126",
      INVENTORY_ORG: "ORG-HD-01",
      RESERVED_QTY: 2,
      RESERVED_FOR: "PBP-2026-0873",
    },
    {
      RESERVATION_RECORD_ID: "RSV-0002",
      MATERIAL_CODE: "M-CAB-240",
      INVENTORY_ORG: "ORG-HD-01",
      RESERVED_QTY: 500,
      RESERVED_FOR: "PBP-2026-0914",
    },
  ],
  inv_min_max_level_t: [
    {
      MIN_MAX_LEVEL_ID: "MML-M-BRK-126-ORG-HD-01",
      MATERIAL_CODE: "M-BRK-126",
      INVENTORY_ORG: "ORG-HD-01",
      SAFETY_STOCK_QTY: 6,
      MAX_STOCK_QTY: 15,
    },
    {
      // 电缆现有量 12000 已达最大库存 10000 → 可调度分支
      MIN_MAX_LEVEL_ID: "MML-M-CAB-240-ORG-HD-01",
      MATERIAL_CODE: "M-CAB-240",
      INVENTORY_ORG: "ORG-HD-01",
      SAFETY_STOCK_QTY: 2_000,
      MAX_STOCK_QTY: 10_000,
    },
  ],
  cfg_stage_cycle_standard_t: [
    { CYCLE_STANDARD_ID: "CYC-MAT-01", BUSINESS_TYPE: "物资", STAGE_NODE: "立项", STAGE_SEQUENCE: 1, STANDARD_CYCLE_DAYS: 10 },
    { CYCLE_STANDARD_ID: "CYC-MAT-02", BUSINESS_TYPE: "物资", STAGE_NODE: "组包", STAGE_SEQUENCE: 2, STANDARD_CYCLE_DAYS: 15 },
    { CYCLE_STANDARD_ID: "CYC-MAT-03", BUSINESS_TYPE: "物资", STAGE_NODE: "分配", STAGE_SEQUENCE: 3, STANDARD_CYCLE_DAYS: 5 },
    { CYCLE_STANDARD_ID: "CYC-MAT-04", BUSINESS_TYPE: "物资", STAGE_NODE: "询价", STAGE_SEQUENCE: 4, STANDARD_CYCLE_DAYS: 20 },
    { CYCLE_STANDARD_ID: "CYC-MAT-05", BUSINESS_TYPE: "物资", STAGE_NODE: "应答", STAGE_SEQUENCE: 5, STANDARD_CYCLE_DAYS: 10 },
    { CYCLE_STANDARD_ID: "CYC-MAT-06", BUSINESS_TYPE: "物资", STAGE_NODE: "评标", STAGE_SEQUENCE: 6, STANDARD_CYCLE_DAYS: 7 },
    { CYCLE_STANDARD_ID: "CYC-MAT-07", BUSINESS_TYPE: "物资", STAGE_NODE: "定标", STAGE_SEQUENCE: 7, STANDARD_CYCLE_DAYS: 15 },
    { CYCLE_STANDARD_ID: "CYC-MAT-08", BUSINESS_TYPE: "物资", STAGE_NODE: "合同签订", STAGE_SEQUENCE: 8, STANDARD_CYCLE_DAYS: 15 },
  ],
  cfg_central_catalog_t: [
    {
      CATALOG_ID: "CC-001",
      MATERIAL_CODE: "M-BRK-126",
      CATEGORY_CODE: "CAT-HV-SWITCH",
      CENTRAL_PURCHASE_FLAG: true,
      CENTRAL_PURCHASE_LEVEL: "集团集采",
      EFFECTIVE_FROM: "2026-01-01",
    },
    {
      CATALOG_ID: "CC-002",
      MATERIAL_CODE: "M-CAB-240",
      CATEGORY_CODE: "CAT-CABLE",
      CENTRAL_PURCHASE_FLAG: false,
      CENTRAL_PURCHASE_LEVEL: "省级自采",
      EFFECTIVE_FROM: "2026-01-01",
    },
  ],
  cfg_audit_threshold_t: [
    {
      AUDIT_THRESHOLD_ID: "AT-PRICE-DEV",
      THRESHOLD_CODE: "PRICE_DEVIATION_RATIO",
      THRESHOLD_VALUE: 0.1,
      DESCRIPTION: "预估单价相对历史加权均价的允许偏离比例，超出即拦截。",
    },
    {
      AUDIT_THRESHOLD_ID: "AT-PKG-AMOUNT",
      THRESHOLD_CODE: "PACKAGE_MAX_AMOUNT",
      THRESHOLD_VALUE: 5_000_000,
      DESCRIPTION: "单个采购包金额上限，超出须拆包。",
    },
    {
      AUDIT_THRESHOLD_ID: "AT-PKG-CATEGORY",
      THRESHOLD_CODE: "PACKAGE_CATEGORY_MIXED",
      THRESHOLD_VALUE: 1,
      DESCRIPTION: "单个采购包允许的品类数上限，超出即组包不合规。",
    },
    {
      AUDIT_THRESHOLD_ID: "AT-MERGE-NEAR",
      THRESHOLD_CODE: "MERGE_WINDOW_DAYS",
      THRESHOLD_VALUE: 30,
      DESCRIPTION: "需求日期差 ≤ 该天数可直接合并。",
    },
    {
      AUDIT_THRESHOLD_ID: "AT-SPLIT-FAR",
      THRESHOLD_CODE: "SPLIT_WINDOW_DAYS",
      THRESHOLD_VALUE: 60,
      DESCRIPTION: "需求日期差 > 该天数必须拆分；介于两者之间由计划员确认。",
    },
  ],
  cfg_purchase_category_t: [
    { CATEGORY_ID: "CAT-HV-SWITCH", CATEGORY_CODE: "CAT-HV-SWITCH", CATEGORY_NAME: "高压开关设备", PARENT_CATEGORY_CODE: "CAT-PRIMARY" },
    { CATEGORY_ID: "CAT-CABLE", CATEGORY_CODE: "CAT-CABLE", CATEGORY_NAME: "电力电缆", PARENT_CATEGORY_CODE: "CAT-PRIMARY" },
  ],
  ss_spa_header_t: [
    {
      SPA_HEADER_ID: "SPA-2026-0007",
      FRAME_AGREEMENT_NO: "SPA-2026-0007",
      SUPPLIER_NAME: "华东电气股份",
      CATEGORY_CODE: "CAT-HV-SWITCH",
      VALID_FROM: "2026-01-01",
      VALID_TO: "2027-12-31",
      STATUS: "生效",
    },
  ],
  ss_spa_line_t: [
    {
      SPA_LINE_ID: "SPAL-2026-0007-01",
      SPA_HEADER_ID: "SPA-2026-0007",
      MATERIAL_CODE: "M-BRK-126",
      AGREED_UNIT_PRICE: 279_000,
      MIN_ORDER_QTY: 4,
    },
  ],
  clm_contract_t: [
    {
      CONTRACT_ID: "CT-2026-0311",
      CONTRACT_NO: "CT-2026-0311",
      MATERIAL_CODE: "M-BRK-126",
      SUPPLIER_NAME: "华东电气股份",
      CONTRACT_UNIT_PRICE: 281_000,
      SIGNING_DATE: "2026-03-11",
      STATUS: "已生效",
    },
  ],
  po_header_t: [
    {
      PO_HEADER_ID: "PO-2026-20487",
      PO_NO: "PO-2026-20487",
      SUPPLIER_NAME: "华东电气股份",
      APPROVED_AT: "2026-04-02T10:00:00+08:00",
      STATUS: "已生效",
    },
  ],
  po_line_t: [
    { PO_LINE_ID: "POL-2026-20487-01", PO_HEADER_ID: "PO-2026-20487", MATERIAL_CODE: "M-BRK-126", ORDER_QTY: 6, UNIT_PRICE: 280_000, ORDER_DATE: "2026-04-02" },
    { PO_LINE_ID: "POL-2026-19902-01", PO_HEADER_ID: "PO-2026-19902", MATERIAL_CODE: "M-BRK-126", ORDER_QTY: 10, UNIT_PRICE: 276_500, ORDER_DATE: "2026-01-18" },
    { PO_LINE_ID: "POL-2026-20110-01", PO_HEADER_ID: "PO-2026-20110", MATERIAL_CODE: "M-CAB-240", ORDER_QTY: 8_000, UNIT_PRICE: 172, ORDER_DATE: "2026-02-25" },
  ],
  pr_header_t: [],
  ss_proc_package_header_t: [],
  ss_proc_package_line_t: [],
  inv_transaction_order_t: [],
  // 数字员工自己产出的对象：首轮为空，由运行写入
  dw_demand_merge_suggestion_t: [],
  dw_stock_check_result_t: [],
  dw_backward_schedule_plan_t: [],
  dw_backward_schedule_stage_t: [],
  dw_package_scheme_t: [],
  dw_plan_audit_opinion_t: [],
  dw_plan_audit_finding_t: [],
  dw_packaging_finding_t: [],
  dw_employee_task_t: [],
  dw_operation_log_t: [],
};

/**
 * Guard-phase rule bindings promoted to preconditions, so a false guard stops
 * the action instead of merely annotating it. Same mechanism 场景一 uses.
 */
const GUARD_AS_PRECONDITION = {};

/**
 * Mandatory-precondition bindings the ontology declares on the wrong action —
 * see docs/hc-digital-worker-ontology-corrections.md D-01.
 *
 * D-01 `BR2-HITL-01` reads「执行计划草稿尚未被计划员确认…则**不得提交审批**」and
 *   its CEL checks `line.draft_confirmed_by != "" && scheme.scheme_status ==
 *   "已选定"`. That is the gate on `submitPlanForApproval`, and it is correctly
 *   bound there. It is ALSO bound to `splitOversizedDemand`, where neither term
 *   can be true — a demand split happens long before any draft is confirmed or
 *   any package scheme is selected, and the split has its own planner
 *   confirmation as a manual step. Left in place the gate is unsatisfiable and
 *   the whole action is skipped, which is exactly what it did on first run.
 */
const DROP_RULE_BINDINGS = {
  splitOversizedDemand: ["BR2-HITL-01"],
};

/**
 * 取数与判定协议：写进 action.description, not into output_contracts.
 *
 * The compiler puts `description` first in the action prompt; overlay
 * `output_contracts` render under 「字段说明」 as output fields, and a model
 * reliably transcribes a procedure placed there as a field to emit rather than
 * steps to follow. Procedure belongs in the procedure section.
 */
const PROMPT_PREAMBLE = {
  scanApprovedDemandPlan: [
    "",
    "【取数步骤（在产出 JSON 之前必须先按此执行）】",
    "",
    "第 0 步：**每一次 metaERP 查询都必须带上事件负载里的 unit_code（管理单元编码）**，",
    "涉及库存的查询再加上 organization_code（库存组织编码）。真实 metaERP 没有这两个",
    "字段会直接拒绝（`字段:管理单元编码不能为空`），查不到任何数据。事件里给了什么就",
    "照抄什么，不要自己编。",
    "",
    "第 1 步：**同一轮一次性并发**调用 queryPbpHeader 与 queryPbpLine，不要串行。",
    "第 2 步：只保留 STATUS=已批准 的计划头，草稿/已取消/已删除一律剔除（R2-01）。",
    "第 3 步：把计划行按其 PBP_HEADER_ID 归到对应计划头下，行的物料、数量、",
    "需求到货日期、计划行类型编码原样带出，不得改写编码。",
    "",
    "scan_date **原样照抄**触发事件负载里的 scan_date，不得用你认知里的今天。",
  ].join("\n"),
  analyzeDemandMerge: [
    "",
    "【判定步骤】",
    "",
    "第 1 步：按 `物料编码 + 计划行类型编码` 聚类，同组内两两比较需求到货日期。",
    "第 2 步：按天数差分档（阈值取自上游 thresholds_used，缺失时用 30/60 默认值）：",
    "  ≤30 天 → 可合并 mergeable；>60 天 → 需拆分 split_required；",
    "  介于两者之间 → 待计划员确认 needs_confirmation。",
    "第 3 步：可合并组算合并数量之和与**按数量加权**的预估单价：",
    "  weighted_price = Σ(qty_i × price_i) / Σ(qty_i)，保留两位小数。",
    "第 4 步：只要有任意一组落在 split_required，就把 split_required 置 true。",
    "",
    "组内计划行编号一律用 metaERP 返回的原值，不得自造。",
  ].join("\n"),
  verifyInventoryAvailability: [
    "",
    "【取数与判定步骤】",
    "",
    "第 1 步：**同一轮一次性并发**调用 queryOnhandQuantity、queryReservation、",
    "queryItemMinMaxLevel 三个接口，不要串行。",
    "第 2 步：按 `物料编码 + 库存组织` 汇总：",
    "  可用量 available_qty = 合格现有量 − 已预留量。",
    "第 3 步：与两条水位线比对，逐条需求判出 stock_check_flag：",
    "  现有量 ≥ 最大库存 且 非紧急 → `可调度`（转调拨，不建采购计划）；",
    "  可用量 < 需求量 → `需采购`（进入倒排工期）；",
    "  可用量 ≥ 需求量 但现有量 < 安全库存 → `触及安全库存`（仍需采购并标注）。",
    "",
    "判定必须逐条给出，且写明用到的现有量/预留量/两条水位线的数值。",
  ].join("\n"),
  derivePurchaseSchedule: [
    "",
    "【倒排步骤（逐字照算，不得凭感觉）】",
    "",
    "节点顺序固定：立项1／组包2／分配3／询价4／应答5／评标6／定标7／合同签订8。",
    "标准周期取自 queryStageCycleConfig 中该 business_type 的行。",
    "",
    "  planned_finish(k) = required_arrival_date − Σ standard_cycle_days(j)，j 从 k+1 到 8",
    "",
    "即最后一个节点（合同签订）的计划完成时间**就是**需求到货日期本身；",
    "其余节点 = 需求到货日期 减去**它之后**所有节点的标准周期之和，**不含本节点周期**。",
    "",
    "正排交叉校验：planned_finish(k) 应等于 planned_finish(k−1) + standard_cycle_days(k)。",
    "两向一致才置 schedule_derived=true。",
    "若倒排出的立项计划完成时间早于 scan_date，置 time_conflict=true 并说明缺口天数。",
  ].join("\n"),
  auditAnnualPlanCompliance: [
    "",
    "【取数与校验步骤】",
    "",
    "第 1 步：**同一轮一次性并发**调用 queryCentralCatalogConfig、queryAuditThresholdConfig、",
    "queryPoLine、queryContract 四个接口，不要串行。",
    "第 2 步：逐条计划行做三项校验：",
    "  ①【集采】物料在集采目录且 CENTRAL_PURCHASE_FLAG=true，但计划未标集采 → 违规；",
    "  ②【价格】预估单价相对历史加权均价的偏离比例 > PRICE_DEVIATION_RATIO 阈值 → 违规；",
    "     历史加权均价 = Σ(ORDER_QTY × UNIT_PRICE) / Σ(ORDER_QTY)，样本取同物料的订单行；",
    "  ③【必填】物料编码、数量、需求到货日期、库存组织任一为空 → 违规。",
    "第 3 步：任意一条违规 → audit_passed=false，并逐条给出 finding；全部通过才置 true。",
    "",
    "阈值必须取自 queryAuditThresholdConfig 返回值，不得写死。",
  ].join("\n"),
  recommendPackagingScheme: [
    "",
    "【组包步骤】",
    "",
    "第 1 步：按 `采购品类 + 需求到货时间窗 + 需求单位` 聚类候选包。",
    "第 2 步：对每个候选包算包内金额合计与品类数。",
    "第 3 步：与阈值比对（取自 queryAuditThresholdConfig）：",
    "  金额合计 > PACKAGE_MAX_AMOUNT → 不合规，须拆包；",
    "  品类数 > PACKAGE_CATEGORY_MIXED → 不合规，混装超限。",
    "第 4 步：只要有任意一个候选包不合规，就把 packaging_compliant 置 false，",
    "并逐条给出 finding；全部合规才置 true。",
  ].join("\n"),
};

// ── helpers ──────────────────────────────────────────────────────────────────

function fail(message) {
  console.error(`[stage-hc-digital-worker] ${message}`);
  process.exit(1);
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, stableJson(value), "utf8");
}

/** Resolve `<family>_v*.json` inside the Studio export directory. */
function familyFile(sourceDir, family) {
  const matches = readdirSync(sourceDir)
    .filter((file) => file.startsWith(`${family}_v`) && file.endsWith(".json"))
    .sort();
  if (!matches.length) fail(`no ${family}_v*.json under ${sourceDir}`);
  return path.join(sourceDir, matches[matches.length - 1]);
}

function readFamily(sourceDir, family) {
  return JSON.parse(readFileSync(familyFile(sourceDir, family), "utf8"));
}

const catalogPath = (operation) => `${CATALOG_BASE}/${operation}`;

/**
 * The ontology's actor vocabulary is Agent | Human | System | External; the
 * manifest's is Agent | Human, because that enum answers exactly one question —
 * does this node stop for a person. System and External both mean "it does not".
 */
function projectActors(actors) {
  const mapped = (actors ?? []).map((actor) => (actor === "Human" ? "Human" : "Agent"));
  const unique = [...new Set(mapped)];
  return unique.length ? unique : ["Agent"];
}

/**
 * Manual `action_steps` the ontology declares but that would stop the chain for
 * no decision. Empty for 场景二 as authored — every manual step here carries a
 * real choice. Kept as a declared table so a future correction has a home.
 */
const DROP_MANUAL_STEPS = {};

function projectActionSteps(action) {
  const dropped = new Set(DROP_MANUAL_STEPS[action.id] ?? []);
  if (dropped.size === 0) return action.action_steps ?? [];
  const kept = (action.action_steps ?? []).filter(
    (step) => !(step.object_type === "manual" && dropped.has(step.name)),
  );
  for (const name of dropped) {
    if (!(action.action_steps ?? []).some((step) => step.name === name)) {
      fail(
        `${action.id}: DROP_MANUAL_STEPS names "${name}", which the ontology no longer declares — the correction has landed, remove the entry`,
      );
    }
  }
  return kept;
}

// ── action projection ────────────────────────────────────────────────────────

function projectActions(rawActions) {
  return rawActions.map((action) => {
    const map = ACTION_MAP[action.id];
    if (!map) fail(`action ${action.id} has no ACTION_MAP entry — add one before staging`);

    // `SCHEDULED`/`TIMER` are cadences, not event names. Dropping them lets the
    // compiler install its synthetic MANUAL_<action> trigger so the agent stays
    // invocable; the ontology's own scheduled event
    // (DAILY_DEMAND_PLAN_SCAN_SCHEDULED) is a real event and is kept.
    const trigger = (action.trigger ?? []).filter(
      (entry) => entry !== "SCHEDULED" && entry !== "TIMER" && entry !== "MANUAL",
    );

    const sideEffects = { ...(action.side_effects ?? {}) };
    if (map.kind === "prompt") {
      sideEffects.external_calls = (map.queries ?? []).map((query) => ({
        system: "metaERP",
        endpoint: catalogPath(query.operation),
        method: "POST",
        description: query.description,
      }));
    } else {
      sideEffects.external_calls = [
        {
          system: "metaERP",
          endpoint: catalogPath(map.operation),
          method: "POST",
          description:
            (action.side_effects?.external_calls ?? [])[0]?.description ??
            `${map.operation}：${action.name} 写回 metaERP。`,
        },
      ];
    }

    const implementation =
      map.kind === "prompt"
        ? { kind: "prompt", executable: true }
        : {
            kind: "external",
            executable: true,
            operation_id: map.operation,
            endpoint: catalogPath(map.operation),
            method: "POST",
          };

    const promoted = new Set(GUARD_AS_PRECONDITION[action.id] ?? []);
    const droppedRules = new Set(DROP_RULE_BINDINGS[action.id] ?? []);
    for (const ruleId of droppedRules) {
      if (!(action.rule_bindings ?? []).some((b) => b.rule_id === ruleId)) {
        fail(
          `${action.id}: DROP_RULE_BINDINGS names "${ruleId}", which the ontology no longer binds — the correction has landed, remove the entry`,
        );
      }
    }
    const ruleBindings = (action.rule_bindings ?? [])
      .filter((binding) => !droppedRules.has(binding.rule_id))
      .map((binding) =>
        promoted.has(binding.rule_id) && binding.phase === "guard"
          ? { ...binding, phase: "precondition", studio_phase: "guard" }
          : binding,
      );

    const preamble = PROMPT_PREAMBLE[action.id];

    return {
      ...action,
      actor: projectActors(action.actor),
      action_steps: projectActionSteps(action),
      description: preamble
        ? `${action.description ?? action.name}\n${preamble}`
        : action.description,
      rule_bindings: ruleBindings,
      trigger,
      side_effects: sideEffects,
      implementation,
      studio_implementation: action.implementation ?? null,
    };
  });
}

function buildTransformMaps(objects, actions) {
  const objectMaps = objects.map((object) => {
    const map = OBJECT_MAP[object.id];
    if (!map) fail(`object ${object.id} has no OBJECT_MAP entry — add one before staging`);
    return {
      object_id: object.id,
      object_name: object.name,
      erp_entity: map.entity,
      fetch: { method: "POST", path: catalogPath(map.query) },
    };
  });

  for (const [operation, ledger] of Object.entries(EXTRA_QUERY_OPS)) {
    objectMaps.push({
      object_id: ledger.entity,
      object_name: ledger.label,
      erp_entity: ledger.entity,
      fetch: { method: "POST", path: catalogPath(operation) },
    });
  }

  const actionMaps = actions.map((action) => {
    const map = ACTION_MAP[action.id];
    return map.kind === "external"
      ? {
          action_id: action.id,
          action_name: action.name,
          kind: "external",
          operation_id: map.operation,
          endpoint: catalogPath(map.operation),
          method: "POST",
          data_changes: [{ target_object: map.target }],
        }
      : {
          action_id: action.id,
          action_name: action.name,
          kind: "prompt",
          queries: (map.queries ?? []).map((query) => query.operation),
        };
  });

  return { object_maps: objectMaps, action_maps: actionMaps };
}

/** apps/mock-erp reads `_index.json` for its query ops + table stubs. */
function buildMockErpIndex(objects) {
  const endpoints = [];
  const seen = new Set();
  for (const object of objects) {
    const map = OBJECT_MAP[object.id];
    if (seen.has(map.query)) continue;
    seen.add(map.query);
    endpoints.push({
      operation: map.query,
      entity: map.entity,
      object_id: object.id,
      file: `${map.entity}.json`,
    });
  }
  for (const [operation, ledger] of Object.entries(EXTRA_QUERY_OPS)) {
    if (seen.has(operation)) continue;
    seen.add(operation);
    endpoints.push({
      operation,
      entity: ledger.entity,
      object_id: ledger.entity,
      file: `${ledger.entity}.json`,
    });
  }
  endpoints.sort((a, b) => a.operation.localeCompare(b.operation, "en"));
  return { base_path: CATALOG_BASE, endpoints };
}

// ── main ─────────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg, index) => !(arg === "--" && index === 0)),
  options: {
    source: { type: "string", default: "ontology-packages/hc-digital-worker/source" },
    out: { type: "string", default: "ontology-packages/hc-digital-worker/package" },
  },
  allowPositionals: false,
});

const sourceDir = path.resolve(ROOT, values.source);
/**
 * Fields the ontology's scan events need before they can address a real ERP.
 *
 * `scan_scope` already says「全集团或指定管理单元」—— but there is no field
 * carrying WHICH management unit, and every real metaERP query rejects a
 * request without one (`字段:管理单元编码不能为空`, `organizationCode 不能为空`
 * …). Against the mock this never showed, because the mock filters on whatever
 * it is given. See docs/hc-digital-worker-ontology-corrections.md D-08.
 */
const SCAN_SCOPE_FIELDS = {
  DAILY_DEMAND_PLAN_SCAN_SCHEDULED: [
    {
      name: "unit_code",
      type: "String",
      required: false,
      description: "管理单元编码；scan_scope=指定管理单元时必填，metaERP 每个查询都要它。",
    },
    {
      name: "organization_code",
      type: "String",
      required: false,
      description: "库存组织编码；库存现有量/预留/水位查询要它。",
    },
  ],
};

/** Append the missing scope fields, leaving every authored field untouched. */
function withScanScopeFields(events) {
  return events.map((event) => {
    const extra = SCAN_SCOPE_FIELDS[event.name];
    if (!extra) return event;
    const existing = new Set(
      (event.payload?.event_data ?? []).map((field) => field.name),
    );
    const added = extra.filter((field) => !existing.has(field.name));
    if (!added.length) return event;
    return {
      ...event,
      payload: {
        ...event.payload,
        event_data: [...(event.payload?.event_data ?? []), ...added],
      },
    };
  });
}

const outDir = path.resolve(ROOT, values.out);
const domainDir = path.join(outDir, "studio-models", NAMESPACE, DOMAIN);

const rawActionsFile = readFamily(sourceDir, "actions");
const rawEvents = readFamily(sourceDir, "events");
const rawObjects = readFamily(sourceDir, "objects");
const rawRules = readFamily(sourceDir, "rules");
const rawWorkflows = readFamily(sourceDir, "workflows");
const rawLinks = readFamily(sourceDir, "links");

const rawActions = Array.isArray(rawActionsFile) ? rawActionsFile : rawActionsFile.actions;
const objects = rawObjects.payload ?? rawObjects.objects;
const rules = rawRules.payload ?? rawRules.rules;
const actions = projectActions(rawActions);

/** Every table the index promises must exist, or a query op 404s at runtime. */
for (const [, map] of Object.entries(OBJECT_MAP)) {
  if (!(map.entity in STUB_TABLES)) {
    fail(`OBJECT_MAP entity ${map.entity} has no STUB_TABLES entry — mock ERP would 404`);
  }
}
for (const ledger of Object.values(EXTRA_QUERY_OPS)) {
  if (!(ledger.entity in STUB_TABLES)) {
    fail(`EXTRA_QUERY_OPS entity ${ledger.entity} has no STUB_TABLES entry`);
  }
}

rmSync(outDir, { recursive: true, force: true });

writeJson(path.join(domainDir, "actions_v0_1_008.json"), actions);
writeJson(path.join(domainDir, "events_v0_1_008.json"), {
  metadata: rawEvents.metadata,
  events: withScanScopeFields(rawEvents.events),
});
writeJson(path.join(domainDir, "objects_v0_1_008.json"), {
  metadata: rawObjects.metadata,
  payload: objects,
});
writeJson(path.join(domainDir, "rules_v0_2_008.json"), {
  metadata: rawRules.metadata,
  payload: rules,
});
writeJson(path.join(domainDir, "workflows_v0_1_008.json"), {
  metadata: rawWorkflows.metadata,
  workflows: rawWorkflows.workflows,
});
writeJson(path.join(domainDir, "links_v0_1_008.json"), {
  metadata: rawLinks.metadata,
  links: rawLinks.links ?? rawLinks.payload,
});

writeJson(
  path.join(outDir, "transform-maps", "transform-maps.json"),
  buildTransformMaps(objects, actions),
);

writeJson(path.join(outDir, "mock-erp", "_index.json"), buildMockErpIndex(objects));
for (const [entity, rows] of Object.entries(STUB_TABLES)) {
  writeJson(path.join(outDir, "mock-erp", `${entity}.json`), { rows });
}

const promptCount = Object.values(ACTION_MAP).filter((m) => m.kind === "prompt").length;
console.log(
  `[stage-hc-digital-worker] staged ${actions.length} actions (${promptCount} prompt / ${
    actions.length - promptCount
  } external), ${rawEvents.events.length} events, ${objects.length} objects, ${
    rules.length
  } rules, ${rawWorkflows.workflows.length} workflow → ${path.relative(ROOT, outDir)}`,
);
