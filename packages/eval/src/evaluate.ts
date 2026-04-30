import type {
  CaseEvaluation,
  Extraction,
  FieldKey,
  FieldScore,
} from "@test-evals/shared";

import { scoreDiagnoses } from "./diagnoses";
import { scoreFollowUp } from "./follow_up";
import { detectHallucinations } from "./hallucination";
import { scoreMedications } from "./medications";
import { scorePlan } from "./plan";
import { tokenSetRatio } from "./text";
import { scoreVitals } from "./vitals";

export interface EvaluateInput {
  case_id: string;
  prediction: Extraction | null;
  gold: Extraction;
  transcript: string;
  /** True if the final attempt failed schema validation. */
  schemaInvalid: boolean;
}

/**
 * Apply the per-field metric to each field, average to overall_score, run
 * the grounding check on the prediction, and bundle into a CaseEvaluation
 * suitable for storage. When `prediction` is null (all retries failed), all
 * field scores are 0 and `schema_invalid` is true.
 */
export function evaluateCase(input: EvaluateInput): CaseEvaluation {
  const { prediction, gold, transcript, schemaInvalid } = input;

  if (!prediction || schemaInvalid) {
    return {
      case_id: input.case_id,
      scores: zeroScores(),
      overall_score: 0,
      hallucinated_fields: [],
      schema_invalid: true,
    };
  }

  const scores: FieldScore[] = [];

  // chief_complaint — fuzzy.
  scores.push({
    field: "chief_complaint",
    score: tokenSetRatio(prediction.chief_complaint, gold.chief_complaint),
  });

  // vitals — per-sub-field 0/1 averaged.
  const vitalsBreakdown = scoreVitals(prediction.vitals, gold.vitals);
  scores.push({
    field: "vitals",
    score: vitalsBreakdown.mean,
    details: vitalsBreakdown,
  });

  // medications — set F1.
  const meds = scoreMedications(prediction.medications, gold.medications);
  scores.push({
    field: "medications",
    score: meds.f1,
    precision: meds.precision,
    recall: meds.recall,
    f1: meds.f1,
    details: meds,
  });

  // diagnoses — set F1 + ICD bonus.
  const diags = scoreDiagnoses(prediction.diagnoses, gold.diagnoses);
  scores.push({
    field: "diagnoses",
    score: diags.overall,
    precision: diags.precision,
    recall: diags.recall,
    f1: diags.f1,
    details: diags,
  });

  // plan — set F1 by fuzzy match.
  const plan = scorePlan(prediction.plan, gold.plan);
  scores.push({
    field: "plan",
    score: plan.f1,
    precision: plan.precision,
    recall: plan.recall,
    f1: plan.f1,
    details: plan,
  });

  // follow_up — exact interval + fuzzy reason.
  const followUp = scoreFollowUp(prediction.follow_up, gold.follow_up);
  scores.push({
    field: "follow_up",
    score: followUp.overall,
    details: followUp,
  });

  const overall_score =
    scores.reduce((sum, s) => sum + s.score, 0) / scores.length;

  // Grounding (hallucination) check — pure function of (prediction, transcript).
  const hallucination = detectHallucinations(prediction, transcript);

  return {
    case_id: input.case_id,
    scores,
    overall_score,
    hallucinated_fields: hallucination.flagged_fields,
    schema_invalid: false,
  };
}

const FIELD_ZERO_KEYS: FieldKey[] = [
  "chief_complaint",
  "vitals",
  "medications",
  "diagnoses",
  "plan",
  "follow_up",
];

function zeroScores(): FieldScore[] {
  return FIELD_ZERO_KEYS.map((field) => ({ field, score: 0 }));
}
