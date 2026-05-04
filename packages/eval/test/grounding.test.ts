import { describe, expect, test } from "bun:test";

import { findGroundingSpans } from "../src/grounding";

import type { Extraction } from "@healosbench/shared";

const blank: Extraction = {
  chief_complaint: "",
  vitals: { bp: null, hr: null, temp_f: null, spo2: null },
  medications: [],
  diagnoses: [],
  plan: [],
  follow_up: { interval_days: null, reason: null },
};

function withChief(s: string): Extraction {
  return { ...blank, chief_complaint: s };
}

describe("findGroundingSpans()", () => {
  test("returns no spans when prediction is null or transcript empty", () => {
    expect(findGroundingSpans(null, "anything")).toEqual([]);
    expect(findGroundingSpans(withChief("foo"), "")).toEqual([]);
  });

  test("exact match: full predicted phrase appears verbatim in the transcript", () => {
    const transcript = "Patient reports sore throat for 4 days.";
    const pred = withChief("sore throat for 4 days");
    const spans = findGroundingSpans(pred, transcript);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.match).toBe("exact");
    expect(spans[0]!.fields).toContain("chief_complaint");
    expect(transcript.slice(spans[0]!.start, spans[0]!.end).toLowerCase()).toBe(
      "sore throat for 4 days",
    );
  });

  test("partial match: the whole phrase isn't in the transcript but content tokens are", () => {
    const transcript = "I've been so constipated for a couple months.";
    // Prediction adds "chronic" — the whole phrase doesn't appear, but
    // "constipated" / "couple" / "months" do as content tokens.
    const pred = withChief("chronic constipation for a couple of months");
    const spans = findGroundingSpans(pred, transcript);
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.every((s) => s.match === "partial")).toBe(true);
  });

  test("no match: nothing in the transcript supports the prediction", () => {
    const transcript = "Patient has bilateral knee pain.";
    const pred = withChief("acute respiratory distress");
    const spans = findGroundingSpans(pred, transcript);
    // "respiratory" / "distress" — neither in the transcript. "acute" is a
    // 5-char content token but not in transcript either. "bilateral" / "knee"
    // / "pain" are in transcript but not in the value. → no spans.
    expect(spans).toEqual([]);
  });

  test("vitals: numeric values are matched as raw substrings", () => {
    const transcript = "Vitals: BP 120/80, HR 72, T 98.6, SpO2 98%.";
    const pred: Extraction = {
      ...blank,
      vitals: { bp: "120/80", hr: 72, temp_f: 98.6, spo2: 98 },
    };
    const spans = findGroundingSpans(pred, transcript);
    // All four vitals should ground.
    const allFields = spans.flatMap((s) => s.fields);
    expect(allFields).toContain("vitals.bp");
    expect(allFields).toContain("vitals.hr");
    expect(allFields).toContain("vitals.temp_f");
    expect(allFields).toContain("vitals.spo2");
  });

  test("medications: name + dose are searched, frequency / route are NOT", () => {
    // Frequency "every 8 hours" appears in the transcript, but our policy
    // says we don't ground frequency (vocabulary too small). The name
    // "amoxicillin" and dose "500 mg" should ground; the freq should not
    // produce its own span.
    const transcript = "Start amoxicillin 500 mg every 8 hours.";
    const pred: Extraction = {
      ...blank,
      medications: [
        { name: "amoxicillin", dose: "500 mg", frequency: "every 8 hours", route: "PO" },
      ],
    };
    const spans = findGroundingSpans(pred, transcript);
    const fields = spans.flatMap((s) => s.fields);
    expect(fields).toContain("medications[0].name");
    expect(fields).toContain("medications[0].dose");
    expect(fields).not.toContain("medications[0].frequency");
    expect(fields).not.toContain("medications[0].route");
  });

  test("diagnoses are intentionally NOT grounded (clinical inference)", () => {
    // The lay term "stomach pain" is in the transcript and the formal
    // diagnosis "gastritis" isn't — but even if it were, our policy is to
    // skip diagnoses entirely.
    const transcript = "Patient reports stomach pain after meals.";
    const pred: Extraction = {
      ...blank,
      diagnoses: [{ description: "gastritis", icd10: "K29.70" }],
    };
    const spans = findGroundingSpans(pred, transcript);
    const fields = spans.flatMap((s) => s.fields);
    expect(fields.every((f) => !f.startsWith("diagnoses"))).toBe(true);
  });

  test("overlapping spans merge with exact winning over partial", () => {
    // Same phrase matches both chief_complaint (exact) and a plan item
    // (token "headache" overlaps inside the chief_complaint span).
    const transcript = "Patient has headache for 2 days.";
    const pred: Extraction = {
      ...blank,
      chief_complaint: "headache for 2 days",
      plan: ["address headache with hydration"],
    };
    const spans = findGroundingSpans(pred, transcript);
    // The headache range is covered by the exact chief_complaint span;
    // merging should leave a single exact-match span on the overlap.
    const exactSpans = spans.filter((s) => s.match === "exact");
    expect(exactSpans.length).toBeGreaterThanOrEqual(1);
    // A merged span lists both fields it supports.
    const fields = spans.flatMap((s) => s.fields);
    expect(fields).toContain("chief_complaint");
  });

  test("spans are sorted by start index", () => {
    const transcript = "Headache, fever, and nausea reported today.";
    const pred: Extraction = {
      ...blank,
      plan: ["nausea management", "fever workup", "headache assessment"],
    };
    const spans = findGroundingSpans(pred, transcript);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]!.start).toBeGreaterThanOrEqual(spans[i - 1]!.start);
    }
  });

  test("very short values don't ground (avoids 'i' / 'a' pathology)", () => {
    // chief_complaint is too short — should be skipped entirely.
    const transcript = "abc def ghi";
    const pred = withChief("ab");
    expect(findGroundingSpans(pred, transcript)).toEqual([]);
  });
});
