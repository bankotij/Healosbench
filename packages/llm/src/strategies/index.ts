import type { Strategy } from "@healosbench/shared";

import { cotStrategy } from "./cot";
import { fewShotStrategy } from "./few_shot";
import { zeroShotStrategy } from "./zero_shot";
import type { PromptStrategy } from "./types";

export const STRATEGY_REGISTRY: Record<Strategy, PromptStrategy> = {
  zero_shot: zeroShotStrategy,
  few_shot: fewShotStrategy,
  cot: cotStrategy,
};

export function getStrategy(id: Strategy): PromptStrategy {
  const s = STRATEGY_REGISTRY[id];
  if (!s) {
    const valid = Object.keys(STRATEGY_REGISTRY).join(", ");
    throw new Error(`Unknown strategy: ${id}. Valid: ${valid}`);
  }
  return s;
}

export type { PromptStrategy } from "./types";
