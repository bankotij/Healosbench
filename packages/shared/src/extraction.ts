import { z } from "zod";

// Mirrors `data/schema.json` (the JSON Schema in the assignment) one-to-one.
// We hand-mirror it as Zod so we get a single source of truth for both runtime
// validation (predicted JSON from the LLM) and TS types across server & web.
//
// IMPORTANT: this file MUST stay in lock-step with data/schema.json. Do NOT
// change semantics here; if the JSON Schema changes (it shouldn't — the
// README forbids modifying it), update this mirror to match.

export const BloodPressureSchema = z
  .string()
  .regex(/^[0-9]{2,3}\/[0-9]{2,3}$/, {
    message: 'bp must look like "128/82"',
  })
  .nullable();

export const VitalsSchema = z
  .object({
    bp: BloodPressureSchema,
    hr: z.number().int().min(20).max(250).nullable(),
    temp_f: z.number().min(90).max(110).nullable(),
    spo2: z.number().int().min(50).max(100).nullable(),
  })
  .strict();

export const MedicationSchema = z
  .object({
    name: z.string().min(1),
    dose: z.string().nullable(),
    frequency: z.string().nullable(),
    route: z.string().nullable(),
  })
  .strict();

export const DiagnosisSchema = z
  .object({
    description: z.string().min(1),
    icd10: z
      .string()
      .regex(/^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/, {
        message: 'icd10 must look like "J06.9" or "E11.9"',
      })
      .optional(),
  })
  .strict();

export const FollowUpSchema = z
  .object({
    interval_days: z.number().int().min(0).max(730).nullable(),
    reason: z.string().nullable(),
  })
  .strict();

export const ExtractionSchema = z
  .object({
    chief_complaint: z.string().min(1),
    vitals: VitalsSchema,
    medications: z.array(MedicationSchema),
    diagnoses: z.array(DiagnosisSchema),
    plan: z.array(z.string().min(1)),
    follow_up: FollowUpSchema,
  })
  .strict();

export type BloodPressure = z.infer<typeof BloodPressureSchema>;
export type Vitals = z.infer<typeof VitalsSchema>;
export type Medication = z.infer<typeof MedicationSchema>;
export type Diagnosis = z.infer<typeof DiagnosisSchema>;
export type FollowUp = z.infer<typeof FollowUpSchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;

// The set of top-level field keys, in the order they should be displayed.
export const FIELD_KEYS = [
  "chief_complaint",
  "vitals",
  "medications",
  "diagnoses",
  "plan",
  "follow_up",
] as const;

export type FieldKey = (typeof FIELD_KEYS)[number];

/**
 * Validate raw JSON against the extraction schema. Returns either the parsed
 * object or a structured list of errors suitable for feeding back to the LLM
 * during the retry-with-feedback loop.
 */
export function validateExtraction(input: unknown):
  | { ok: true; value: Extraction }
  | { ok: false; errors: ValidationError[] } {
  const parsed = ExtractionSchema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, errors: zodIssuesToErrors(parsed.error.issues) };
}

export interface ValidationError {
  /** JSON Pointer-ish path, e.g. "vitals.hr" or "medications[0].dose". */
  path: string;
  message: string;
  code: string;
}

function zodIssuesToErrors(issues: z.ZodIssue[]): ValidationError[] {
  return issues.map((i) => ({
    path: pathToString(i.path),
    message: i.message,
    code: i.code,
  }));
}

function pathToString(path: ReadonlyArray<PropertyKey>): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else out += out.length === 0 ? String(seg) : `.${String(seg)}`;
  }
  return out || "(root)";
}
