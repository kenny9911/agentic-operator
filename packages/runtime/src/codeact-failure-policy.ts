import { classifyActionFailure, type ActionFailureResolution } from "./error-policy";

/** Recognize the Factory renderer's policy without admitting custom side effects. */
export function usesGeneratedCodeActFailurePolicy(policy: unknown): boolean {
  if (policy === undefined) return true;
  if (!Array.isArray(policy) || policy.length !== 4) return false;
  return policy.every((rule, index) => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) return false;
    const tag = ["terminal", "park", "retry"][index];
    return index === 3
      ? Object.keys(rule).length === 2 && rule.default === "retry" && rule.suppress_emit === true
      : Object.keys(rule).length === 3 && rule.when === `meta.codeExecutionError.includes('[${tag}]')`
        && rule.do === tag && rule.suppress_emit === true;
  });
}

/** Only trusted invocation-stage failures may carry authored control-flow tags. */
export function codeActFailureResolution(input: {
  failure: string;
  error: string;
  handlerStarted?: boolean;
  failureStage?: string;
  inputValidationPending?: boolean;
}): ActionFailureResolution {
  const handlerFailure = input.failure === "candidate_failed"
    && input.handlerStarted === true && input.failureStage === "handler";
  const tag = handlerFailure ? /^\[(terminal|park|retry)\](?:\s|$)/.exec(input.error)?.[1] : undefined;
  if (input.inputValidationPending && tag !== "terminal") {
    // Invalid declared input cannot park, retry, continue, or emit through a
    // policy. Keep the original execution failure in the receipt; this is a
    // host contract stop, not evidence of an authored handler rejection.
    return classifyActionFailure({
      policy: "terminal",
      failure: new Error(`invalid declared input blocked CodeAct ${input.failure} (${input.failureStage ?? "unknown"}): ${input.error}`),
    });
  }
  return classifyActionFailure({
    policy: tag === "terminal" ? "terminal"
      : tag === "park" ? [{ default: "park", suppress_emit: true }] : undefined,
    failure: new Error(input.error),
  });
}
