import { tokenSetRatio } from "./text";

/**
 * Set-based F1 on plan items by fuzzy match. Each plan item is a free-text
 * action; greedy bipartite matching above a threshold counts as TP.
 */
const PLAN_THRESHOLD = 0.65;

export interface PlanScore {
  precision: number;
  recall: number;
  f1: number;
  matches: Array<{ pred_index: number; gold_index: number; score: number }>;
  unmatched_pred: number[];
  unmatched_gold: number[];
}

export function scorePlan(pred: string[], gold: string[]): PlanScore {
  if (pred.length === 0 && gold.length === 0) {
    return {
      precision: 1,
      recall: 1,
      f1: 1,
      matches: [],
      unmatched_pred: [],
      unmatched_gold: [],
    };
  }

  const candidates: Array<{ pi: number; gi: number; score: number }> = [];
  for (let pi = 0; pi < pred.length; pi++) {
    for (let gi = 0; gi < gold.length; gi++) {
      const score = tokenSetRatio(pred[pi]!, gold[gi]!);
      if (score >= PLAN_THRESHOLD) candidates.push({ pi, gi, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const usedPred = new Set<number>();
  const usedGold = new Set<number>();
  const matches: PlanScore["matches"] = [];
  for (const c of candidates) {
    if (usedPred.has(c.pi) || usedGold.has(c.gi)) continue;
    usedPred.add(c.pi);
    usedGold.add(c.gi);
    matches.push({ pred_index: c.pi, gold_index: c.gi, score: c.score });
  }

  const tp = matches.length;
  const fp = pred.length - tp;
  const fn = gold.length - tp;
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  const unmatched_pred: number[] = [];
  for (let i = 0; i < pred.length; i++) if (!usedPred.has(i)) unmatched_pred.push(i);
  const unmatched_gold: number[] = [];
  for (let i = 0; i < gold.length; i++) if (!usedGold.has(i)) unmatched_gold.push(i);

  return { precision, recall, f1, matches, unmatched_pred, unmatched_gold };
}
