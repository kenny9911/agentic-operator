# HC-数字员工 · 场景二本体待修正项

> 面向本体维护者（含 AI 辅助修改）。每一条给出：**改哪个 id、现状、建议改成什么、
> 为什么、以及支撑该结论的实跑证据**。
>
> 目标本体：`procurement-hc-formal-0.1.8` 中的「场景2_数字化员工的智能作业实践」
> （抽取脚本 `scripts/extract-hc-digital-worker-source.mjs`，落到
> `ontology-packages/hc-digital-worker/source/`）
>
> 证据来源：`apps/api/test/hc-digital-worker-scenario2.e2e.test.ts` —— 14 个编译后的
> agent 跑真实引擎（registerAgent + step-engine）、真实 mock Meta ERP、脚本化网关，
> 人工闸口按 `POST /v1/tasks/:id/resolve` 的同一路径自动作答。

---

## D-01 `BR2-HITL-01` 绑到了 `splitOversizedDemand`，该动作因此永远不执行

**现状**：`BR2-HITL-01` 的描述是「执行计划草稿尚未被计划员确认…则**不得提交审批**」，
CEL 判据是 `line.draft_confirmed_by != "" && scheme.scheme_status == "已选定"`。
这是 `submitPlanForApproval` 的闸口，本体在那里绑得没错；但它**同时**绑在
`splitOversizedDemand` 上。

**问题**：需求拆分发生在任何草稿被确认、任何组包方案被选定之前，两个判据项都不可能为真。
闸口恒假 → 整个动作被跳过。首轮实跑就是这个结果。

**建议修正**：删除 `splitOversizedDemand` 上的 `BR2-HITL-01` 绑定。该动作自己的计划员
确认已经由 manual step（`confirmSplitByPlanner`）表达。

**平台侧现状**：已在 `scripts/stage-hc-digital-worker-ontology.mjs` 的
`DROP_RULE_BINDINGS` 中投影。本体修正后请删掉该条目——条目失效时适配器会报错提醒。

---

## D-02 人工闸口的分支判据必须落在表单字段上，不能指望「审批结论」本身

**现状**：`splitOversizedDemand` / `returnPlanForRectification` / `confirmPlanAndPackage`
三个动作都以「人工确认通过后才发出下游事件」为语义，但本体只描述了确认这件事，没有给出
一个**机器可读的确认结论字段**。

**问题**：编译出的清单走的是运行时的 legacy 模式，该模式下
`stepResults["manual-N"]` **只是操作员提交的表单内容**，不是决议信封——
`decision` / `outcome` 都不在里面（见 `packages/runtime/src/register.ts`
`manualResult` 的三分支）。任何写成 `results.manual-N.outcome == 'approved'` 的
条件都恒假，下游事件被静默跳过：动作自己是 `ok`，链路却断在这里。

**建议修正**：给每个人工确认步骤显式声明一个结论字段（枚举 `approved` / `rejected`），
并让下游判据引用它。场景一的 `approveAdjustmentOption.plannerConfirm` 已经是这个写法，
场景二照搬即可。

**平台侧现状**：`overlays/hc-digital-worker.json` 的三个 `manual_steps` 表单都加了
必填的 `decision` 枚举，四处 emission 判据改为 `results.manual-N.decision == '…'`。

---

## D-03 「驳回原因」被无条件追问，且会连带取消 ERP 回写

**现状**：`confirmPlanAndPackage` 的两个 action_step 是顺序的：
`confirmByPlanner`（order 1）、`captureRejectionReason`（order 2）。本体没有说第二步
只在驳回时发生——表单标题写着「仅驳回时填写」，但那是给人看的散文。

**问题**：两层。其一，计划员点了「确认」之后仍被追问一次驳回原因，是无意义的人工闸口。
其二，编译器把后续步骤 `depends_on` 到每一个 manual step 上，而运行时**任一依赖被跳过
即跳过依赖方**（`shouldSkip`）——所以简单地给第二步加条件，会让确认路径上的 ERP 回写
和下游事件一起消失。

**建议修正**：给 `captureRejectionReason` 一个机器可判定的前置条件（驳回时才问）。

**平台侧现状**：编译器新增「带条件的 manual step 是**可选**步骤」这一语义：它照常按
条件跳过，但**不进入**后续步骤的 `depends_on`，因此不会连坐主路径
（`packages/ontology-compiler/src/compile.ts`，`OverlayManualStep.condition`）。
覆盖层据此把该步条件设为 `results.manual-2.decision == 'rejected'`。

---

## D-04 `pushTask` 是一个通用待办端点，本体没说每个调用方推的是哪种待办

**现状**：`returnPlanForRectification`（R2-04）与 `raisePackagingComplianceAlert`
都映射到同一个写操作 `pushTask`，而该操作要求 `TASK_TYPE`。本体的两个动作都没有声明
自己推送的待办类型。

**问题**：`TASK_TYPE` 既不在事件里，也不在操作员表单里——它是**动作自身的常量**。
交给 LLM 现编等于把一个确定值变成一次生成；写进人工表单则是让操作员填一个系统常量。
实跑中 ERP 直接 `400 missing required field: TASK_TYPE`。

**建议修正**：在动作的实现映射上声明该动作固定的 `task_type`（以及 `title` /
`assignee_role` 之类同属动作常量的字段）。

**平台侧现状**：工具入参模板新增 `with`——在 `from` 解析出的对象之上浅合并调用方常量
（`packages/runtime/src/action-plan.ts` `ToolArgumentSource`；与 `const` 走同一套
有限 JSON 校验）。覆盖层为两个动作分别声明「计划整改」与「组包合规预警」。

---

## D-05 `PLAN_AND_PACKAGE_CONFIRMED` 透传上游事件，把闸口要的 `confirmed_by` 丢了

**现状**：`confirmPlanAndPackage` 确认后发出 `PLAN_AND_PACKAGE_CONFIRMED`，载荷取自
上游事件；`submitPlanForApproval` 的 `BR2-HITL-01` 闸口判 `confirmed_by` 是否存在。

**问题**：`confirmed_by` 只存在于计划员的确认表单里，上游事件从来没有这个字段。闸口恒假
→ 提交审批被跳过，链路停在最后一步之前。这正是 BR2-HITL-01 想拦的情形的反面：
它拦掉的是**已经确认过**的计划。

**建议修正**：确认类事件的载荷应取自该次确认本身，而不是它的触发事件。

**平台侧现状**：覆盖层把该 emission 的 `payload_from` 改为 `results.manual-2`
（确认表单），`PLAN_AND_PACKAGE_REJECTED` 仍取事件载荷——重排组包需要的是完整计划上下文。

---

## D-06 人工闸口的「驳回」分支在编译产物里走不通

**现状**：`confirmPlanAndPackage` 建模了两条出路——确认后 `PLAN_AND_PACKAGE_CONFIRMED`，
驳回后 `PLAN_AND_PACKAGE_REJECTED` 回到 `recommendPackagingScheme` 重排组包。

**问题**：编译产物跑在运行时的 legacy 模式，该模式下**人工驳回直接判运行失败**
（`register.ts`：`manualDecision === "reject"` → `failRun("human rejected")` 并抛出），
根本到不了 ERP 回写和已声明的 emission。而想绕开也不行：resolve 路由会把表单里的
`decision: "rejected"` 归一化后与任务决议比对，不一致就 `task_decision_mismatch`——
所以「任务判通过、表单填驳回」这条路是被堵死的。两头都堵，驳回分支不可达。

只有 v2（Agent Studio）定义把驳回当作正常业务结果继续往下走
（`usesV2Definition` 分支），编译器目前不产出 v2 定义。

**当前行为**（已由 e2e 用例钉住）：计划员驳回 → 运行 failed、无 ERP 回写、无下游事件。
组包重排要靠人重新触发，不是自动回环。

**建议修正**：两条路二选一——要么把这类闸口编成 v2 定义，让驳回成为一等业务结果；
要么在本体里承认这一点，把「驳回后重排」建模成一个独立动作，而不是同一个人工步骤的
另一条出边。**在此之前，不要在演示脚本里承诺驳回会自动回到组包。**

---

## D-07 人工闸口的候选项必须是表单能记录的东西

**现状**：`splitOversizedDemand`（R2-01）的待办要计划员「确认拆分方案」，表单记录的字段是
`plan_line_id`。但 `analyzeDemandMerge` 的输出里，合并建议只带
`member_plan_line_ids` / `source_plan_line_ids`，没有 `plan_line_id`，也没有任何一个
适合给人读的短名。

**问题**：待办面板按**形状**识别候选项——两三条同构记录就是一组选项。于是它把
「已批准的两份需求计划」也当成了选项，单选框显示成「检修一部」「检修二部」；真正的合并
建议则因为字段名对不上，选中后什么也填不进表单。计划员看到的是一组既看不懂、选了也不
产生任何效果的选项，而必填的 `plan_line_id` 仍然要手敲。

**建议修正**：让每条合并建议自带两样东西——
`plan_line_id`（这条建议要处理的目标计划行，即表单要记录的值）与
`split_option_label`（不超过 20 字的短名，例如「M-BRK-126 三行合并」）。

**平台侧现状**：
- 覆盖层已把这两个字段写进 `analyzeDemandMerge` 的输出契约。
- 面板侧收紧了候选项的判定：**一组同构记录只有在能回答表单至少一个字段时才算候选项**
  （`apps/web/app/portal/components/runs/task-context.ts`）。选了不改变提交内容的东西
  不是选项。
- 命名改为优先取 `label` / `name` / `title` 结尾的键，避免标题取决于键的排列顺序。
