import { describe, expect, test } from "bun:test";

import { canonicalJSON, promptHash } from "../src/hash";

describe("canonicalJSON()", () => {
  test("sorts object keys recursively", () => {
    const a = canonicalJSON({ b: 1, a: 2 });
    const b = canonicalJSON({ a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1}');
  });

  test("preserves array order (arrays are ordered, not sets)", () => {
    expect(canonicalJSON([1, 2, 3])).not.toBe(canonicalJSON([3, 2, 1]));
  });

  test("handles nested structures and primitive types", () => {
    const v = { z: { y: [1, { x: 1, w: 2 }] }, a: null };
    expect(canonicalJSON(v)).toBe('{"a":null,"z":{"y":[1,{"w":2,"x":1}]}}');
  });
});

describe("promptHash() — stability properties", () => {
  const tool = { name: "record_extraction", input_schema: { type: "object" } };

  test("same inputs in different key orders produce the same hash", () => {
    const h1 = promptHash({
      strategy: "zero_shot",
      system: "You are a careful assistant.",
      tool,
    });
    const h2 = promptHash({
      tool,
      system: "You are a careful assistant.",
      strategy: "zero_shot",
    });
    expect(h1).toBe(h2);
  });

  test("changing system text changes the hash", () => {
    const h1 = promptHash({
      strategy: "zero_shot",
      system: "Prompt v6",
      tool,
    });
    const h2 = promptHash({
      strategy: "zero_shot",
      system: "Prompt v7",
      tool,
    });
    expect(h1).not.toBe(h2);
  });

  test("changing few_shot examples changes the hash", () => {
    const h1 = promptHash({
      strategy: "few_shot",
      system: "X",
      tool,
      few_shot: ["ex1", "ex2", "ex3"],
    });
    const h2 = promptHash({
      strategy: "few_shot",
      system: "X",
      tool,
      few_shot: ["ex1", "ex2", "ex4"], // ex3 → ex4
    });
    expect(h1).not.toBe(h2);
  });

  test("absent vs explicit-null few_shot are equivalent", () => {
    const h1 = promptHash({ strategy: "zero_shot", system: "X", tool });
    const h2 = promptHash({ strategy: "zero_shot", system: "X", tool, few_shot: null });
    expect(h1).toBe(h2);
  });

  test("hash is a 64-char hex string (sha256)", () => {
    const h = promptHash({ strategy: "zero_shot", system: "X", tool });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  test("whitespace differences in system text DO change the hash", () => {
    // We don't normalize whitespace inside the system text — the model can
    // see it, so it's part of the prompt's identity.
    const h1 = promptHash({ strategy: "zero_shot", system: "X Y", tool });
    const h2 = promptHash({ strategy: "zero_shot", system: "X  Y", tool });
    expect(h1).not.toBe(h2);
  });
});
