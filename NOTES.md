# NOTES — HEALOSBENCH eval harness

Time spent: ~8 hours. Build is staged across fifteen commits — six core
phases (foundations → llm → eval → server → CLI → dashboard → tests/notes),
four stretch-goal commits (disagreements view, cost guardrail, prompt diff
view, cross-model run), a metric-correctness pass that fixed three real
bugs in the medication / diagnosis matchers, and a final spec-audit pass
that closed the transcript-grounding-highlight gap on the case-detail page.

## TL;DR results (50-case Haiku 4.5, full runs, force=true)

| Strategy   | Overall | chief_complaint | vitals | medications | diagnoses | plan | follow_up | Schema-fail | Hallucinated values | Wall | Cost |
| ---------- | :-----: | :-------------: | :----: | :---------: | :-------: | :--: | :-------: | :---------: | :-----------------: | ---: | ---: |
| zero-shot  | **0.716** | 0.433 | 0.995 | 0.737 | **0.844** | 0.603 | 0.682 | 0/50 | 11 |  60s | $0.16 |
| few-shot (3 ex.) | 0.715 | **0.491** | 0.995 | **0.748** | 0.778 | 0.580 | **0.701** | 0/50 | 14 |  94s | $0.17 |
| chain-of-thought | 0.712 | 0.432 | 0.995 | 0.737 | 0.793 | **0.634** | 0.682 | 0/50 |  9 |  65s | $0.20 |

Full CLI output is in `results/results-{zero_shot,few_shot,cot}.txt`.

Combined three-strategy spend was **$0.53** — comfortably under the README's
$1 budget. Caching does most of that work: the cached prefix is ~4.5–6.4k
tokens per request, so 49 of every 50 calls hit a `cache_read` of the full
system + tool + few-shot prefix.

> **Numbers above reflect a metric-correctness pass.** The first version of
> the harness shipped with three real bugs in the medication / diagnosis
> matchers (DOSE_RE not recognizing "grams", `normalizeFrequency` picking
> the wrong cadence on multi-cadence strings, and no containment match for
> partial agreements like "constipation" vs "chronic constipation"). The
> bugs were uncovered while reviewing case_011 in the dashboard. Fixing
> them lifted overall scores by +0.03 → +0.06 across all three strategies.
> The "what surprised me" section below is post-fix; the metric methodology
> section calls out exactly what changed and why.

### What surprised me

1. **The metric was lying about three strategies being equivalent.** With
   the original matchers, all three strategies scored 0.66–0.68 — within
   noise. After fixing the medication / diagnosis bugs (see "Metric
   correctness pass" below) the scores still bunch (0.71–0.72), but the
   *per-field winners* are now distinct: zero-shot wins diagnoses (0.84),
   few-shot wins chief_complaint and medications, CoT wins plan. The
   conclusion that "few-shot doesn't help" was partly an artifact of the
   metric over-penalizing few-shot's more verbose dose / frequency
   strings. With the fix, few-shot is *tied* on overall and *ahead* on
   chief_complaint and medications.

2. **CoT bought nothing on Haiku — and that's still true post-fix.**
   Asking the model to walk through six reasoning steps before calling
   the tool added wall time and gave roughly the same overall score.
   Haiku is already producing structured output via tool-use; forcing
   it to think out loud first gave it more rope to over-normalize plan
   items (where it does win) but didn't move the headline number. CoT
   would probably help on Sonnet (where reasoning quality is better)
   and on harder schemas (this one is shallow and well-typed).

3. **`chief_complaint` is a hard score to move.** All three strategies
   sit at 0.43–0.49 because it's a free-text field with one canonical
   gold per case. The clinician's framing ("sore throat for 4 days") and
   the model's framing ("acute pharyngeal pain x 4 days, low-grade
   fever") share intent but barely any tokens. To move this number you'd
   need an embedding-based similarity (cosine over a sentence encoder)
   or a judge-LLM second opinion — not the fuzzy token-set ratio I'm
   using. I deliberately did **not** tune this metric while fixing the
   others, because making token-set ratio more permissive on free text
   would create real false positives.

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
   AND happens to encode useful behavior the model now follows.

6. **Sonnet's lead over Haiku was hidden by the metric bug.** Initial
   5-case spot-check showed Haiku 0.705 vs Sonnet 0.689 — counter-
   intuitive given Sonnet's price (~7×). After the metric fix, the same
   5 cases now score Haiku 0.702 vs **Sonnet 0.796**. Sonnet *was* doing
   better on medications (0.90 vs 0.73) and diagnoses (1.00 vs 0.60);
   the old matcher was just penalizing its more elaborate dose / freq
   strings the same way it penalized few-shot's. Sonnet is worth the
   cost on this schema; the metric needed to be honest before that
   conclusion was visible.

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
  AND dose / frequency are *equivalent*. Equivalent means
  `normalizedDose(p) === normalizedDose(g)` (or symmetric prefix
  containment, e.g. gold `"17g"` ⊑ pred `"17g in 8 ounces of water"`),
  and likewise for frequency. The prefix-containment path is what
  catches "model produced a more specific version of the gold" without
  matching unrelated values like `"1g"` inside `"10g"`. Greedy bipartite
  pairing by descending name similarity. Route is *not* a match key
  (often null in gold) but disagreement is surfaced in `details`.
- **`diagnoses`** — set-F1 on description fuzzy match (threshold 0.7) with
  a *subset escape hatch*: if one description's token set is a strict
  subset of the other's (e.g. pred `{"constipation"}` ⊂ gold
  `{"chronic","constipation"}`) we score it 0.85 — above the threshold
  so it counts as a hit, but below 1.0 so the dashboard still shows the
  modifier loss. A small ICD-10 bonus (+0.05 × matched-pair fraction)
  rewards correct codes without making them pass/fail.
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

### Metric correctness pass

After the first round of 50-case runs, I reviewed several low-scoring
cases in the dashboard and found the metric was flagging genuinely
correct extractions as 0.0. case_011 was the canonical example —
gold `psyllium husk · one tablespoon · once a day`, pred
`psyllium husk · one tablespoon · once daily to start, can increase to
twice daily if needed` — clinically the same medication, scored 0.0 by
the matcher. Three real bugs / over-strict design choices:

1. **`DOSE_RE` missed `grams` / `gram` / `gm` and several other units.**
   The trailing `\b` in `g\b` failed inside "grams" so "17 grams" fell
   through to opaque string compare. Fixed by extending the alias list
   (grams, kilograms, tablespoons, teaspoons, tbsp, tsp, ounces, oz,
   liters, milligrams written long, etc.) and an alias map that
   canonicalizes them all to short form (`"17 grams"` → `"17g"`,
   `"one tablespoon"` → `"1tbsp"`).

2. **`normalizeFrequency` picked the FIRST cadence listed in the config,
   not the FIRST cadence occurring in the input.** "BID / twice daily"
   is checked before "once daily" in the config, so a string like
   `"once daily to start, can increase to twice daily if needed"`
   resolved to `"every 12 hours"` — the contingent cadence, not the
   primary one. Fixed by scanning all patterns and picking the one with
   the lowest match index (earliest-occurring in the input).

3. **No containment matching for partial agreements.** Added two paths:
   prefix-containment for medication dose / frequency (gold form is a
   strict prefix of pred or vice versa, length ≥ 3 + word-boundary so
   "1g" doesn't match "10g"), and strict-token-subset for diagnosis
   descriptions (lifts pairs like "constipation" / "chronic
   constipation" above the 0.7 threshold with a 0.85 score).

Net effect on the 50-case headline:

| Strategy   | Before fix | After fix | Δ |
| ---------- | :--: | :--: | :--: |
| zero-shot  | 0.683 | 0.716 | **+0.033** |
| few-shot   | 0.660 | 0.715 | **+0.055** |
| CoT        | 0.682 | 0.712 | **+0.030** |

The biggest gains were on `diagnoses` (zero-shot 0.668 → 0.844;
few-shot 0.520 → 0.778) — the subset-match path was doing real work.

What I **deliberately did not change**: the `chief_complaint` matcher.
That score sits at 0.43–0.49 because `tokenSetRatio` of "chronic
constipation for a couple months" against "constipation for a couple
of months, with hard and painful bowel movements" is genuinely 0.36.
Making the metric more permissive on free text would create real
false positives. The principled fix there is a judge-LLM second-
opinion metric — listed in "what I'd build next" below.

Tests in `packages/eval/test/` cover both the regression patterns
(case_011-style multi-cadence frequency, "17 grams" parsing, subset
diagnosis match) **and** the false-positive guards (1g should not
match 10g; equal-size disagreeing diagnoses should not subset-match).

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

## Tests (`bun run test` — 82 passing across 10 files)

| File | Coverage |
| --- | --- |
| `packages/eval/test/text.test.ts` | 11 tests on `normalize`, `tokens`, `jaccard`, `tokenSetRatio`, `fuzzyEqual` — including abbreviation expansion and the deliberate "single-token typo doesn't auto-match" property. |
| `packages/eval/test/medications.test.ts` | 14 tests covering dose normalization (`0.5 mg` → `500mcg`), frequency canonicalization (`BID` ≡ `twice daily`), route mapping, and set-F1 with extras / misses. |
| `packages/eval/test/set-f1.test.ts` | 11 tests on diagnoses + plan set-F1, including the ICD-10 bonus, paraphrase tolerance, and correct-abstention cases. |
| `packages/eval/test/hallucination.test.ts` | 7 positives + negatives: faithful → no flags, fabricated drug name → flagged, fabricated dose → flagged (proves `mg` stopwording works), unmeasured vital → flagged, paraphrased diagnosis → NOT flagged (correct). |
| `packages/llm/test/hash.test.ts` | 8 tests on canonicalJSON ordering and promptHash stability. |
| `packages/llm/test/rate_limiter.test.ts` | 8 tests: Semaphore correctness, `Retry-After` honored, no retry on 4xx, retry on 429/529/ECONNRESET, give up after maxRetries. |
| `packages/llm/test/extract.test.ts` | 6 tests on the schema-retry loop with a mocked client: invalid → valid recovery, validation feedback wording, max-attempts cap, single-attempt success, usage summing, transport-error path. |
| `packages/llm/test/estimate.test.ts` | 6 tests on the cost estimator: single-case is correctly more expensive with caching on, multi-case prefix math, ≥30% savings on 10-case few-shot, few_shot prefix > zero_shot prefix, Sonnet > Haiku for same workload, break-even at N≤3 cases. |
| `apps/server/test/runner.test.ts` | 5 *integration* tests that exercise the real Drizzle/Postgres path with a `mock.module()`-replaced extract service: resumability, idempotency, force-bypass, attempts persistence, prompt-row insert. |
| `apps/web/test/line-diff.test.ts` | 5 tests on the line-level LCS diff used by the prompt-diff view: identity / mod / add / del / disjoint. |

Total: **82 tests, 185 expect() calls**. All sub-second except the
runner integration tests which talk to Postgres (~100 ms each).

---

## Cross-model spot-check (Sonnet 4.5 vs Haiku 4.5)

Stretch goal #4: re-ran zero-shot on a 5-case subset (`case_001`..`case_005`)
under Sonnet 4.5 to see whether the bigger model is worth the spend on this
schema. Both runs use the same prompt-hash (`223250f441df…`).

| Model | Overall | chief_complaint | vitals | medications | diagnoses | plan | follow_up | Cost | Wall |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- | --- |
| Haiku 4.5  | 0.702 | 0.497 | 1.000 | 0.733 | 0.600 | **0.679** | 0.700 | $0.042 | 3.4s |
| Sonnet 4.5 | **0.796** | 0.496 | 1.000 | **0.900** | **1.000** | 0.628 | **0.751** | $0.126 | 8.4s |

Numbers above are **post metric-correctness pass** — the original 5-case
run had Haiku at 0.705 and Sonnet at 0.689, which made Sonnet look like
a slight loss for 3× the cost. After fixing the medication / diagnosis
matchers (see "Metric correctness pass" above), Sonnet's *real* lead
becomes visible: it canonicalizes medications and diagnoses meaningfully
better, and the old matcher was burying that signal under containment
mismatches.

The trade-off pattern:

- Sonnet wins decisively on `medications` (0.90 vs 0.73) and `diagnoses`
  (1.00 vs 0.60) — better at producing dose / frequency / description
  strings that match the gold canonical form.
- Sonnet still *loses* on `plan` (0.63 vs 0.68) — it over-paraphrases
  plan items, turning the gold's literal wording into more clinical
  phrasing ("return if symptoms worsen" → "return precautions for
  symptom progression"). The fuzzy plan-item matcher penalizes that.
- `chief_complaint`, `vitals`, `follow_up` are roughly tied.

**Decision a buyer would make from this data**: for high-stakes fields
(medications, diagnoses) Sonnet's +0.10 to +0.40 lead is real and worth
the 3× cost premium — those are the columns clinicians act on. If your
downstream consumer acts on diagnoses or medications, ship Sonnet. If
you only need follow-up bookkeeping or chief-complaint summarization,
Haiku is fine.

This is exactly the use case the compare view is designed for. Pick run
A and run B in the dashboard, look at the per-field deltas, and the
trade-off is visible in seconds.

Full output is at `results/results-{haiku,sonnet}-zero_shot-5case.txt`.

---

## Stretch goals — what I shipped

All four stretches in the README are now in the harness. Each landed as
its own commit so they're easy to skip if reviewing the core
requirements first.

| Stretch | Where | What it does |
| --- | --- | --- |
| Prompt diff view | `/prompts`, `/prompts/:hash`, `/prompts/diff?a=&b=` | Side-by-side line-LCS diff of system text + tool def + few-shot extras for any two prompt-hashes. Below the diff: a regression table of cases that scored differently under each prompt (matched on `case_id × model`, sorted by |Δ| desc). |
| Active-learning hint | `/disagreements` | Top-N cases where two or more runs (with distinct prompt-hashes) disagree most about the right answer. These are the highest-information cases for a human reviewer; the page shows per-run breakdown and links straight into the compare view. |
| Cost guardrail | `--max-cost=N` flag · `POST /api/v1/runs/estimate` · live panel in the New Run form | Pre-flight estimate using a chars/3.5 token heuristic and a prefix-cached cost model. Refuses to start if projected > cap (returns 412 from the API, exit 3 from the CLI). The dashboard shows projected cost-with-cache vs cost-without-cache so cache savings are visible. The estimator surfaces a real subtlety: on N=1, caching is *more* expensive than no-cache (1.25× write premium with no reads to amortize over) — break-even is N≈3 on Haiku. |
| Second model | Anywhere `--model` works | Pricing table covers Haiku 4.5, Sonnet 4.5, Sonnet 4.6, Opus 4.5. The cross-model spot-check above ran zero-shot on 5 cases under both Haiku and Sonnet to validate the compare view also handles cross-model deltas. |

---

## Known limitations / what I cut

- **Hallucination grounding is purely lexical.** A semantically-paraphrased
  but transcript-supported value still gets flagged. The honest fix is an
  embedding-based grounding check (cosine similarity between predicted
  value and transcript spans), which I'd add for production.
- **`chief_complaint` and `plan` are still in the 0.45–0.58 range.**
  Most of those failures aren't model errors — they're the metric. A
  free-text field with one canonical gold and a fuzzy token-set
  comparator will plateau here. To move it above 0.7 honestly I'd need
  multiple gold variants per case, an embedding similarity, or a
  judge-LLM rubric.
- **Cost estimator is a chars-per-token heuristic, not Anthropic's
  tokenizer.** The real `count_tokens` API would be more accurate but
  costs a round-trip per call. The heuristic over-estimates by ~10% in
  practice, which is the right direction for a guardrail.
- **No proper auth.** The README marks `packages/auth` as ignorable.
  The dashboard is open on localhost.

> **Closed gap (post-audit):** the README §4 case-detail spec asked for
> "the transcript (highlighted where prediction values are grounded)".
> The first version of the page rendered the transcript as plain text
> with the grounding signal only visible via the "Ungrounded values"
> list. After a final pass against the spec I added
> `packages/eval/src/grounding.ts` (a pure span-builder that mirrors the
> hallucination detector's policy: skip diagnoses, skip medication
> frequency / route, treat numeric vitals as raw lexemes) plus
> `apps/web/src/components/eval/transcript-highlight.tsx` (renders the
> transcript with exact / partial-token tiers and per-span tooltips
> naming the supporting field). Spans are computed server-side in the
> case-detail page and passed as props so no metric logic ships to the
> client. 10 new tests in `grounding.test.ts` cover the exact / partial
> tiers, the diagnosis exclusion, span merging, and the
> short-value-pathology guard.

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
4. **Full 50-case Sonnet sweep.** Stretch #4 only ran 5 cases to keep
   spend modest. A full sweep would either confirm the trade-off
   (Sonnet's plan loss persists) or reveal that 5 was too small a
   sample to draw conclusions from.

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

Then `bun run dev` and visit:

- `http://localhost:3001/runs` — list of runs and the new-run form (with
  live cost estimate).
- `http://localhost:3001/compare?a=<runA>&b=<runB>` — per-field deltas with
  per-case Δ table.
- `http://localhost:3001/disagreements` — top-N highest-information cases.
- `http://localhost:3001/prompts` — every materialized prompt-hash with
  side-by-side diff between any two.

To reproduce the cross-model spot-check:

```bash
bun run eval -- --strategy=zero_shot --model=claude-haiku-4-5-20251001 --filter=case_001,case_002,case_003,case_004,case_005
bun run eval -- --strategy=zero_shot --model=claude-sonnet-4-5-20250929 --filter=case_001,case_002,case_003,case_004,case_005
```

Then point the compare view at the two run IDs to see the per-field deltas
that drive the "ship Haiku" recommendation above.
