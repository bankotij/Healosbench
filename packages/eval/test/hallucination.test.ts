import { describe, expect, test } from "bun:test";

import { detectHallucinations } from "../src/hallucination";
import type { Extraction } from "@healosbench/shared";

const TRANSCRIPT = `Doctor: Good morning. What brings you in?
Patient: I've had a sore throat for four days, with low-grade fever.
Doctor: Any cough?
Patient: A bit. Mostly dry.
[Vitals at intake: BP 124/78, HR 84, Temp 100.2 F, SpO2 98%]
Doctor: I'll start you on ibuprofen 400 mg every six hours for pain. Drink fluids and rest.
Doctor: Supportive care for now. Return if symptoms are not improving in seven days.
`;

const baseExtraction = (overrides: Partial<Extraction> = {}): Extraction => ({
  chief_complaint: "sore throat for four days with low-grade fever",
  vitals: { bp: "124/78", hr: 84, temp_f: 100.2, spo2: 98 },
  medications: [{ name: "ibuprofen", dose: "400 mg", frequency: "every 6 hours", route: "PO" }],
  diagnoses: [{ description: "acute viral pharyngitis", icd10: "J02.9" }],
  plan: ["start ibuprofen 400 mg every 6 hours", "supportive care with fluids"],
  follow_up: { interval_days: 7, reason: "return if not improving" },
  ...overrides,
});

describe("detectHallucinations() — well-grounded extraction", () => {
  test("a faithful extraction produces zero flags", () => {
    const r = detectHallucinations(baseExtraction(), TRANSCRIPT);
    expect(r.flagged_values).toHaveLength(0);
    expect(r.flagged_fields).toHaveLength(0);
  });

  test("paraphrase that shares stems is still grounded", () => {
    // "improving" / "worse" share stems with the transcript's "better"
    // counterpart — but here we test a paraphrase the transcript does
    // contain semantically. The exact fluent paraphrase "throat pain for
    // about four days with mild fever" should ground via tokens.
    const r = detectHallucinations(
      baseExtraction({
        chief_complaint: "sore throat for four days with mild fever",
      }),
      TRANSCRIPT,
    );
    expect(r.flagged_fields).not.toContain("chief_complaint");
  });
});

describe("detectHallucinations() — fabrications", () => {
  test("a fabricated medication name is flagged", () => {
    const r = detectHallucinations(
      baseExtraction({
        medications: [
          { name: "fictionixol", dose: "400 mg", frequency: "every 6 hours", route: "PO" },
        ],
      }),
      TRANSCRIPT,
    );
    expect(r.flagged_fields).toContain("medications[0].name");
  });

  test("a fabricated dose is flagged even when the unit token is in the transcript", () => {
    // "500 mg" — the unit "mg" appears in the transcript ("400 mg") but the
    // numeric value "500" does not. Stopword-list excludes "mg" so coverage
    // for the value drops below threshold.
    const r = detectHallucinations(
      baseExtraction({
        medications: [
          { name: "ibuprofen", dose: "500 mg", frequency: "every 6 hours", route: "PO" },
        ],
      }),
      TRANSCRIPT,
    );
    expect(r.flagged_fields).toContain("medications[0].dose");
  });

  test("a vital that wasn't measured is flagged", () => {
    const r = detectHallucinations(
      baseExtraction({
        vitals: { bp: "124/78", hr: 84, temp_f: 100.2, spo2: 92 }, // 92 not in transcript
      }),
      TRANSCRIPT,
    );
    expect(r.flagged_fields).toContain("vitals.spo2");
    expect(r.flagged_fields).not.toContain("vitals.hr");
  });

  test("a fabricated plan item with no transcript support is flagged", () => {
    const r = detectHallucinations(
      baseExtraction({
        plan: ["start albuterol nebulizer treatments"],
      }),
      TRANSCRIPT,
    );
    expect(r.flagged_fields).toContain("plan[0]");
  });

  test("diagnosis descriptions are explicitly NOT grounded (clinical inference)", () => {
    // The transcript never says "pharyngitis" verbatim, but the diagnosis
    // is a legitimate clinical inference. Diagnosis descriptions are
    // excluded from grounding by design.
    const r = detectHallucinations(
      baseExtraction({
        diagnoses: [{ description: "atypical pneumonia from extraterrestrial pathogen" }],
      }),
      TRANSCRIPT,
    );
    expect(r.flagged_values.find((v) => v.field.startsWith("diagnoses"))).toBeUndefined();
  });
});
