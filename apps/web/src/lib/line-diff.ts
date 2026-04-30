/**
 * Tiny line-level LCS diff. Used by the prompt-diff view; not optimized for
 * gigantic inputs but plenty fast on prompts (a few thousand lines max).
 *
 * Algorithm: classic O(m·n) DP for LCS length, then a backtrack to emit a
 * sequence of {eq, del, add} ops. Side-by-side rendering pairs `del` and
 * `add` ops at the same row when possible (otherwise leaves blanks).
 */

export type DiffOp =
  | { type: "eq"; aLine: string; bLine: string }
  | { type: "del"; aLine: string }
  | { type: "add"; bLine: string };

export function diffLines(a: string, b: string): DiffOp[] {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const m = aLines.length;
  const n = bLines.length;

  // dp[i][j] = LCS length of aLines[i..] and bLines[j..]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (aLines[i] === bLines[j]) {
        dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (aLines[i] === bLines[j]) {
      ops.push({ type: "eq", aLine: aLines[i]!, bLine: bLines[j]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: "del", aLine: aLines[i]! });
      i++;
    } else {
      ops.push({ type: "add", bLine: bLines[j]! });
      j++;
    }
  }
  while (i < m) {
    ops.push({ type: "del", aLine: aLines[i]! });
    i++;
  }
  while (j < n) {
    ops.push({ type: "add", bLine: bLines[j]! });
    j++;
  }
  return ops;
}

/**
 * Pair ops into rows for side-by-side display. Adjacent del+add ops collapse
 * onto the same row (so a single line edit looks like one row, not two).
 */
export interface DiffRow {
  aLine: string | null;
  bLine: string | null;
  // "eq" if both sides identical; "mod" if both sides present but differ;
  // "del" if only A; "add" if only B.
  kind: "eq" | "mod" | "del" | "add";
}

export function pairRows(ops: DiffOp[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let i = 0;
  while (i < ops.length) {
    const op = ops[i]!;
    if (op.type === "eq") {
      rows.push({ aLine: op.aLine, bLine: op.bLine, kind: "eq" });
      i++;
      continue;
    }
    if (op.type === "del" && i + 1 < ops.length && ops[i + 1]!.type === "add") {
      const next = ops[i + 1]! as Extract<DiffOp, { type: "add" }>;
      rows.push({ aLine: op.aLine, bLine: next.bLine, kind: "mod" });
      i += 2;
      continue;
    }
    if (op.type === "del") {
      rows.push({ aLine: op.aLine, bLine: null, kind: "del" });
      i++;
      continue;
    }
    rows.push({ aLine: null, bLine: op.bLine, kind: "add" });
    i++;
  }
  return rows;
}

/** Quick stats on a diff op list — useful for headline numbers. */
export function diffStats(ops: DiffOp[]): { added: number; removed: number; equal: number } {
  let added = 0;
  let removed = 0;
  let equal = 0;
  for (const op of ops) {
    if (op.type === "add") added++;
    else if (op.type === "del") removed++;
    else equal++;
  }
  return { added, removed, equal };
}
