import type { Extraction } from "@test-evals/shared";

/**
 * Held-out, synthetic few-shot examples. None of these are in the dataset
 * `data/transcripts` — they're written specifically for this prompt so they
 * can't leak gold information into the eval. Three examples = enough coverage
 * for the common shapes (acute infection, chronic-meds adjustment, normal
 * vitals + plan-only) without bloating the cache footprint.
 *
 * Each example is a (transcript, extraction) pair the strategy renders into
 * the message stream as a `user` → `assistant` (tool_use) → `user` (tool_result)
 * pattern, which is the format Anthropic expects to see for tool-using
 * conversations.
 */

export interface FewShotExample {
  id: string;
  transcript: string;
  extraction: Extraction;
}

export const FEW_SHOT_EXAMPLES: ReadonlyArray<FewShotExample> = [
  {
    id: "example_a_uri",
    transcript: `Doctor: What brings you in today?
Patient: I've had a sore throat and runny nose since Saturday, so about three days. No fever that I've measured at home.
Doctor: Any cough, ear pain, or trouble swallowing?
Patient: A little dry cough at night. Swallowing's fine.
Doctor: Let me take a look. Vitals up front were 118 over 76, pulse 84, temp 99.1, oxygen 99 percent on room air. Throat is mildly erythematous, no exudate. Ears clear, no lymphadenopathy.
Doctor: This looks like a typical viral cold. I'll have you do saline rinses and Tylenol 500 milligrams every six hours as needed for the throat pain. No antibiotic — it's not strep.
Patient: How long until I feel better?
Doctor: Usually seven to ten days. Come back if you spike a fever above 102 or it's not improving by day ten.`,
    extraction: {
      chief_complaint: "sore throat and runny nose for three days",
      vitals: { bp: "118/76", hr: 84, temp_f: 99.1, spo2: 99 },
      medications: [
        {
          name: "acetaminophen",
          dose: "500 mg",
          frequency: "every 6 hours as needed",
          route: "PO",
        },
      ],
      diagnoses: [
        { description: "viral upper respiratory infection", icd10: "J06.9" },
      ],
      plan: [
        "saline nasal rinses",
        "acetaminophen 500 mg every 6 hours as needed for sore throat",
        "no antibiotic indicated",
      ],
      follow_up: {
        interval_days: null,
        reason: "return if fever above 102 or no improvement by day 10",
      },
    },
  },
  {
    id: "example_b_htn",
    transcript: `Doctor: How have your home blood pressures been since we increased the lisinopril last visit?
Patient: Mostly running 145 to 150 over 90. Still high.
Doctor: Today you're 148 over 92, pulse 72, no temperature today, oxygen 98.
Patient: I've been taking the lisinopril every morning, 20 milligrams now. No cough, no swelling.
Doctor: Let's add amlodipine 5 milligrams once daily. Keep the lisinopril where it is. Recheck home pressures twice a day for two weeks.
Patient: When should I follow up?
Doctor: Two weeks. If anything is over 160 systolic or you feel lightheaded, call sooner.`,
    extraction: {
      chief_complaint: "follow-up for uncontrolled hypertension",
      vitals: { bp: "148/92", hr: 72, temp_f: null, spo2: 98 },
      medications: [
        {
          name: "lisinopril",
          dose: "20 mg",
          frequency: "once daily",
          route: "PO",
        },
        {
          name: "amlodipine",
          dose: "5 mg",
          frequency: "once daily",
          route: "PO",
        },
      ],
      diagnoses: [
        {
          description: "essential hypertension, uncontrolled",
          icd10: "I10",
        },
      ],
      plan: [
        "add amlodipine 5 mg once daily",
        "continue lisinopril 20 mg once daily",
        "home blood-pressure log twice daily for two weeks",
        "call if systolic over 160 or lightheaded",
      ],
      follow_up: {
        interval_days: 14,
        reason: "blood-pressure recheck",
      },
    },
  },
  {
    id: "example_c_routine",
    transcript: `Doctor: This is your annual physical. Anything bothering you today?
Patient: No, I feel fine. Just here for the check-up.
Doctor: Vitals look good — 122 over 78, pulse 66, no fever, oxygen 100. Exam is unremarkable.
Doctor: Your labs from last week were all in range. We'll keep you on the multivitamin you're already taking. Let's plan to see you in a year unless something comes up.`,
    extraction: {
      chief_complaint: "annual physical exam",
      vitals: { bp: "122/78", hr: 66, temp_f: null, spo2: 100 },
      medications: [
        {
          name: "multivitamin",
          dose: null,
          frequency: "daily",
          route: "PO",
        },
      ],
      diagnoses: [{ description: "routine adult health examination" }],
      plan: ["continue current multivitamin", "annual follow-up"],
      follow_up: { interval_days: 365, reason: "annual physical" },
    },
  },
];
