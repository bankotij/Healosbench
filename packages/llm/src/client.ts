import Anthropic from "@anthropic-ai/sdk";

import type { TokenUsage } from "@test-evals/shared";

import { withRateLimitRetry, type RetryOptions } from "./rate_limiter";
import type { PromptMessage } from "./strategies/types";
import type { ToolDefinition } from "./tool";

export interface AnthropicCallInput {
  model: string;
  system: string;
  tool: ToolDefinition;
  prefixMessages: PromptMessage[];
  /** All messages from the prefix onward — includes the current case message AND any retry-feedback messages. */
  messages: PromptMessage[];
  maxTokens?: number;
  /** When true (default), inject cache_control breakpoints on the cacheable
   * prefix (system + tools + few-shot examples). Tests can disable this. */
  enableCache?: boolean;
}

export interface AnthropicCallOutput {
  /** Concatenated text of any text blocks in the assistant response. */
  text: string | null;
  /** Parsed tool_use input if the model called the tool, else null. */
  toolInput: unknown | null;
  stopReason: string | null;
  usage: TokenUsage;
  /** Full SDK request (post-cache-injection) — for the LLM trace. */
  requestForLog: {
    system: string;
    messages: PromptMessage[];
    tools: ToolDefinition[];
    model: string;
  };
  rawResponse: unknown;
}

let _client: Anthropic | null = null;
function getClient(apiKey: string): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey });
  return _client;
}

export interface AnthropicClientOptions {
  apiKey: string;
  retry?: RetryOptions;
}

/**
 * One LLM round-trip with cache control + 429 retry. The caller (extract.ts)
 * is responsible for the *retry-with-validation-feedback* loop, which is a
 * different concern (model-correctness-driven vs. transport-driven).
 */
export async function callAnthropic(
  input: AnthropicCallInput,
  opts: AnthropicClientOptions,
): Promise<AnthropicCallOutput> {
  const client = getClient(opts.apiKey);
  const enableCache = input.enableCache !== false;

  // System: array form so we can attach cache_control. One breakpoint covers
  // system + tools (Anthropic auto-extends the cache to the tool definitions
  // when a system breakpoint exists).
  const system = enableCache
    ? [
        {
          type: "text" as const,
          text: input.system,
          cache_control: { type: "ephemeral" as const },
        },
      ]
    : [{ type: "text" as const, text: input.system }];

  // Tools: a single tool today; cache_control on the last tool also helps
  // the cache survive minor system-text edits.
  const tools = [
    enableCache
      ? { ...input.tool, cache_control: { type: "ephemeral" as const } }
      : input.tool,
  ];

  // Inject a second cache_control breakpoint on the last block of the last
  // prefix message (when there is a prefix — i.e. few_shot). That way the
  // few-shot prefix is cached and only the live case transcript (+ retry
  // feedback) counts as fresh input on each request.
  const messages = enableCache
    ? injectFewShotCachePoint(input.messages, input.prefixMessages.length)
    : input.messages;

  const doCall = async () =>
    client.messages.create({
      model: input.model,
      max_tokens: input.maxTokens ?? 2048,
      system: system as unknown as Anthropic.TextBlockParam[],
      tools: tools as unknown as Anthropic.Tool[],
      tool_choice: { type: "tool", name: input.tool.name },
      messages: messages as unknown as Anthropic.MessageParam[],
    });

  const response = await withRateLimitRetry(doCall, opts.retry);

  // Pull tool_use input + any text content out of the response.
  let text: string | null = null;
  let toolInput: unknown | null = null;
  for (const block of response.content) {
    if (block.type === "text") {
      text = (text ?? "") + block.text;
    } else if (block.type === "tool_use" && block.name === input.tool.name) {
      toolInput = block.input;
    }
  }

  const usage: TokenUsage = {
    input: response.usage.input_tokens ?? 0,
    output: response.usage.output_tokens ?? 0,
    cache_read: response.usage.cache_read_input_tokens ?? 0,
    cache_write: response.usage.cache_creation_input_tokens ?? 0,
  };

  return {
    text,
    toolInput,
    stopReason: response.stop_reason,
    usage,
    rawResponse: response,
    requestForLog: {
      system: input.system,
      messages: input.messages,
      tools: [input.tool],
      model: input.model,
    },
  };
}

/**
 * Walk to the last block of the last prefix message and attach
 * `cache_control: { type: "ephemeral" }`. Pure — returns a new array.
 */
function injectFewShotCachePoint(
  messages: PromptMessage[],
  prefixLength: number,
): PromptMessage[] {
  if (prefixLength === 0) return messages;
  const lastPrefixIdx = prefixLength - 1;
  const target = messages[lastPrefixIdx];
  if (!target) return messages;

  const blocks = Array.isArray(target.content) ? [...(target.content as unknown[])] : null;
  if (!blocks || blocks.length === 0) return messages;

  const last = blocks[blocks.length - 1];
  if (typeof last !== "object" || last === null) return messages;

  blocks[blocks.length - 1] = {
    ...(last as Record<string, unknown>),
    cache_control: { type: "ephemeral" as const },
  };
  const out = [...messages];
  out[lastPrefixIdx] = { role: target.role, content: blocks };
  return out;
}
