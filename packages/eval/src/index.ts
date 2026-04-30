export { evaluateCase } from "./evaluate";
export type { EvaluateInput } from "./evaluate";

export {
  CLINICAL_ABBREVIATIONS,
  fuzzyEqual,
  jaccard,
  levenshteinSimilarity,
  normalize,
  tokenSetRatio,
  tokens,
} from "./text";

export { scoreVitals } from "./vitals";
export type { VitalsBreakdown } from "./vitals";

export {
  normalizeDose,
  normalizeFrequency,
  normalizeRoute,
  scoreMedications,
} from "./medications";
export type { MedSetScore } from "./medications";

export { scoreDiagnoses } from "./diagnoses";
export type { DiagnosisScore } from "./diagnoses";

export { scorePlan } from "./plan";
export type { PlanScore } from "./plan";

export { scoreFollowUp } from "./follow_up";
export type { FollowUpScore } from "./follow_up";

export { detectHallucinations } from "./hallucination";
export type { HallucinationReport } from "./hallucination";

export { findGroundingSpans } from "./grounding";
export type { GroundingSpan } from "./grounding";
