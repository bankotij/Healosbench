import { evaluateCase, type EvaluateInput } from "@healosbench/eval";
import type { CaseEvaluation } from "@healosbench/shared";

/**
 * Thin server-side wrapper around `packages/eval`. The metric logic lives
 * in the eval package so the CLI and tests can call it without booting the
 * server. Persistence is the runner's responsibility.
 */
export function evaluatePrediction(input: EvaluateInput): CaseEvaluation {
  return evaluateCase(input);
}

export type { EvaluateInput };
