import type { Extraction } from "@healosbench/shared";

/**
 * Build a list of grounded ranges in the transcript for the prediction's
 * value-like leaf fields.
 *
 * Powers the "transcript (highlighted where prediction values are grounded)"
 * panel on the case-detail page. Two tiers:
 *
 *  - **exact**: the whole predicted value is a case-insensitive substring of
 *    the transcript. Strongest signal; rendered as a solid highlight.
 *  - **partial**: a content token from the value (length ≥ 4, not a stopword
 *    / dose unit) is found in the transcript. Rendered as a softer
 *    underline, so the reviewer sees the model "got most of the words
 *    right" without being misled into thinking the whole phrase grounded.
 *
 * Field policy (intentionally matches `hallucination.ts`):
 *  - chief_complaint, plan items, follow_up.reason → exact + partial
 *  - vitals.* numeric values → exact substring on the raw transcript
 *  - medications[i].name and .dose → exact + partial
 *  - medications[i].frequency / .route → SKIPPED (vocabulary too small)
 *  - diagnoses → SKIPPED (clinical inference; lay terms in transcript)
 *
 * Pure: no I/O, no module state, deterministic — safe to call from a
 * server component during render.
 */

const STOPWORDS = new Set([
  "for", "and", "the", "a", "an", "of", "to", "in", "on", "with", "or", "as",
  "no", "not", "is", "are", "be", "been", "this", "that", "these", "those",
  "if", "then", "but", "than", "by", "from", "at", "into", "onto", "out",
  "over", "under", "again", "only", "just", "very", "too", "any", "some",
  "all", "both", "each", "few", "more", "most", "other", "such", "own",
  "same", "so", "they", "them", "their", "his", "her", "him", "she", "he",
  "we", "us", "our", "you", "your", "i", "me", "my", "mine",
  "mg", "mcg", "g", "ml", "cc", "iu", "unit", "units",
  "tablet", "tablets", "capsule", "capsules", "drop", "drops",
  "puff", "puffs", "spray", "sprays", "po", "iv", "im", "sq", "sc", "sl", "pr",
]);

/** A grounded range in the transcript. Indexes are into the raw transcript. */
export interface GroundingSpan {
  start: number;
  end: number;
  match: "exact" | "partial";
  /** Fields this span supports — usually 1, but a span can ground multiple leaf values. */
  fields: string[];
}

const MIN_VALUE_LENGTH = 3;
const MIN_TOKEN_LENGTH = 4;

export function findGroundingSpans(
  prediction: Extraction | null,
  transcript: string,
): GroundingSpan[] {
  if (prediction == null || !transcript) return [];

  // We collect raw spans first, then merge by overlapping range.
  const raw: Array<{ start: number; end: number; field: string; tier: "exact" | "partial" }> =
    [];

  const lcTranscript = transcript.toLowerCase();

  /**
   * Free-text grounding: try the whole value as a substring (≥ MIN_VALUE_LENGTH
   * chars to avoid pathological 1-2 char matches), then fall back to scanning
   * content tokens.
   */
  const tryGround = (field: string, value: string | null) => {
    if (value == null || !value.trim()) return;
    const trimmed = value.trim();
    if (trimmed.length >= MIN_VALUE_LENGTH) {
      const exactStart = lcTranscript.indexOf(trimmed.toLowerCase());
      if (exactStart !== -1) {
        raw.push({
          start: exactStart,
          end: exactStart + trimmed.length,
          field,
          tier: "exact",
        });
        return;
      }
    }
    const valueTokens = trimmed
      .toLowerCase()
      .split(/[^\p{L}\p{N}']+/u)
      .filter((t) => t.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(t));
    for (const tok of valueTokens) {
      const idx = lcTranscript.indexOf(tok);
      if (idx !== -1) {
        raw.push({ start: idx, end: idx + tok.length, field, tier: "partial" });
      }
    }
  };

  /**
   * Lexeme grounding: exact substring only, no minimum length, no token
   * fallback. Used for vitals and follow_up.interval_days where the predicted
   * value is a self-contained number that must appear verbatim ("72", "98",
   * "120/80"). Bypasses the 3-char floor so "72" can match.
   */
  const tryGroundLexeme = (field: string, value: string) => {
    if (!value) return;
    const idx = lcTranscript.indexOf(value.toLowerCase());
    if (idx !== -1) {
      raw.push({ start: idx, end: idx + value.length, field, tier: "exact" });
    }
  };

  // ---- chief_complaint ------------------------------------------------------
  tryGround("chief_complaint", prediction.chief_complaint);

  // ---- vitals (numeric / raw lexeme) ----------------------------------------
  // Use the lexeme variant: numbers like "72" or "98" are below the 3-char
  // floor used for free text but are perfectly legitimate vital values.
  const v = prediction.vitals;
  if (v.bp != null) tryGroundLexeme("vitals.bp", v.bp);
  if (v.hr != null) tryGroundLexeme("vitals.hr", String(v.hr));
  if (v.temp_f != null) tryGroundLexeme("vitals.temp_f", String(v.temp_f));
  if (v.spo2 != null) tryGroundLexeme("vitals.spo2", String(v.spo2));

  // ---- medications: name + dose only ----------------------------------------
  for (let i = 0; i < prediction.medications.length; i++) {
    const m = prediction.medications[i]!;
    tryGround(`medications[${i}].name`, m.name);
    tryGround(`medications[${i}].dose`, m.dose);
  }

  // ---- diagnoses: SKIPPED (clinical inference; lay terms in transcript) ----

  // ---- plan -----------------------------------------------------------------
  for (let i = 0; i < prediction.plan.length; i++) {
    tryGround(`plan[${i}]`, prediction.plan[i]!);
  }

  // ---- follow_up ------------------------------------------------------------
  if (prediction.follow_up.interval_days != null) {
    tryGroundLexeme(
      "follow_up.interval_days",
      String(prediction.follow_up.interval_days),
    );
  }
  tryGround("follow_up.reason", prediction.follow_up.reason);

  return mergeOverlapping(raw);
}

/**
 * Merge overlapping or adjacent ranges. Two ranges that overlap at all (even
 * by 1 char) coalesce into one whose `match` is the *strongest* tier of the
 * inputs (exact wins over partial) and whose `fields` is the union.
 *
 * Sorts the result by start index for stable rendering.
 */
function mergeOverlapping(
  raw: Array<{ start: number; end: number; field: string; tier: "exact" | "partial" }>,
): GroundingSpan[] {
  if (raw.length === 0) return [];
  const sorted = [...raw].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: GroundingSpan[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
      if (r.tier === "exact") last.match = "exact";
      if (!last.fields.includes(r.field)) last.fields.push(r.field);
    } else {
      merged.push({
        start: r.start,
        end: r.end,
        match: r.tier,
        fields: [r.field],
      });
    }
  }
  return merged;
}
