import type { FollowUp } from "@test-evals/shared";

import { tokenSetRatio } from "./text";

export interface FollowUpScore {
  interval_match: number; // 0 or 1
  reason_score: number; // [0, 1]
  overall: number; // average of the two — when reason is null on both sides, only interval contributes
}

/**
 * Combined follow-up score:
 *  - interval_days: exact match (with null-equality), 0/1
 *  - reason: fuzzy tokenSetRatio in [0, 1]
 *
 * If both reasons are null, reason scores 1.0 (correct abstention). If exactly
 * one is null, reason is 0. The overall score is the equal-weighted average,
 * matching the README's "exact on interval_days, fuzzy on reason".
 */
export function scoreFollowUp(pred: FollowUp, gold: FollowUp): FollowUpScore {
  const interval_match = pred.interval_days === gold.interval_days ? 1 : 0;
  let reason_score: number;
  if (pred.reason === null && gold.reason === null) reason_score = 1;
  else if (pred.reason === null || gold.reason === null) reason_score = 0;
  else reason_score = tokenSetRatio(pred.reason, gold.reason);
  return {
    interval_match,
    reason_score,
    overall: (interval_match + reason_score) / 2,
  };
}
