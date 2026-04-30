import type { Medication } from "@test-evals/shared";

import { normalize, tokenSetRatio } from "./text";

/**
 * Set-based F1 over medications.
 *
 * Two meds match iff:
 *   - name tokenSetRatio >= NAME_THRESHOLD
 *   - normalizedDose(pred.dose) === normalizedDose(gold.dose)
 *   - normalizedFrequency(pred.frequency) === normalizedFrequency(gold.frequency)
 *
 * Route is intentionally NOT part of the match key — it's frequently null in
 * the gold (route is implied by the medication or simply omitted by the
 * clinician), so requiring agreement would create false negatives. Route
 * disagreement is still surfaced as part of `details` for downstream display.
 */

const NAME_THRESHOLD = 0.8;

export interface MedSetScore {
  precision: number;
  recall: number;
  f1: number;
  matches: Array<{
    pred_index: number;
    gold_index: number;
    name_score: number;
    dose_match: boolean;
    frequency_match: boolean;
    route_match: boolean;
  }>;
  unmatched_pred: number[]; // indices into pred[]
  unmatched_gold: number[]; // indices into gold[]
}

export function scoreMedications(
  pred: Medication[],
  gold: Medication[],
): MedSetScore {
  // Special case: both empty = perfect F1 (correct abstention).
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

  // Greedy bipartite match by descending name similarity, gated on
  // dose+frequency agreement. Greedy is fine at this scale (≤ ~10 meds per
  // case); the Hungarian algorithm wouldn't change scores noticeably.
  const candidates: Array<{
    pi: number;
    gi: number;
    name: number;
    dose: boolean;
    frequency: boolean;
    route: boolean;
  }> = [];
  for (let pi = 0; pi < pred.length; pi++) {
    for (let gi = 0; gi < gold.length; gi++) {
      const p = pred[pi]!;
      const g = gold[gi]!;
      const name = tokenSetRatio(p.name, g.name);
      const dose = normalizeDose(p.dose) === normalizeDose(g.dose);
      const frequency =
        normalizeFrequency(p.frequency) === normalizeFrequency(g.frequency);
      const route = normalizeRoute(p.route) === normalizeRoute(g.route);
      if (name >= NAME_THRESHOLD && dose && frequency) {
        candidates.push({ pi, gi, name, dose, frequency, route });
      }
    }
  }
  candidates.sort((a, b) => b.name - a.name);

  const usedPred = new Set<number>();
  const usedGold = new Set<number>();
  const matches: MedSetScore["matches"] = [];
  for (const c of candidates) {
    if (usedPred.has(c.pi) || usedGold.has(c.gi)) continue;
    usedPred.add(c.pi);
    usedGold.add(c.gi);
    matches.push({
      pred_index: c.pi,
      gold_index: c.gi,
      name_score: c.name,
      dose_match: c.dose,
      frequency_match: c.frequency,
      route_match: c.route,
    });
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

// ---------- normalization helpers ------------------------------------------

const DOSE_RE = /(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|cc|units?|iu|drops?|puffs?|tablets?|capsules?)\b/iu;

/**
 * Canonical form for dose strings.
 *  - "10 mg" / "10mg" / "10  mg" → "10mg"
 *  - "0.5 mg" → "500mcg" (mg → mcg conversion when the result is integer-ish)
 *  - returns null when the input is null or unparseable. Two unparseable
 *    doses are equal iff they are identical (after lowercase + whitespace
 *    collapse) — fall-through path.
 */
export function normalizeDose(input: string | null): string | null {
  if (input === null) return null;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  const m = DOSE_RE.exec(trimmed);
  if (!m) return trimmed.replace(/\s+/g, " ");
  const value = Number.parseFloat(m[1]!);
  let unit = m[2]!.toLowerCase();
  // Singularize a couple of variants.
  unit = unit.replace(/^units$/, "unit").replace(/s$/, (s) => (unit === "drops" || unit === "puffs" || unit === "tablets" || unit === "capsules" ? s : ""));
  // mg ↔ mcg conversion when it produces clean numbers.
  if (unit === "mg" && value < 1 && Number.isInteger(value * 1000)) {
    return `${value * 1000}mcg`;
  }
  // Drop trailing .0 from "10.0" → "10".
  const valueStr = Number.isInteger(value) ? String(value) : String(value);
  return `${valueStr}${unit}`;
}

const FREQUENCY_CANONICAL: Array<{ patterns: RegExp[]; canonical: string }> = [
  {
    canonical: "every 4 hours",
    patterns: [/\b(q\s?4\s?h|every\s+4\s+hours?)\b/i],
  },
  {
    canonical: "every 6 hours",
    patterns: [/\b(q\s?6\s?h|every\s+6\s+hours?)\b/i],
  },
  {
    canonical: "every 8 hours",
    patterns: [/\b(q\s?8\s?h|every\s+8\s+hours?|tid|three\s+times\s+(?:a\s+)?daily?|three\s+times\s+a\s+day)\b/i],
  },
  {
    canonical: "every 12 hours",
    patterns: [/\b(q\s?12\s?h|every\s+12\s+hours?|bid|twice\s+(?:a\s+)?daily|twice\s+a\s+day)\b/i],
  },
  {
    canonical: "four times daily",
    patterns: [/\b(qid|four\s+times\s+(?:a\s+)?daily|four\s+times\s+a\s+day)\b/i],
  },
  {
    canonical: "once daily",
    patterns: [/\b(qd|once\s+daily|once\s+a\s+day|every\s+morning|every\s+evening|qam|qpm|daily)\b/i],
  },
  {
    canonical: "at bedtime",
    patterns: [/\b(qhs|at\s+bedtime|bedtime)\b/i],
  },
  {
    canonical: "every other day",
    patterns: [/\b(qod|every\s+other\s+day)\b/i],
  },
  {
    canonical: "as needed",
    patterns: [/\b(prn|as\s+needed|when\s+needed)\b/i],
  },
];

/**
 * Canonical form for frequency strings. Combines a base cadence (e.g.
 * "every 6 hours") with optional "as needed" qualifier.
 */
export function normalizeFrequency(input: string | null): string | null {
  if (input === null) return null;
  const lc = normalize(input);
  if (!lc) return null;
  let cadence: string | null = null;
  for (const entry of FREQUENCY_CANONICAL) {
    if (entry.canonical === "as needed") continue;
    if (entry.patterns.some((p) => p.test(lc))) {
      cadence = entry.canonical;
      break;
    }
  }
  const prn = FREQUENCY_CANONICAL.find((e) => e.canonical === "as needed")!;
  const isPrn = prn.patterns.some((p) => p.test(lc));
  if (cadence && isPrn) return `${cadence} as needed`;
  if (cadence) return cadence;
  if (isPrn) return "as needed";
  return lc;
}

const ROUTE_MAP: Record<string, string> = {
  po: "oral",
  oral: "oral",
  "by mouth": "oral",
  iv: "intravenous",
  intravenous: "intravenous",
  im: "intramuscular",
  intramuscular: "intramuscular",
  sq: "subcutaneous",
  sc: "subcutaneous",
  subcutaneous: "subcutaneous",
  sl: "sublingual",
  sublingual: "sublingual",
  pr: "rectal",
  rectal: "rectal",
  "per rectum": "rectal",
  topical: "topical",
  inhaled: "inhaled",
  nebulized: "inhaled",
};

export function normalizeRoute(input: string | null): string | null {
  if (input === null) return null;
  const lc = normalize(input);
  if (!lc) return null;
  return ROUTE_MAP[lc] ?? lc;
}
