import { ROLE, SAFETY_RULES, FORMAT_HINT } from "../prompts/base";
import { EXTRACT_TOOL } from "../tool";

import { defaultUserMessage } from "./types";
import type { PromptMessage, PromptStrategy } from "./types";

const COT_INSTRUCTIONS = `Before calling the tool, work through the transcript explicitly:

1. Identify the chief complaint in the patient's own words or as a brief clinical summary.
2. Scan for vitals — write them out (BP, HR, temperature, SpO2). For any vital that was not measured or stated, mark it as null.
3. List every medication mentioned. For each, name the drug, dose if given, frequency if given, and route if given. Use null for any subfield not stated. Note whether it's existing/started/stopped/changed.
4. List diagnoses, separating ones the clinician confirmed today from ones merely on the patient's history. Only emit ICD-10 codes you're highly confident about.
5. List plan items as discrete actions, not paragraphs.
6. Determine the follow-up interval — null if no concrete number of days was given.

Then, and only then, call the \`record_extraction\` tool with the structured payload.`;

export const cotStrategy: PromptStrategy = {
  id: "cot",
  tool: EXTRACT_TOOL,
  buildSystem() {
    return [ROLE, SAFETY_RULES, COT_INSTRUCTIONS, FORMAT_HINT].join("\n\n");
  },
  buildPrefixMessages() {
    return [];
  },
  buildUserMessage(transcript: string): PromptMessage {
    // For CoT we reinforce the "think first, then call the tool" pattern in
    // the user-turn framing too, so the model lands on the right shape even
    // for shorter transcripts where it might otherwise skip the reasoning.
    return {
      role: "user",
      content: [
        {
          type: "text",
          text: `Transcript:\n\n${transcript}\n\nWork through the six steps in your reasoning, then call the \`record_extraction\` tool.`,
        },
      ],
    };
  },
};

export { defaultUserMessage };
