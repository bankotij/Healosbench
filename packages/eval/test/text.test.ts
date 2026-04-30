import { describe, expect, test } from "bun:test";

import { fuzzyEqual, jaccard, normalize, tokenSetRatio, tokens } from "../src/text";

describe("normalize()", () => {
  test("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalize("  Sore Throat!! ")).toBe("sore throat");
    expect(normalize("Acute  Otitis,  Media")).toBe("acute otitis media");
  });

  test("expands clinical abbreviations on whole-token boundaries only", () => {
    expect(normalize("viral URI")).toBe("viral upper respiratory infection");
    expect(normalize("BID with food")).toBe("twice daily with food");
    // Abbreviations as substrings of bigger words should NOT expand.
    expect(normalize("hybrid car")).toBe("hybrid car");
  });

  test("expands q-hour patterns", () => {
    expect(normalize("Q6H PRN")).toBe("every 6 hours as needed");
    expect(normalize("q12h")).toBe("every 12 hours");
  });
});

describe("token-level helpers", () => {
  test("tokens() returns whitespace-separated, post-normalization tokens", () => {
    expect(tokens("Acute Otitis Media")).toEqual(["acute", "otitis", "media"]);
  });

  test("jaccard is order-independent and ratio-correct", () => {
    expect(jaccard("a b c", "c b a")).toBe(1);
    // intersection=2 (a,b), union=4 (a,b,c,d) → 0.5
    expect(jaccard("a b c", "a b d")).toBeCloseTo(2 / 4);
  });
});

describe("tokenSetRatio() & fuzzyEqual()", () => {
  test("identical strings score 1", () => {
    expect(tokenSetRatio("lisinopril", "lisinopril")).toBe(1);
  });

  test("totally different strings score near 0", () => {
    expect(tokenSetRatio("lisinopril", "amoxicillin")).toBeLessThan(0.3);
  });

  test("single-token typo gets credit from Levenshtein but is dragged down by Jaccard", () => {
    // 1-char typo: Jaccard=0 (no shared tokens), Levenshtein≈0.9. The
    // arithmetic mean is ~0.45 — intentionally below the 0.7-0.8 thresholds
    // used for medication / diagnosis matching. This is deliberate: a single
    // misspelled drug name should NOT auto-match in a clinical extraction.
    const score = tokenSetRatio("lisinipril", "lisinopril");
    expect(score).toBeGreaterThan(0.4);
    expect(score).toBeLessThan(0.6);
  });

  test("paraphrase-tolerant: 'viral URI' ~ 'upper respiratory infection'", () => {
    // After normalization both share most tokens.
    expect(tokenSetRatio("viral URI", "viral upper respiratory infection")).toBe(1);
  });

  test("fuzzyEqual() applies the configured threshold", () => {
    // ~0.5 similarity stays below the 0.8 default threshold.
    expect(fuzzyEqual("acute viral pharyngitis", "viral conjunctivitis")).toBe(false);
    expect(fuzzyEqual("type 2 diabetes mellitus", "T2DM")).toBe(true);
  });

  test("empty strings normalize symmetrically", () => {
    expect(tokenSetRatio("", "")).toBe(1);
    expect(tokenSetRatio("", "anything")).toBe(0);
  });
});
