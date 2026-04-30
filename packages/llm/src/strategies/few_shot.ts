import { ROLE, SAFETY_RULES, FORMAT_HINT } from "../prompts/base";
import { FEW_SHOT_EXAMPLES } from "../prompts/few_shot_examples";
import { EXTRACT_TOOL, EXTRACT_TOOL_NAME } from "../tool";

import type { PromptMessage, PromptStrategy } from "./types";

const FRAMING = `Below are three worked examples that show the expected calling pattern. \
Then a new transcript follows. Apply the same rules to the new transcript and call \
the \`record_extraction\` tool exactly once.`;

export const fewShotStrategy: PromptStrategy = {
  id: "few_shot",
  tool: EXTRACT_TOOL,
  buildSystem() {
    return [ROLE, SAFETY_RULES, FRAMING, FORMAT_HINT].join("\n\n");
  },
  buildPrefixMessages() {
    const messages: PromptMessage[] = [];
    let i = 0;
    for (const ex of FEW_SHOT_EXAMPLES) {
      const toolUseId = `toolu_example_${i++}`;
      messages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: `Example transcript:\n\n${ex.transcript}`,
          },
        ],
      });
      messages.push({
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: toolUseId,
            name: EXTRACT_TOOL_NAME,
            input: ex.extraction,
          },
        ],
      });
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUseId,
            content: "Recorded.",
          },
        ],
      });
    }
    return messages;
  },
  hashExtras() {
    // Bake the example IDs into the hash so editing examples bumps the hash.
    return { few_shot_ids: FEW_SHOT_EXAMPLES.map((e) => e.id) };
  },
};
