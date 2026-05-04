import type { Diagnosis } from "@healosbench/shared";

import { tokens, tokenSetRatio } from "./text";

/**
 * Set-based F1 over diagnoses by fuzzy `description` match. ICD-10 codes
 * grant a small bonus when both sides have one and they agree exactly.
 *
 *  base_score      = F1 on description fuzzy match
 *  icd_bonus       = (matched-pairs with same icd10) / (gold pairs that have icd10)
 *  overall         = clamp01(base_score + 0.05 * icd_bonus)
 *
 * The bonus is small on purpose — ICD-10 codes are nice-to-have signal, not a
 * pass/fail dimension. `details` exposes the components so the dashboard can
 * show "F1 0.83, ICD-10 1.0" separately.
 */

const DESC_THRESHOLD = 0.7;
/**
 * Score we assign when one description's normalized token set is a strict
 * subset of the other's (e.g. gold "chronic constipation" vs pred
 * "constipation"). The model identified the right condition; one side is
 * strictly more specific. Above DESC_THRESHOLD so it counts as a hit, but
 * lower than 1.0 so the dashboard still flags the modifier difference.
 */
const SUBSET_SCORE = 0.85;

/**
 * "Subset match": one normalized token set is a strict, non-empty subset of
 * the other. Captures cases where the model dropped or added a single
 * clinical modifier ("chronic", "acute", "viral"). Empty intersections
 * (e.g. "diabetes" vs "asthma") never trigger this.
 */
function isTokenSubset(a: string, b: string): boolean {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return false;
  if (ta.size === tb.size) return false; // not a strict subset
  const [smaller, bigger] = ta.size < tb.size ? [ta, tb] : [tb, ta];
  for (const t of smaller) if (!bigger.has(t)) return false;
  return true;
}

export interface DiagnosisScore {
  precision: number;
  recall: number;
  f1: number;
  icd_match_rate: number | null;
  /** F1 + small ICD bonus, clamped to [0, 1]. This is the headline score. */
  overall: number;
  matches: Array<{
    pred_index: number;
    gold_index: number;
    desc_score: number;
    icd_match: boolean | null;
  }>;
  unmatched_pred: number[];
  unmatched_gold: number[];
}

export function scoreDiagnoses(
  pred: Diagnosis[],
  gold: Diagnosis[],
): DiagnosisScore {
  if (pred.length === 0 && gold.length === 0) {
    return {
      precision: 1,
      recall: 1,
      f1: 1,
      icd_match_rate: null,
      overall: 1,
      matches: [],
      unmatched_pred: [],
      unmatched_gold: [],
    };
  }

  const candidates: Array<{ pi: number; gi: number; score: number; icd: boolean | null }> = [];
  for (let pi = 0; pi < pred.length; pi++) {
    for (let gi = 0; gi < gold.length; gi++) {
      const pDesc = pred[pi]!.description;
      const gDesc = gold[gi]!.description;
      let score = tokenSetRatio(pDesc, gDesc);
      // Subset match: one side fully contained in the other on tokens.
      // Lifts pairs like ("constipation", "chronic constipation") above the
      // threshold without changing strict-mismatch behavior.
      if (score < DESC_THRESHOLD && isTokenSubset(pDesc, gDesc)) {
        score = SUBSET_SCORE;
      }
      if (score < DESC_THRESHOLD) continue;
      const pIcd = pred[pi]!.icd10 ?? null;
      const gIcd = gold[gi]!.icd10 ?? null;
      const icd = gIcd ? (pIcd === gIcd ? true : false) : null;
      candidates.push({ pi, gi, score, icd });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const usedPred = new Set<number>();
  const usedGold = new Set<number>();
  const matches: DiagnosisScore["matches"] = [];
  for (const c of candidates) {
    if (usedPred.has(c.pi) || usedGold.has(c.gi)) continue;
    usedPred.add(c.pi);
    usedGold.add(c.gi);
    matches.push({
      pred_index: c.pi,
      gold_index: c.gi,
      desc_score: c.score,
      icd_match: c.icd,
    });
  }

  const tp = matches.length;
  const fp = pred.length - tp;
  const fn = gold.length - tp;

  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  // ICD bonus is only meaningful when the gold has at least one icd10.
  const goldWithIcd = gold.filter((g) => g.icd10).length;
  let icdRate: number | null = null;
  if (goldWithIcd > 0) {
    const correctIcdPairs = matches.filter((m) => m.icd_match === true).length;
    icdRate = correctIcdPairs / goldWithIcd;
  }
  const icdBonus = (icdRate ?? 0) * 0.05;
  const overall = Math.max(0, Math.min(1, f1 + icdBonus));

  const unmatched_pred: number[] = [];
  for (let i = 0; i < pred.length; i++) if (!usedPred.has(i)) unmatched_pred.push(i);
  const unmatched_gold: number[] = [];
  for (let i = 0; i < gold.length; i++) if (!usedGold.has(i)) unmatched_gold.push(i);

  return {
    precision,
    recall,
    f1,
    icd_match_rate: icdRate,
    overall,
    matches,
    unmatched_pred,
    unmatched_gold,
  };
}
