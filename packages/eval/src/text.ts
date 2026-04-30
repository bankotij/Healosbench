/**
 * Text-similarity primitives shared across the per-field metrics.
 *
 * Design choices:
 * - Lowercase, strip punctuation, collapse whitespace before comparing.
 *   Most disagreements between the model and the gold are surface-form, not
 *   semantic, and we want fuzzy matchers to be robust to that.
 * - Expand a small set of clinical abbreviations so "viral URI" matches
 *   "viral upper respiratory infection" and "BID" matches "twice daily".
 *   The list is intentionally short — we want the *score* to reflect real
 *   disagreement, not abbreviation dictionary coverage.
 * - The headline `tokenSetRatio` mixes Jaccard on token sets with normalized
 *   Levenshtein on the canonicalized strings. Jaccard handles word-order /
 *   ±a-token noise; Levenshtein handles spelling drift on short strings
 *   (e.g. "lisinopril" vs "lisinipril"). The arithmetic mean of the two is
 *   surprisingly robust on short clinical phrases without needing a real
 *   embedding model.
 */

export const CLINICAL_ABBREVIATIONS: Record<string, string> = {
  // Conditions / diagnoses
  uri: "upper respiratory infection",
  uti: "urinary tract infection",
  htn: "hypertension",
  dm: "diabetes mellitus",
  t2dm: "type 2 diabetes mellitus",
  t1dm: "type 1 diabetes mellitus",
  gerd: "gastroesophageal reflux disease",
  copd: "chronic obstructive pulmonary disease",
  cad: "coronary artery disease",
  chf: "congestive heart failure",
  ckd: "chronic kidney disease",
  afib: "atrial fibrillation",
  mi: "myocardial infarction",
  cva: "cerebrovascular accident",

  // Frequencies
  bid: "twice daily",
  tid: "three times daily",
  qid: "four times daily",
  qd: "daily",
  qhs: "at bedtime",
  qam: "in the morning",
  qpm: "in the evening",
  qod: "every other day",
  prn: "as needed",
  ac: "before meals",
  pc: "after meals",

  // Routes
  po: "oral",
  iv: "intravenous",
  im: "intramuscular",
  sq: "subcutaneous",
  sc: "subcutaneous",
  sl: "sublingual",
  pr: "per rectum",
  // "topical" and "inhaled" are usually written out.
};

const PUNCT_RE = /[\p{P}\p{S}]+/gu;
const WS_RE = /\s+/g;
const Q_HOUR_RE = /\bq(\d+)h\b/gi;

/**
 * Lowercase, strip punctuation, collapse whitespace, expand a small set of
 * clinical abbreviations. Pure — does not consult any per-call state.
 */
export function normalize(input: string): string {
  if (!input) return "";
  let s = input.toLowerCase().normalize("NFKC");
  s = s.replace(PUNCT_RE, " ");
  // q6h → every 6 hours, q12h → every 12 hours. Done before token-level
  // expansion since the abbreviation dict is keyed on whole tokens.
  s = s.replace(Q_HOUR_RE, (_, n) => `every ${n} hours`);
  s = s.replace(WS_RE, " ").trim();
  const tokens = s.split(" ").map((tok) => CLINICAL_ABBREVIATIONS[tok] ?? tok);
  return tokens.join(" ").replace(WS_RE, " ").trim();
}

export function tokens(input: string): string[] {
  const n = normalize(input);
  return n ? n.split(" ") : [];
}

/** Jaccard similarity on token sets ∈ [0, 1]. */
export function jaccard(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Normalized Levenshtein similarity ∈ [0, 1] on the *canonicalized* strings.
 * 1 = identical after normalization; 0 = entirely different.
 */
export function levenshteinSimilarity(a: string, b: string): number {
  const an = normalize(a);
  const bn = normalize(b);
  if (an === bn) return 1;
  if (!an || !bn) return 0;
  const dist = levenshtein(an, bn);
  const maxLen = Math.max(an.length, bn.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // Two-row DP — O(min(|a|, |b|)) memory.
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  const m = shorter.length;
  const n = longer.length;
  let prev = new Array<number>(m + 1);
  let curr = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    curr[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = longer[i - 1] === shorter[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1, // deletion
        curr[j - 1]! + 1, // insertion
        prev[j - 1]! + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m]!;
}

/**
 * Headline fuzzy-match score in [0, 1]. Average of Jaccard token-set
 * similarity and normalized Levenshtein similarity. Both ingredients agree
 * on identical strings (return 1.0) and on totally disjoint strings
 * (return ~0.0); they diverge usefully on the in-between cases.
 */
export function tokenSetRatio(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  return (jaccard(a, b) + levenshteinSimilarity(a, b)) / 2;
}

/**
 * Convenience: returns true iff `tokenSetRatio(a, b) >= threshold`. Default
 * 0.8 — empirically a sensible cut-off for clinical phrase matching.
 */
export function fuzzyEqual(a: string, b: string, threshold = 0.8): boolean {
  return tokenSetRatio(a, b) >= threshold;
}
