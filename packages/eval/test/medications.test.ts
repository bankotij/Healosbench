import { describe, expect, test } from "bun:test";

import {
  normalizeDose,
  normalizeFrequency,
  normalizeRoute,
  scoreMedications,
} from "../src/medications";

const med = (
  name: string,
  dose: string | null,
  frequency: string | null,
  route: string | null = null,
) => ({ name, dose, frequency, route });

describe("normalizeDose()", () => {
  test("collapses whitespace and lowercases the unit", () => {
    expect(normalizeDose("10 mg")).toBe("10mg");
    expect(normalizeDose("10MG")).toBe("10mg");
    expect(normalizeDose(" 400  mg ")).toBe("400mg");
  });

  test("converts sub-1mg → mcg when integer-clean", () => {
    expect(normalizeDose("0.5 mg")).toBe("500mcg");
    expect(normalizeDose("0.025 mg")).toBe("25mcg");
  });

  test("keeps unparseable strings as their normalized form", () => {
    expect(normalizeDose("low dose")).toBe("low dose");
    expect(normalizeDose(null)).toBeNull();
  });
});

describe("normalizeFrequency()", () => {
  test("canonicalizes Latin-derived abbreviations", () => {
    expect(normalizeFrequency("BID")).toBe("every 12 hours");
    expect(normalizeFrequency("twice daily")).toBe("every 12 hours");
    expect(normalizeFrequency("Q6H")).toBe("every 6 hours");
    expect(normalizeFrequency("once daily in the morning")).toBe("once daily");
  });

  test("preserves PRN qualifier when combined with cadence", () => {
    expect(normalizeFrequency("every 6 hours as needed")).toBe("every 6 hours as needed");
    expect(normalizeFrequency("Q6H PRN")).toBe("every 6 hours as needed");
  });

  test("PRN alone canonicalizes to 'as needed'", () => {
    expect(normalizeFrequency("PRN")).toBe("as needed");
    expect(normalizeFrequency("when needed")).toBe("as needed");
  });
});

describe("normalizeRoute()", () => {
  test("maps abbreviations to long form", () => {
    expect(normalizeRoute("PO")).toBe("oral");
    expect(normalizeRoute("by mouth")).toBe("oral");
    expect(normalizeRoute("IV")).toBe("intravenous");
    expect(normalizeRoute("nebulized")).toBe("inhaled");
  });
});

describe("scoreMedications() — set-F1 with fuzzy name + canonical dose/freq", () => {
  test("perfect match → P=R=F1=1", () => {
    const pred = [med("lisinopril", "10 mg", "once daily")];
    const gold = [med("lisinopril", "10mg", "QD")];
    const r = scoreMedications(pred, gold);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(1);
    expect(r.f1).toBe(1);
  });

  test("token-overlap drug name (e.g. 'amoxicillin clavulanate' ~ 'amoxicillin/clavulanate') matches", () => {
    const pred = [med("amoxicillin clavulanate", "875 mg", "twice daily")];
    const gold = [med("amoxicillin/clavulanate", "875mg", "BID")];
    expect(scoreMedications(pred, gold).f1).toBe(1);
  });

  test("single-character typo on a single-token name does NOT auto-match (by design)", () => {
    // Conservative: a 1-char typo on a drug name is an extraction error
    // worth flagging, not absorbing.
    const pred = [med("lisinipril", "10 mg", "once daily")];
    const gold = [med("lisinopril", "10mg", "QD")];
    expect(scoreMedications(pred, gold).f1).toBe(0);
  });

  test("dose mismatch creates a true negative (no match)", () => {
    const pred = [med("lisinopril", "5 mg", "once daily")];
    const gold = [med("lisinopril", "10 mg", "once daily")];
    const r = scoreMedications(pred, gold);
    expect(r.f1).toBe(0);
    expect(r.unmatched_pred).toEqual([0]);
    expect(r.unmatched_gold).toEqual([0]);
  });

  test("frequency mismatch creates a true negative", () => {
    const pred = [med("metformin", "500 mg", "twice daily")];
    const gold = [med("metformin", "500 mg", "three times daily")];
    expect(scoreMedications(pred, gold).f1).toBe(0);
  });

  test("set-F1 over multiple meds with one extra and one missing", () => {
    const pred = [
      med("lisinopril", "10 mg", "once daily"), // tp
      med("amoxicillin", "500 mg", "three times daily"), // fp
    ];
    const gold = [
      med("lisinopril", "10 mg", "once daily"), // tp
      med("metformin", "500 mg", "twice daily"), // fn
    ];
    const r = scoreMedications(pred, gold);
    expect(r.precision).toBe(0.5);
    expect(r.recall).toBe(0.5);
    expect(r.f1).toBe(0.5);
  });

  test("both empty arrays → perfect F1 (correct abstention)", () => {
    const r = scoreMedications([], []);
    expect(r.f1).toBe(1);
  });
});
