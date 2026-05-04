import type { Vitals } from "@healosbench/shared";

/**
 * Per-sub-field 0/1 scoring for vitals, then averaged over the four
 * sub-fields. Numeric fields tolerate a small drift to avoid penalizing
 * harmless rounding differences (e.g. 100.4 vs 100.5 °F).
 *
 *  - bp: exact string match after stripping spaces (so "128/82" == "128 / 82")
 *  - hr: exact integer match (no tolerance — heart rate is dictated)
 *  - temp_f: ±0.2 °F tolerance per the README
 *  - spo2: exact integer match (typically also dictated)
 *
 * If both gold and prediction have a sub-field as null, that's a 1.0 (correct
 * abstention). If exactly one is null, that's a 0.0.
 */

export interface VitalsBreakdown {
  bp: number;
  hr: number;
  temp_f: number;
  spo2: number;
  /** Mean of the four sub-field scores. */
  mean: number;
}

const TEMP_TOLERANCE_F = 0.2;

export function scoreVitals(pred: Vitals, gold: Vitals): VitalsBreakdown {
  const bp = scoreBp(pred.bp, gold.bp);
  const hr = scoreInteger(pred.hr, gold.hr);
  const temp_f = scoreNumber(pred.temp_f, gold.temp_f, TEMP_TOLERANCE_F);
  const spo2 = scoreInteger(pred.spo2, gold.spo2);
  return {
    bp,
    hr,
    temp_f,
    spo2,
    mean: (bp + hr + temp_f + spo2) / 4,
  };
}

function scoreBp(pred: string | null, gold: string | null): number {
  if (pred === null && gold === null) return 1;
  if (pred === null || gold === null) return 0;
  const np = pred.replace(/\s+/g, "");
  const ng = gold.replace(/\s+/g, "");
  return np === ng ? 1 : 0;
}

function scoreInteger(pred: number | null, gold: number | null): number {
  if (pred === null && gold === null) return 1;
  if (pred === null || gold === null) return 0;
  return pred === gold ? 1 : 0;
}

function scoreNumber(
  pred: number | null,
  gold: number | null,
  tolerance: number,
): number {
  if (pred === null && gold === null) return 1;
  if (pred === null || gold === null) return 0;
  return Math.abs(pred - gold) <= tolerance ? 1 : 0;
}
