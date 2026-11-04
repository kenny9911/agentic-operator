import type { OntologyAction } from "./ontology-types";

/** Keep authored failure policies as evidence, without interpreting their prose
 * or converting an unknown policy into a new executable outcome. */
export function actionPreconditionsPromptBlock(action: OntologyAction): string {
  const criteria = typeof action.submission_criteria === "string"
    ? action.submission_criteria.trim()
    : "";
  if (!criteria) return "";

  const stepErrorPolicies = (action.action_steps ?? []).flatMap((step, index) => {
    const policies = Object.fromEntries(
      ["errorPolicy", "error_policy", "onError", "on_error"]
        .filter((key) => Object.hasOwn(step, key))
        .map((key) => [key, step[key]]),
    );
    if (!Object.keys(policies).length) return [];
    return [{
      sourcePath: `action_steps[${index}]`,
      id: step.id ?? step.stepId ?? step.step_id ?? null,
      ...policies,
    }];
  });

  return [
    "【前置条件（运行前必须满足；不满足时 fail-close，按源契约处理）】",
    criteria,
    "失败处理遵守源 Action.on_failure 与适用步骤的 errorPolicy/onError；步骤策略只适用于其原始范围，不得移作前置条件的失败策略或把 continue 改成全局终止。suppressEmit:true 仅抑制该失败边界的隐式失败事件，不自行删除显式 emit 步骤；源契约另行禁止业务输出时仍须遵守。terminal 不等于必须发出失败事件。仅在适用的源失败策略明确要求且 Action.triggered_event 已声明时发出失败事件。",
    "源策略缺失、未知或互相冲突时，保留并报告契约缺口；禁止擅自补发事件、补默认结果或继续成功路径。以下为源契约原文，不能据此跳过计划校验、审查或运行时门禁：",
    JSON.stringify({
      on_failure: action.on_failure ?? null,
      triggered_event: action.triggered_event,
      step_error_policies: stepErrorPolicies,
    }, null, 2),
  ].join("\n");
}
