import { describe, expect, test } from "bun:test";

// Use a relative path so this test runs from the workspace root via
// `bun test apps/web` without depending on the Next.js `@/` alias resolution.
import { diffLines, diffStats, pairRows } from "../src/lib/line-diff";

describe("diffLines() — line-level LCS", () => {
  test("identical inputs produce all-equal ops", () => {
    const ops = diffLines("a\nb\nc", "a\nb\nc");
    expect(ops.every((o) => o.type === "eq")).toBe(true);
    expect(diffStats(ops)).toEqual({ added: 0, removed: 0, equal: 3 });
  });

  test("single-line edit shows as one mod row, not two", () => {
    const ops = diffLines("alpha\nbeta\ngamma", "alpha\nBETA\ngamma");
    const rows = pairRows(ops);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual({ aLine: "beta", bLine: "BETA", kind: "mod" });
  });

  test("inserted line shows as add, no spurious del", () => {
    const ops = diffLines("a\nc", "a\nb\nc");
    const stats = diffStats(ops);
    expect(stats.added).toBe(1);
    expect(stats.removed).toBe(0);
    expect(stats.equal).toBe(2);
  });

  test("deleted line shows as del, no spurious add", () => {
    const ops = diffLines("a\nb\nc", "a\nc");
    const stats = diffStats(ops);
    expect(stats.added).toBe(0);
    expect(stats.removed).toBe(1);
    expect(stats.equal).toBe(2);
  });

  test("totally different inputs only share 0 lines", () => {
    const ops = diffLines("alpha\nbeta", "gamma\ndelta");
    const stats = diffStats(ops);
    expect(stats.equal).toBe(0);
    expect(stats.added).toBe(2);
    expect(stats.removed).toBe(2);
  });
});
