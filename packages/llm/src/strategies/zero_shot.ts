import { ROLE, SAFETY_RULES, FIELD_GUIDANCE, FORMAT_HINT } from "../prompts/base";
import { EXTRACT_TOOL } from "../tool";

import type { PromptStrategy } from "./types";

export const zeroShotStrategy: PromptStrategy = {
  id: "zero_shot",
  tool: EXTRACT_TOOL,
  buildSystem() {
    return [ROLE, SAFETY_RULES, FIELD_GUIDANCE, FORMAT_HINT].join("\n\n");
  },
  buildPrefixMessages() {
    return [];
  },
};
