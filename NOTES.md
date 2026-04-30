# NOTES — HEALOSBENCH eval harness

Time spent: ~10 hours. Build is staged across nine commits, one per phase, with a
lightly-narrative commit history.

## TL;DR results (50-case Haiku 4.5, full runs, force=true)

| Strategy   | Overall | chief_complaint | vitals | medications | diagnoses | plan | follow_up | Schema-fail | Hallucinated values | Wall | Cost |
| ---------- | :-----: | :-------------: | :----: | :---------: | :-------: | :--: | :-------: | :---------: | :-----------------: | ---: | ---: |
| zero-shot  | **0.683** | 0.453 | 0.995 | **0.710** | **0.668** | 0.579 | **0.695** | 0/50 |  7 |  63s | $0.19 |
| few-shot (3 ex.) | 0.660 | **0.482** | 0.995 | 0.700 | 0.520 | **0.582** | 0.681 | 0/50 | 17 |  82s | $0.17 |
| chain-of-thought | 0.682 | 0.456 | 0.995 | **0.710** | 0.660 | 0.575 | **0.695** | 0/50 |  7 | 111s | $0.19 |

Full CLI output is in `results/results-{zero_shot,few_shot,cot}.txt`.

Combined three-strategy spend was **$0.55** — comfortably under the README's
$1 budget. Caching does most of that work: the cached prefix is ~4.5–6.4k
tokens per request, so 49 of every 50 calls hit a `cache_read` of the full
system + tool + few-shot prefix.

### What surprised me

1. **Few-shot didn't win.** I expected three carefully-chosen worked examples
   to dominate. Instead they slightly *hurt* overall score and tripled the
   hallucination count (17 vs 7). The model copied the *style* of the
   examples — including their freedom to paraphrase clinical language —
   into cases where the gold demands more literal extraction. Diagnoses
   were the worst hit (0.52 vs 0.67): the few-shot examples normalize
   diagnoses heavily ("URI" → "viral upper respiratory infection") and
   the model started doing the same on cases where the gold uses the lay
   term verbatim.

2. **CoT bought nothing on Haiku.** Asking the model to walk through six
   reasoning steps before calling the tool added 1.7× wall time and zero
   accuracy. Haiku is already producing a structured output via tool-use;
   forcing it to think out loud first mostly gave it more rope to over-
   normalize plan items. CoT would probably help on Sonnet (where the
   reasoning quality is better) and on harder schemas (this one is
   shallow and well-typed).

3. **`chief_complaint` is a hard score to move.** All three strategies
   sit at 0.45–0.48 because it's a free-text field with one canonical
   gold per case. The clinician's framing ("sore throat for 4 days") and
   the model's framing ("acute pharyngeal pain x 4 days, low-grade
   fever") share intent but barely any tokens. To move this number you'd
   need an embedding-based similarity (cosine over a sentence encoder)
   or human review — not the fuzzy token-set ratio I'm using.

4. **Vitals are basically solved.** 0.995 mean on all three strategies.
   When vitals are stated in the transcript they're stated *exactly* the
   same way every time, and Haiku has no trouble pulling them out.

5. **Prompt caching has a 4,096-token floor on Haiku 4.5.** This isn't
   stated visibly in the SDK and `cache_control` fails *silently* below
   it. The bare strategy prompts came in at ~3,400 tokens — caching
   never engaged on the first attempt. I extended the system prompt
   with a deliberate field-by-field guidance section + a clinical
   normalization glossary. The new prefix lands at ~4.5k tokens (zero-
   shot, CoT) and ~6.4k tokens (few-shot), which clears the threshold
   AND happens to encode useful behavior the model now follows. This
   doubled as a quality win — case_001 went from 0.74 → 0.84 on
   few-shot purely from the field guidance.

---

## Architecture

```
┌─────────────────────────────┐         ┌──────────────────────┐
│ apps/web (Next.js 16, :3001)│  fetch  │ apps/server (Hono,   │
│  /, /runs, /runs/:id, …     │ ──────► │  :8787)              │
└─────────────────────────────┘  + SSE  │  REST + SSE          │
                                        └──────────┬───────────┘
                                                   │
                  ┌────────────────────────────────┼──────────────┐
                  │                                │              │
        services/runner.service.ts       services/extract.svc   db/
          • createRun / startRun          • wraps packages/llm  drizzle
          • SSE pub/sub                   • injects api key &     │
          • semaphore (5)                   default model        Postgres
          • idempotency lookup                                   (schema:
          • resumability filter                                   prompts,
                                                                  runs,
                                                                  cases,
                                                                  attempts)
        services/evaluate.service.ts     packages/llm/
          • per-field metrics              • client.ts (cache_control)
          • hallucination check            • rate_limiter.ts (429 + sem)
                                           • extract.ts (retry-with-fb loop)
                                           • strategies/{zero_shot,few_shot,cot}
                                           • hash.ts (canonical sha256)
                                           • pricing.ts (Haiku $/MTok table)
```

Three things make this layout pay off:

- **`packages/eval` is a pure library**, not a server module. The CLI imports
  the metrics directly without booting Hono. Tests run the metrics on
  in-memory inputs without a DB.
- **`packages/llm` knows nothing about runs**, so the same client is reused
  by `extract.service.ts`, the CLI, and the test mocks.
- **`packages/shared` is the single source of truth** for the `Extraction`
  schema (Zod mirror of `data/schema.json`), the run/case/attempt DTOs,
  and the SSE event union. The web bundle imports from
  `@test-evals/shared/extraction` and `/run` only — never the dataset
  loader (which uses node:fs).

---

## Prompt strategies — what's actually different

All three strategies share:

- Tool-forced output (`tool_choice: { type: "tool", name: "record_extraction" }`)
  so the model literally cannot return free-form JSON we'd have to parse.
- A retry-with-feedback loop capped at 3 attempts. Validation errors are
  fed back as a structured `tool_result` with `is_error: true` and the
  list of `path: message` issues from Zod. The model sees its own bad
  tool_use turn and the specific complaints to fix.
- The same shared `ROLE`, `SAFETY_RULES`, `FIELD_GUIDANCE`, and
  `FORMAT_HINT` blocks in the system prompt.

Where they diverge:

| Strategy | What's different |
| --- | --- |
| `zero_shot` | Just the shared system prompt + the tool. Smallest token footprint. |
| `few_shot` | Adds 3 worked examples in the *cached prefix* as alternating `user` / `assistant` (tool_use) / `user` (tool_result) message triplets. The transcripts and extractions are synthetic, deliberately *not* drawn from the eval set. |
| `cot` | Adds a "before calling the tool, walk through these 6 steps" block to the system prompt and a reinforcing trailer in the user message: `Work through the six steps in your reasoning, then call the record_extraction tool.` Latency goes up because the model emits more tokens before tool_use. |

Adding a fourth strategy is genuinely a 30-line change: drop a new file
in `packages/llm/src/strategies/`, register it in `strategies/index.ts`,
and add the id to `STRATEGIES` in `packages/shared/src/run.ts`.

---

## Evaluation methodology

Each field uses the metric most appropriate for its shape:

- **`chief_complaint`** — `tokenSetRatio`: average of Jaccard on token sets
  and normalized Levenshtein on the canonicalized strings. Robust to word
  order, light typos, and abbreviation variance (we expand a small
  whitelist: "URI" → "upper respiratory infection", "BID" → "twice daily",
  etc.).
- **`vitals.{bp,hr,temp_f,spo2}`** — sub-field exact-after-normalization.
  `temp_f` accepts ±0.2 °F. Sub-field scores are averaged into a single
  vitals score.
- **`medications`** — set-F1. Two meds match iff name `tokenSetRatio` ≥ 0.8
  AND `normalizedDose(p) === normalizedDose(g)` AND
  `normalizedFrequency(p) === normalizedFrequency(g)`. Greedy bipartite
  pairing by descending name similarity. Route is *not* a match key (it's
  often null in gold and would create false negatives) but disagreement
  is surfaced in `details`.
- **`diagnoses`** — set-F1 on description fuzzy match (threshold 0.7). A
  small ICD-10 bonus (+0.05 × matched-pair fraction) rewards correct
  codes without making them pass/fail.
- **`plan`** — set-F1 on plan items, fuzzy threshold 0.65 (laxer than
  meds, because plan items are free-text actions with more legitimate
  variation).
- **`follow_up`** — exact match on `interval_days`, fuzzy on `reason`,
  averaged. Both null on both sides counts as 1.0 (correct abstention).

The headline `overall_score` is the unweighted macro-mean of the six
field scores. Easy to argue for weighting medications and diagnoses
higher (they're the highest-stakes fields clinically), but I left it
flat so the dashboard's per-field bars do the talking.

### Hallucination detection

Lexical grounding check (`packages/eval/src/hallucination.ts`):

1. **Substring path** — if the normalized predicted value is a substring of
   the normalized transcript, it's grounded.
2. **Token-coverage path** — split the value into "content tokens"
   (length ≥ 2, not in a function-word/dose-unit stopword list). For each
   token, check if any transcript token matches via prefix-stem
   matching: substring either way OR shared 4-char prefix. If coverage
   ≥ 0.4, it's grounded.

Two notable design choices documented in the source:

- **Diagnoses are exempted** from grounding. The clinician's diagnosis is
  a clinical *inference* using formal terminology ("hyperlipidemia") and
  almost never appears verbatim in the transcript ("high cholesterol").
  Lexical grounding flags everything; lexical grounding is the wrong
  tool for this column.
- **Dose units are stopwords**. Without this, a fabricated `"500 mg"`
  would ground because `mg` is everywhere in the transcript. Stripping
  units forces the numeric value itself to appear in the transcript for
  the dose to count as grounded.

The `hallucination_count` is a signal, not a verdict — a high score with
ungrounded values means *paraphrase*, a low score with ungrounded values
means *fabrication*. The dashboard surfaces both.

---

## LLM plumbing decisions

### Concurrency + 429 strategy

A `Semaphore(5)` caps in-flight cases per run. That alone prevents the
50-case fan-out from burst-throttling. On top of it, `withRateLimitRetry`
treats HTTP 429 / 529 / `ECONNRESET` / `ETIMEDOUT` as retryable, with
exponential backoff (250 ms → 8 s, ±20 % jitter). When Anthropic sends a
`Retry-After` header we honor it exactly. We give up after 5 retries and
let the case fail; the runner marks the case `failed` and a future
`startRun` resumes only the unfinished cases.

I don't use a token bucket. The semaphore keeps QPS low enough on this
dataset and account that I never observed a 429 in a real run; the
retry path is exercised by tests, not by load.

### Resumability

Every run materializes one `cases` row per transcript up-front, status
`pending`. The runner's pending filter is `status != 'completed'`, so:

- A clean restart re-runs `pending` and `failed` cases.
- An in-flight case (`status = 'running'`) is also re-run — at worst we
  pay for it once. The alternative (a heartbeat/timeout) added complexity
  for no real benefit at this scale.
- Already-completed cases are left untouched; no double-charging.

The resumability test (`apps/server/test/runner.test.ts`) bakes this
exact scenario: pre-mark one case as completed, then `startRun` and
assert the mock LLM was called exactly twice (for the other two cases).

### Idempotency

Two distinct levels:

- **Cross-run idempotency**: a new run looks up any prior `cases` row
  with `status = 'completed'` whose run shares (strategy, model,
  prompt_hash) AND whose `case_id` matches. If found, copy the
  prediction + scores + hallucination flags into the new row, set
  `cached_from_case_pk` so the dashboard can show "served from cache",
  and skip the LLM entirely. Token usage and cost on the new row are
  zero. `force=true` bypasses this lookup.
- **Within-run idempotency** is just resumability — the same query
  `status != 'completed'`.

The integration test (`runner — idempotency`) exercises both paths: it
populates a cache via run A, then runs run B with the same prompt-hash
and asserts the mock LLM was called *zero* times.

### Prompt caching

Two `cache_control` breakpoints on every request:
1. The system text block (`type: "text"`).
2. The last few-shot prefix message's last content block (when there is
   a few-shot prefix).

Anthropic auto-extends the cache to tools when a system breakpoint
exists, so we don't need a third breakpoint there. The 4,096-token
minimum on Haiku 4.5 is the gotcha I lost an hour to — see #5 in the
"surprised me" list above.

Verified working: `results-zero_shot.txt` shows
`202,725 cache_read` over 50 cases, against `22,525 cache_write` on
the very first call. Subsequent calls within the 5-minute window pay
~$0.10 / MTok for cache reads instead of $1.00 / MTok for fresh input.

### Prompt-hash content addressing

`promptHash({ strategy, system, tool, few_shot })` produces a sha256
over canonical-JSON of the four fields. Canonical JSON sorts keys
recursively, so `{ a, b }` and `{ b, a }` hash identically. The hash
ends up on every `runs` row and the dashboard surfaces it as "prompt
v6" so it's unambiguous which prompt produced which numbers. Tests
verify: hash is stable across key order, changes when system text
changes, changes when few-shot examples change.

---

## Tests (`bun test` — 71 passing across 8 files)

| File | Coverage |
| --- | --- |
| `packages/eval/test/text.test.ts` | 11 tests on `normalize`, `tokens`, `jaccard`, `tokenSetRatio`, `fuzzyEqual` — including abbreviation expansion and the deliberate "single-token typo doesn't auto-match" property. |
| `packages/eval/test/medications.test.ts` | 14 tests covering dose normalization (`0.5 mg` → `500mcg`), frequency canonicalization (`BID` ≡ `twice daily`), route mapping, and set-F1 with extras / misses. |
| `packages/eval/test/set-f1.test.ts` | 11 tests on diagnoses + plan set-F1, including the ICD-10 bonus, paraphrase tolerance, and correct-abstention cases. |
| `packages/eval/test/hallucination.test.ts` | 7 positives + negatives: faithful → no flags, fabricated drug name → flagged, fabricated dose → flagged (proves `mg` stopwording works), unmeasured vital → flagged, paraphrased diagnosis → NOT flagged (correct). |
| `packages/llm/test/hash.test.ts` | 8 tests on canonicalJSON ordering and promptHash stability. |
| `packages/llm/test/rate_limiter.test.ts` | 8 tests: Semaphore correctness, `Retry-After` honored, no retry on 4xx, retry on 429/529/ECONNRESET, give up after maxRetries. |
| `packages/llm/test/extract.test.ts` | 6 tests on the schema-retry loop with a mocked client: invalid → valid recovery, validation feedback wording, max-attempts cap, single-attempt success, usage summing, transport-error path. |
| `apps/server/test/runner.test.ts` | 5 *integration* tests that exercise the real Drizzle/Postgres path with a `mock.module()`-replaced extract service: resumability, idempotency, force-bypass, attempts persistence, prompt-row insert. |

Total: **71 tests, 158 expect() calls**. All sub-second except the
runner integration tests which talk to Postgres (~100 ms each).

---

## Known limitations / what I cut

- **No prompt diff view.** Stretch goal; left out. The prompt-hash on
  every run is enough to know "did I run prompt v6 or v7?" but seeing
  the diff would help iterate. Could add a `/prompts/:hash` page that
  diffs against another hash.
- **Hallucination grounding is purely lexical.** A semantically-paraphrased
  but transcript-supported value still gets flagged. The honest fix is an
  embedding-based grounding check (cosine similarity between predicted
  value and transcript spans), which I'd add for production.
- **No cost guardrail.** The README listed it as stretch. With Haiku at
  $1/MTok input and a 50-case full run averaging $0.18, it never came
  close to mattering — but for Sonnet or Opus runs you'd want the
  pre-flight estimate.
- **`chief_complaint` and `plan` are still in the 0.45–0.58 range.**
  Most of those failures aren't model errors — they're the metric. A
  free-text field with one canonical gold and a fuzzy token-set
  comparator will plateau here. To move it above 0.7 honestly I'd need
  multiple gold variants per case, an embedding similarity, or a
  judge-LLM rubric.
- **No proper auth.** Same reason — the README marks `packages/auth`
  as ignorable. The dashboard is open on localhost.

## What I'd build next

1. **Per-field-error explorer.** Group all flagged cases by the actual
   diff (e.g. "model produced 'every 6 hours' but gold says 'every 6 hr'"
   — that's a normalizer gap, not a model error). Lets you tell apart
   "fix the metric" from "fix the prompt".
2. **Held-out vs in-domain split.** Mark which transcripts the few-shot
   examples were derived from (none right now — they're separately
   synthetic — but in a real iteration you'd want to be sure).
3. **Judge-LLM as a second-opinion metric.** For `chief_complaint` and
   `plan`, a Sonnet-as-judge pass that scores semantic equivalence
   between gold and prediction. Use it as a *second* number in the
   compare view, not a replacement.
4. **Cross-model compare.** The schema is already cross-model; pricing
   table covers Sonnet + Opus. Adding `--model=claude-sonnet-4-5-...`
   and re-running on a 5-case subset would let me see if the small
   `chief_complaint` gap closes with a stronger model.

---

## How to reproduce these numbers

```bash
bun install
docker compose up -d            # Postgres on :5433
echo "ANTHROPIC_API_KEY=sk-ant-..." > apps/server/.env
echo "DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/healosbench" >> apps/server/.env
bun run db:push

bun run eval -- --strategy=zero_shot --force
bun run eval -- --strategy=few_shot --force
bun run eval -- --strategy=cot --force
```

Then `bun run dev` and visit http://localhost:3001/compare to diff any
two runs side-by-side.
