import {
  ZERO_USAGE,
  addUsage,
  type Extraction,
  type LLMAttempt,
  type Strategy,
  type TokenUsage,
  validateExtraction,
} from "@healosbench/shared";

import { callAnthropic, type AnthropicCallOutput } from "./client";
import { promptHash } from "./hash";
import { costUsd } from "./pricing";
import { buildValidationFeedback } from "./prompts/base";
import { getStrategy } from "./strategies/index";
import { defaultUserMessage } from "./strategies/types";
import type { PromptMessage } from "./strategies/types";
import { EXTRACT_TOOL_NAME } from "./tool";

export interface ExtractInput {
  transcript: string;
  strategy: Strategy;
  model: string;
  apiKey: string;
  /** Cap on attempts including the initial one. README mandates 3. */
  maxAttempts?: number;
  /** Override the cache control switch (tests). */
  enableCache?: boolean;
  /** Override the underlying call (tests — mock the SDK). */
  call?: typeof callAnthropic;
}

export interface ExtractOutput {
  /** Final validated prediction; null if all attempts failed validation. */
  prediction: Extraction | null;
  /** True iff the final attempt failed schema validation. */
  schemaInvalid: boolean;
  /** Full LLM trace, one entry per attempt (success or fail). */
  attempts: LLMAttempt[];
  promptHash: string;
  promptText: string;
  toolDefinition: unknown;
  usage: TokenUsage;
  costUsd: number;
  wallMs: number;
}

/**
 * Run the full extract-and-validate-and-retry pipeline for a single transcript.
 *
 * - Builds the strategy-specific prompt + few-shot prefix.
 * - Calls Anthropic with tool_choice forced to record_extraction (so the model
 *   *must* emit a structured payload — no free-form JSON parsing of model text).
 * - Validates the tool input against the JSON Schema (via Zod). On failure,
 *   feeds the structured errors back as a follow-up user message and retries.
 * - Caps total attempts; logs every attempt's request, response, validation
 *   errors, latency, and token usage.
 */
export async function extractStructured(
  input: ExtractInput,
): Promise<ExtractOutput> {
  const maxAttempts = input.maxAttempts ?? 3;
  const callFn = input.call ?? callAnthropic;
  const strategy = getStrategy(input.strategy);

  const system = strategy.buildSystem();
  const prefixMessages = strategy.buildPrefixMessages();
  const userMessage =
    strategy.buildUserMessage?.(input.transcript) ??
    defaultUserMessage(input.transcript);

  const hash = promptHash({
    strategy: strategy.id,
    system,
    tool: strategy.tool,
    few_shot: strategy.hashExtras?.() ?? null,
  });

  const attempts: LLMAttempt[] = [];
  // The conversation grows across retries with the assistant's previous
  // tool_use + the validation-feedback user message. That way the model can
  // see *its own* prior output and the specific errors to fix.
  const messages: PromptMessage[] = [...prefixMessages, userMessage];

  let totalUsage = { ...ZERO_USAGE };
  let prediction: Extraction | null = null;
  let schemaInvalid = true;

  const t0 = performance.now();
  for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo++) {
    const attemptStart = performance.now();
    let result: AnthropicCallOutput;
    try {
      result = await callFn(
        {
          model: input.model,
          system,
          tool: strategy.tool,
          prefixMessages,
          messages,
          enableCache: input.enableCache,
        },
        { apiKey: input.apiKey },
      );
    } catch (err) {
      const latency_ms = Math.round(performance.now() - attemptStart);
      attempts.push({
        attempt: attemptNo,
        request: {
          system,
          messages: [...messages],
          tools: [strategy.tool],
          model: input.model,
        },
        response: { raw_text: null, tool_input: null, stop_reason: null },
        usage: { ...ZERO_USAGE },
        latency_ms,
        validation_errors: null,
        error: err instanceof Error ? err.message : String(err),
      });
      // Hard transport error — break out, can't recover from this in-loop.
      break;
    }

    const latency_ms = Math.round(performance.now() - attemptStart);
    totalUsage = addUsage(totalUsage, result.usage);

    const validation = validateExtraction(result.toolInput);
    attempts.push({
      attempt: attemptNo,
      request: {
        system,
        messages: [...messages],
        tools: [strategy.tool],
        model: input.model,
      },
      response: {
        raw_text: result.text,
        tool_input: result.toolInput,
        stop_reason: result.stopReason,
      },
      usage: result.usage,
      latency_ms,
      validation_errors: validation.ok ? null : validation.errors,
    });

    if (validation.ok) {
      prediction = validation.value;
      schemaInvalid = false;
      break;
    }

    // Feed the model its own tool_use back, then the structured error list.
    // Anthropic conversation rules require a tool_result for any tool_use in
    // an assistant turn, so we synthesise one whose content is the feedback.
    const toolUseId = `toolu_attempt_${attemptNo}`;
    messages.push({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: toolUseId,
          name: EXTRACT_TOOL_NAME,
          input: result.toolInput ?? {},
        },
      ],
    });
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          is_error: true,
          content: buildValidationFeedback(validation.errors),
        },
      ],
    });
  }

  const wallMs = Math.round(performance.now() - t0);

  return {
    prediction,
    schemaInvalid,
    attempts,
    promptHash: hash,
    promptText: system,
    toolDefinition: strategy.tool,
    usage: totalUsage,
    costUsd: costUsd(totalUsage, input.model),
    wallMs,
  };
}
