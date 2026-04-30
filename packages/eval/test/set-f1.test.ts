import { describe, expect, test } from "bun:test";

import { scoreDiagnoses } from "../src/diagnoses";
import { scorePlan } from "../src/plan";

const dx = (description: string, icd10?: string) =>
  icd10 ? { description, icd10 } : { description };

describe("scoreDiagnoses() — set-F1 with optional ICD bonus", () => {
  test("perfect description match without any ICD codes → F1 = 1, ICD rate = null", () => {
    const r = scoreDiagnoses(
      [dx("essential hypertension")],
      [dx("essential hypertension")],
    );
    expect(r.f1).toBe(1);
    expect(r.icd_match_rate).toBeNull();
    expect(r.overall).toBe(1);
  });

  test("paraphrase still matches when fuzzy ratio ≥ 0.7", () => {
    // "viral URI" expands via abbreviations → identical to gold after normalize.
    const r = scoreDiagnoses(
      [dx("viral URI")],
      [dx("viral upper respiratory infection")],
    );
    expect(r.f1).toBe(1);
  });

  test("subset match: pred description is a strict subset of gold's tokens (lost modifier)", () => {
    // Real case_011: gold "chronic constipation", pred "constipation".
    // Used to score 0.0 (Jaccard 0.5, below 0.7 threshold). Now gets credit
    // because pred's tokens are a strict subset of gold's. The dashboard
    // still surfaces the lower desc_score so the modifier loss is visible.
    const r = scoreDiagnoses([dx("constipation")], [dx("chronic constipation")]);
    expect(r.f1).toBe(1);
    expect(r.matches[0]!.desc_score).toBe(0.85);
  });

  test("subset match: pred description ADDS a modifier the gold didn't have", () => {
    // Symmetric — model added "acute". Same reasoning.
    const r = scoreDiagnoses([dx("acute pharyngitis")], [dx("pharyngitis")]);
    expect(r.f1).toBe(1);
    expect(r.matches[0]!.desc_score).toBe(0.85);
  });

  test("subset match does NOT trigger when token sets are equal-size and disagree", () => {
    // "diabetes" vs "asthma" — different conditions, must not match.
    const r = scoreDiagnoses([dx("asthma")], [dx("diabetes")]);
    expect(r.f1).toBe(0);
  });

  test("ICD bonus rewards a correct code on top of a description match", () => {
    const r = scoreDiagnoses(
      [dx("essential hypertension", "I10")],
      [dx("essential hypertension", "I10")],
    );
    expect(r.f1).toBe(1);
    expect(r.icd_match_rate).toBe(1);
    // Bonus is capped — overall stays at 1.
    expect(r.overall).toBe(1);
  });

  test("wrong ICD code does NOT push overall above F1", () => {
    const r = scoreDiagnoses(
      [dx("essential hypertension", "E11.9")],
      [dx("essential hypertension", "I10")],
    );
    expect(r.f1).toBe(1);
    expect(r.icd_match_rate).toBe(0);
    expect(r.overall).toBe(1); // F1 already maxed; bonus adds zero
  });

  test("extra prediction creates a false positive (precision drops)", () => {
    const r = scoreDiagnoses(
      [dx("essential hypertension"), dx("type 2 diabetes mellitus")],
      [dx("essential hypertension")],
    );
    expect(r.precision).toBe(0.5);
    expect(r.recall).toBe(1);
    expect(r.f1).toBeCloseTo(2 / 3);
  });

  test("missing prediction creates a false negative (recall drops)", () => {
    const r = scoreDiagnoses(
      [dx("essential hypertension")],
      [dx("essential hypertension"), dx("type 2 diabetes mellitus")],
    );
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(0.5);
    expect(r.f1).toBeCloseTo(2 / 3);
  });

  test("both empty → perfect (correct abstention)", () => {
    expect(scoreDiagnoses([], []).overall).toBe(1);
  });
});

describe("scorePlan() — fuzzy set-F1 over plan items", () => {
  test("identical items → F1 = 1", () => {
    const r = scorePlan(
      ["start lisinopril 10 mg daily", "schedule labs in 2 weeks"],
      ["start lisinopril 10 mg daily", "schedule labs in 2 weeks"],
    );
    expect(r.f1).toBe(1);
  });

  test("paraphrase within 0.65 threshold still matches", () => {
    const r = scorePlan(
      ["return if symptoms worsen"],
      ["return if symptoms get worse"],
    );
    expect(r.f1).toBe(1);
  });

  test("greedy match takes the best pair when multiple exceed threshold", () => {
    const r = scorePlan(
      ["start metformin 500 mg twice daily", "follow up in 3 months"],
      ["start metformin 500 mg twice daily", "follow up in 3 months"],
    );
    expect(r.matches.length).toBe(2);
    expect(r.f1).toBe(1);
  });

  test("extras / misses behave like medications", () => {
    const r = scorePlan(
      ["start lisinopril 10 mg daily", "extra unrelated thing"],
      ["start lisinopril 10 mg daily"],
    );
    expect(r.precision).toBe(0.5);
    expect(r.recall).toBe(1);
    expect(r.f1).toBeCloseTo(2 / 3);
  });
});
