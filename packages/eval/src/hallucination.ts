import type { Extraction } from "@test-evals/shared";

import { normalize } from "./text";

/**
 * Grounding check: every predicted "value-like" string must have textual
 * support in the transcript. Implementation (documented in NOTES.md):
 *
 *  1. Substring path: if the normalized value (>=3 chars) is a substring of
 *     the normalized transcript, it's grounded immediately.
 *  2. Token-coverage path: split the normalized value into "content tokens"
 *     (length >= 3, not a stopword) and check what fraction match a
 *     transcript token via prefix-stem matching (any transcript token shares
 *     a 4-char prefix with the value token, or vice versa for short tokens).
 *     If coverage >= COVERAGE_THRESHOLD, it's grounded. Prefix-stem matching
 *     catches paraphrase pairs like "worsening" / "worse" or "improving" /
 *     "improved" without needing a stemmer or wordlist.
 *
 * Fields excluded from the check:
 *  - diagnosis descriptions: by design, the doctor's diagnosis is a
 *    clinical inference using formal terminology ("hyperlipidemia",
 *    "gastroesophageal reflux disease"), so the transcript text — which
 *    captures the patient's lay description — almost never contains the
 *    diagnosis verbatim. Lexical grounding is the wrong tool here.
 *  - frequency / route on medications: the tiny vocabulary ("daily",
 *    "as needed", "PO") would let any random output ground.
 *
 * The grounding rate is reported in the run summary as
 * `hallucination_count` and surfaced per-field in the dashboard. A non-zero
 * rate is a SIGNAL for "the model paraphrased or fabricated"; combined with
 * per-field scores it tells you which one — paraphrase shows up as
 * grounded=false + high score; fabrication as grounded=false + low score.
 */

const COVERAGE_THRESHOLD = 0.4;
const MIN_VALUE_LENGTH = 3;
/** Min length for a token to ENTER coverage (so "48", "72" count). */
const MIN_VALUE_TOKEN_LENGTH = 2;
/** Min length for substring/prefix matching (to avoid "i" / "t" pathologies). */
const MIN_FUZZY_TOKEN_LENGTH = 3;
const PREFIX_LENGTH = 4;

const STOPWORDS = new Set([
  // Function words.
  "for", "and", "the", "a", "an", "of", "to", "in", "on", "with", "or", "as",
  "no", "not", "is", "are", "be", "been", "this", "that", "these", "those",
  "if", "then", "but", "than", "by", "from", "at", "into", "onto", "out",
  "over", "under", "again", "only", "just", "very", "too", "any", "some",
  "all", "both", "each", "few", "more", "most", "other", "such", "own",
  "same", "so", "they", "them", "their", "his", "her", "him", "she", "he",
  "we", "us", "our", "you", "your", "i", "me", "my", "mine",
  // Dose-form units. Excluded so fabricated doses like "500 mg" can't ground
  // just because the unit "mg" matches — what matters for grounding is the
  // numeric value.
  "mg", "mcg", "g", "ml", "cc", "iu", "unit", "units",
  "tablet", "tablets", "capsule", "capsules", "drop", "drops",
  "puff", "puffs", "spray", "sprays",
]);

export interface HallucinationReport {
  flagged_fields: string[];
  /** One entry per predicted value that failed the grounding check. */
  flagged_values: Array<{ field: string; value: string; reason: "no_match" | "low_coverage" }>;
}

export function detectHallucinations(
  pred: Extraction,
  transcript: string,
): HallucinationReport {
  const tNorm = normalize(transcript);
  const tRaw = transcript.toLowerCase();
  const tTokens = tNorm.split(" ").filter(Boolean);

  const flagged_values: HallucinationReport["flagged_values"] = [];
  const fieldSet = new Set<string>();
  const flag = (
    field: string,
    value: string,
    reason: "no_match" | "low_coverage" = "no_match",
  ) => {
    flagged_values.push({ field, value, reason });
    fieldSet.add(field);
  };

  const grounded = (value: string): boolean => {
    const v = normalize(value);
    if (v.length < MIN_VALUE_LENGTH) return true;
    if (tNorm.includes(v)) return true;
    return contentTokenCoverage(v, tTokens) >= COVERAGE_THRESHOLD;
  };

  // chief_complaint
  if (pred.chief_complaint && !grounded(pred.chief_complaint)) {
    flag("chief_complaint", pred.chief_complaint, "low_coverage");
  }

  // vitals — substring on the *raw* transcript so "98" matches "98%".
  for (const [key, value] of Object.entries(pred.vitals)) {
    if (value === null) continue;
    const valStr = String(value);
    if (!tRaw.includes(valStr.toLowerCase())) {
      flag(`vitals.${key}`, valStr);
    }
  }

  // medications — name + dose. Frequency/route omitted (vocab is too small).
  for (let i = 0; i < pred.medications.length; i++) {
    const m = pred.medications[i]!;
    if (!grounded(m.name)) flag(`medications[${i}].name`, m.name);
    if (m.dose !== null && !grounded(m.dose)) flag(`medications[${i}].dose`, m.dose);
  }

  // diagnoses — by design we DON'T ground diagnosis descriptions. The
  // doctor's diagnosis is a clinical inference using formal terminology
  // (e.g. "hyperlipidemia") that almost never appears verbatim in the
  // transcript (where the patient says "high cholesterol"). Lexical
  // grounding is the wrong tool here; a clinician would judge correctness
  // semantically, which is out of scope for this simple heuristic.

  // plan — each item.
  for (let i = 0; i < pred.plan.length; i++) {
    const p = pred.plan[i]!;
    if (!grounded(p)) flag(`plan[${i}]`, p, "low_coverage");
  }

  // follow_up.reason
  if (pred.follow_up.reason !== null && !grounded(pred.follow_up.reason)) {
    flag("follow_up.reason", pred.follow_up.reason, "low_coverage");
  }

  return {
    flagged_fields: Array.from(fieldSet),
    flagged_values,
  };
}

function contentTokenCoverage(
  valueNorm: string,
  transcriptTokens: string[],
): number {
  const tokens = valueNorm
    .split(" ")
    .filter((t) => t.length >= MIN_VALUE_TOKEN_LENGTH && !STOPWORDS.has(t));
  if (tokens.length === 0) return 1;
  let present = 0;
  for (const tok of tokens) {
    if (matchesAnyToken(tok, transcriptTokens)) present++;
  }
  return present / tokens.length;
}

/**
 * Returns true if `tok` matches any transcript token via prefix-stem
 * matching: either token is a substring of the other, OR they share a
 * 4-character prefix. Handles paraphrase pairs like "worsening" / "worse"
 * (share "wors") and "improved" / "improving" (share "improv").
 *
 * We require both tokens to be at least MIN_TOKEN_LENGTH chars before
 * applying substring or prefix logic — otherwise pathological matches like
 * "fictionix".includes("i") on a transcript containing the bare letter "i"
 * silently ground a fabricated value.
 */
function matchesAnyToken(tok: string, tTokens: string[]): boolean {
  // Exact match always works (lets short tokens like "48" / "72" ground).
  for (const t of tTokens) {
    if (t === tok) return true;
  }
  // Substring / prefix matching requires both tokens long enough to avoid
  // pathological matches like "fictionix".includes("i").
  if (tok.length < MIN_FUZZY_TOKEN_LENGTH) return false;
  const stem = tok.slice(0, Math.max(PREFIX_LENGTH, Math.ceil(tok.length / 2)));
  for (const t of tTokens) {
    if (t.length < MIN_FUZZY_TOKEN_LENGTH) continue;
    if (t.includes(tok) || tok.includes(t)) return true;
    if (t.startsWith(stem)) return true;
    const tStem = t.slice(0, Math.max(PREFIX_LENGTH, Math.ceil(t.length / 2)));
    if (tok.startsWith(tStem)) return true;
  }
  return false;
}
