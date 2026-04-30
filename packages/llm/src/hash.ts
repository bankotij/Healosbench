import { createHash } from "node:crypto";

/**
 * Stable canonical JSON: keys sorted recursively, no whitespace. Two values
 * that are deeply equal serialize to identical strings, so hashing is stable.
 */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJSON).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts: string[] = [];
  for (const k of keys) {
    parts.push(
      `${JSON.stringify(k)}:${canonicalJSON(
        (value as Record<string, unknown>)[k],
      )}`,
    );
  }
  return `{${parts.join(",")}}`;
}

/**
 * Content hash for a prompt. Inputs that affect model behavior — system text,
 * tool definition, few-shot examples, strategy id — all flow into the hash so
 * "prompt v6" is unambiguous and reproducible. Anything that doesn't affect
 * behavior (timestamps, IDs, the live transcript) is excluded.
 */
export function promptHash(input: {
  strategy: string;
  system: string;
  tool: unknown;
  few_shot?: unknown;
}): string {
  const canonical = canonicalJSON({
    strategy: input.strategy,
    system: input.system,
    tool: input.tool,
    few_shot: input.few_shot ?? null,
  });
  return createHash("sha256").update(canonical).digest("hex");
}
