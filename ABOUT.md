# HEALOSBENCH

**An eval harness for structured clinical extraction.** Drop in a folder
of de-identified visit transcripts and gold JSON extractions, pick a
prompt strategy + model, watch a Next.js dashboard score the model
case-by-case in real time, and compare runs side-by-side to make a
defensible "ship this prompt / model" call.

> **Hosting note.** This project is **not** deployed publicly. The
> assignment spec (`README.md` lines 201–214) explicitly lists
> "deployment" under *what we're not looking for*, and the submission
> flow is "push to a private repo or zip the working tree." Everything
> below runs locally on `:3001` (web) and `:8787` (server). The video
> + screenshots in this doc stand in for a live URL.

---

## 90-second tour

<video src="./docs/videos/01-overview.mov" controls width="100%"></video>

> If your markdown renderer doesn't play `.mov` inline, open
> [`docs/videos/01-overview.mov`](./docs/videos/01-overview.mov)
> directly.

---

## Quick links

| Doc | What's there |
|---|---|
| [`README.md`](./README.md) | Original assignment spec — left untouched |
| [`NOTES.md`](./NOTES.md) | Methodology + results writeup (the assignment deliverable) |
| **`ABOUT.md`** *(this file)* | Project tour with screenshots + video |
| [`results/`](./results/) | CLI output for all 50-case runs |

---

## TL;DR

- **Stack:** Bun monorepo · Hono server (`:8787`) · Next.js 16 dashboard (`:3001`) · Postgres via Drizzle · Anthropic SDK
- **Models:** Claude Haiku 4.5 (default), Sonnet 4.5 (cross-model spot-check)
- **Strategies:** `zero_shot` · `few_shot` (3 worked examples) · `cot` (chain-of-thought)
- **Concurrency:** Semaphore(5) + 429/529 backoff with `Retry-After` honored
- **Resilience:** Resumable runs · idempotent re-posts · retry-with-validation-feedback (cap 3 attempts)
- **Cost:** Pre-flight estimate · live cost panel in UI · `--max-cost` guardrail (HTTP 412 enforcement)
- **Streaming:** Server-Sent Events for live dashboard updates
- **Tests:** 91 pass / 0 fail / 201 expects across 10 files in <1s
- **Headline:** 0.71–0.72 overall on 50 cases for ~$0.16 per strategy. Combined three-strategy spend: $0.53 (well under the $1 budget).

---

## The problem

Given a clinical visit transcript like this:

> *Doctor:* Hi Eleanor, how can I help?
> *Patient:* I've been so constipated. I might go once every 4 or 5 days, and when I do it's hard and painful…

…produce structured JSON conforming to `data/schema.json`:

```json
{
  "chief_complaint": "chronic constipation for a couple months",
  "vitals": { "bp": null, "hr": null, "temp_f": null, "spo2": null },
  "medications": [
    { "name": "psyllium husk", "dose": "one tablespoon",
      "frequency": "once a day", "route": "PO" }
  ],
  "diagnoses": [{ "description": "chronic constipation", "icd10": "K59.00" }],
  "plan": ["psyllium husk one tablespoon mixed in water once a day, …"],
  "follow_up": { "interval_days": 28, "reason": "constipation recheck" }
}
```

…with a system around it that:

1. Doesn't crash on a malformed tool output (retry with the validator's error)
2. Doesn't burst-throttle Anthropic (semaphore + backoff)
3. Doesn't double-charge if you re-post the same run (idempotency)
4. Doesn't lose progress on crash (resumability)
5. Doesn't surprise you with a $40 bill (pre-flight cost estimate + cap)
6. Tells you *which fields* are getting worse when you tweak a prompt (compare view)
7. Surfaces *which cases* disagree most across runs so you know where to look (active learning)

The harness handles all seven.

---

## Tour of the dashboard

### 1. Home

![Home](./docs/screenshots/01-home.png)

Four navigation cards — **Runs**, **Compare**, **Disagreements**,
**Prompts**. Every other view is one click away.

### 2. Runs list + new-run form

![Runs list](./docs/screenshots/02-run-list.png)

The new-run form sits at the top: strategy picker, optional case filter
(`case_001,case_002,…`), optional cost cap, force-rerun checkbox, and a
**live cost estimate** that updates as you change strategy. Below it,
every past run with strategy, model, prompt-hash chip, per-field score
bars, hallucination count, cost, and status badge.

### 3. Cost estimate (close-up)

![Cost estimate](./docs/screenshots/03-cost-estimate.png)

Pre-flight estimate with cached vs uncached split. The "no cache: $X —
saving $Y via prompt cache" line is the prompt-caching ROI made
explicit. If you set a `Max cost (USD)` and the projection blows it,
the run is rejected with HTTP 412 *before* a single token is sent — the
cost guardrail stretch goal.

### 4. Run detail

![Run detail](./docs/screenshots/04-run-detail.png)

Summary card up top (overall + per-field bars + hallucination count +
cost + wall + tokens) and a per-case table below it. If the run is
still going, an SSE indicator pulses and rows fill in live as cases
finish.

### 5. Case detail — extraction diff + LLM trace

![Case detail](./docs/screenshots/05-case-detail.png)

Two stacked panels:

- **Extraction diff** — gold on the left, prediction on the right,
  every field colored by score. Mismatches highlighted, perfect matches
  subdued. This is where the metric subtleties live (case_011's
  `"17 grams"` vs `"17 grams in 8 ounces of water"` is visible here).
- **Attempt trace** — every LLM round-trip, including retries. Shows
  the system prompt, tool call, validated output (or the validation
  error that triggered the next attempt), and token usage. **This is
  the panel that proves retry-with-feedback works** — a failed attempt,
  the validator's error message routed back into the next user turn,
  the next attempt succeeding.

### 6. Compare view

![Compare](./docs/screenshots/06-compare.png)

Pick run A, pick run B. The view shows per-field score deltas with a
winner column ("zero_shot +0.07 on diagnoses") and per-case deltas
sortable by spread. This makes "should I ship few-shot or stick with
zero-shot?" answerable in five seconds — and it's how you'd notice
that a prompt edit improved overall but regressed two fields.

### 7. Disagreements (active-learning hint)

![Disagreements](./docs/screenshots/07-disagreements.png)

Top-N cases by score *spread* across runs of different prompts. The
intuition: cases where prompt strategy meaningfully changes the answer
are the cases where your gold is ambiguous, your prompt is improvable,
or your metric is under-specified. The query filter requires
`distinctPrompts.size ≥ 2` so re-runs of the same prompt don't pollute
the list.

This is the **active-learning hint** stretch goal — use it to
prioritize human review.

### 8. Prompts list

![Prompts list](./docs/screenshots/08-prompts-list.png)

Every distinct prompt the harness has ever materialized, keyed by
sha256(content). Shows hash prefix, strategy, model, when first seen,
how many runs have used it. Two checkboxes per row → click "Compare
prompts" to land on the diff view.

### 9. Prompt detail

![Prompt detail](./docs/screenshots/09-prompt-detail.png)

Click a hash row. Full system prompt + tool schema, plus the list of
runs that used this exact prompt. An audit trail of "what did I
actually send?".

### 10. Prompt diff (with regression cases)

![Prompt diff](./docs/screenshots/10-prompt-diff.png)

Side-by-side LCS line diff of two system prompts (insertions, deletions,
edits all called out), plus a per-case regression list — cases where
the score on prompt A vs prompt B moved by more than ε, sorted by
magnitude. Answers "did this prompt edit actually help, and on which
cases?".

This is the **prompt-diff view** stretch goal.

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
          • hallucination check            • rate_limiter.ts (semaphore + 429 backoff)
                                           • extract.ts (retry-with-feedback)
                                           • strategies/{zero_shot,few_shot,cot}
                                           • estimate.ts (pre-flight cost)
                                           • hash.ts (canonical sha256)
```

Three packages do the conceptual work; everything else is glue:

| Package | Role |
|---|---|
| `packages/llm` | Tool schema, strategy registry, retry-with-feedback, prompt caching, semaphore + 429 backoff, cost estimator |
| `packages/eval` | Per-field metrics (fuzzy text, numeric tolerance, set-F1 with containment escape hatches) and lexical hallucination detection |
| `packages/shared` | TypeScript types shared between server and web (Zod schemas mirroring `data/schema.json`, run/case/attempt DTOs, SSE event union) |

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Bun | Required by the assignment; also fastest for this workload |
| Monorepo | Bun workspaces + Turborepo | Free; minimal config |
| Database | Postgres via Drizzle | Typed migrations + schema as code |
| Server | Hono | Tiny; SSE-friendly; works on Bun natively |
| Frontend | Next.js 16 (App Router) | What the starter gave us |
| LLM | Anthropic SDK + tool use | Required by spec |
| Validation | Zod | Tool-call schema + env config + DTOs |
| Tests | `bun:test` | Fast; mocking just works |
| Type-safety | TS strict + tsgo | tsgo on `bun run typecheck` |

---

## The CLI

```bash
bun run eval -- --strategy=zero_shot

bun run eval -- --strategy=cot \
                --filter=case_001,case_002,case_003 \
                --max-cost=0.05

bun run eval -- --strategy=few_shot --estimate

bun run eval -- --strategy=zero_shot --model=claude-sonnet-4-5-20250929

bun run eval -- --strategy=zero_shot --force
```

Feature parity with the dashboard: same prompt strategies, same
guardrail, same idempotency cache, same resumability semantics. CLI
output goes to `results/results-<strategy>.txt` for the headline
numbers in NOTES.md.

---

## Metrics at a glance

| Field | Metric |
|---|---|
| `chief_complaint` | `tokenSetRatio` — average of Jaccard on token sets and normalized Levenshtein on canonicalized strings |
| `vitals.{bp,hr,temp_f,spo2}` | Sub-field exact-after-normalization; `temp_f` ±0.2 °F. Sub-fields averaged into one vitals score |
| `medications` | Set-F1, name `tokenSetRatio ≥ 0.8` AND dose/frequency *equivalent* (canonical equality OR prefix containment). Greedy bipartite matching |
| `diagnoses` | Set-F1 on description fuzzy match (≥0.7) OR strict-token-subset (score 0.85) + small ICD-10 bonus |
| `plan` | Set-F1 on plan items, fuzzy threshold 0.65 (laxer — plan items are free-text) |
| `follow_up` | Exact `interval_days` + fuzzy `reason`, averaged. Both null on both sides = 1.0 (correct abstention) |

The headline `overall_score` is the unweighted macro-mean of those six.

**Hallucination detection** is a separate **lexical grounding check**:
every predicted value (except diagnosis descriptions, which are clinical
*inferences* and shouldn't be required to appear verbatim) must either
be a substring of the transcript OR have ≥40% content-token coverage
with prefix-stem matching. Dose units (`mg`, `mcg`, …) are stopwords so
a fabricated `"500 mg"` doesn't ground just because `mg` is everywhere
in the transcript.

The full methodology — including a "metric correctness pass" that fixed
three real bugs in the medication / diagnosis matchers and lifted
overall scores by +0.03 to +0.06 — lives in
[`NOTES.md`](./NOTES.md#evaluation-methodology).

---

## Headline results (50 cases, Haiku 4.5)

| Strategy | Overall | chief_complaint | vitals | medications | diagnoses | plan | follow_up | Hallucinated values | Wall | Cost |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- | --- |
| zero-shot | **0.716** | 0.433 | 0.995 | 0.737 | **0.844** | 0.603 | 0.682 | 11 | 60s | $0.16 |
| few-shot (3 ex.) | 0.715 | **0.491** | 0.995 | **0.748** | 0.778 | 0.580 | **0.701** | 14 | 94s | $0.17 |
| chain-of-thought | 0.712 | 0.432 | 0.995 | 0.737 | 0.793 | **0.634** | 0.682 |  9 | 65s | $0.20 |

Plus a 5-case Haiku-vs-Sonnet head-to-head:

| Model | Overall | medications | diagnoses | plan | Cost |
| --- | :-: | :-: | :-: | :-: | --- |
| Haiku 4.5  | 0.702 | 0.733 | 0.600 | **0.679** | $0.04 |
| Sonnet 4.5 | **0.796** | **0.900** | **1.000** | 0.628 | $0.13 |

Sonnet wins +0.10 on this schema, almost entirely from medications
and diagnoses. Worth its 3× cost premium when the downstream consumer
acts on those columns.

Per-field narrative + the "what surprised me" section is in
[`NOTES.md`](./NOTES.md#what-surprised-me).

---

## Stretch goals shipped

All four bullets from the README's "Stretch (only if you have time)"
list are implemented and have dedicated dashboard pages.

| # | Stretch goal | Where |
|---|---|---|
| 1 | **Active-learning / disagreements view** | `/disagreements` — top-N cases by score spread across runs of different prompts |
| 2 | **Cost guardrail** | `estimateCost()` in `packages/llm`, server-side enforcement (HTTP 412 on `max_cost_usd` exceeded), CLI `--max-cost` flag, dashboard `Max cost (USD)` input |
| 3 | **Prompt diff view** | `/prompts/diff` — side-by-side LCS line diff + per-case regression list |
| 4 | **Cross-model spot-check** | 5-case zero-shot run on Sonnet 4.5; full per-field comparison documented in NOTES.md |

---

## What's covered by tests

```
packages/eval/test/        text, medications, set-f1, hallucination
packages/llm/test/         hash, rate_limiter, extract, estimate
apps/server/test/          runner integration (extractor mocked)
apps/web/test/             line-diff utility

→ 91 pass / 0 fail / 201 expects across 10 files in ~500 ms
```

The interesting test categories:

- **Retry-with-feedback** — `extract.test.ts` mocks Anthropic to return
  invalid output on the first 1–2 attempts and verifies the validation
  error is routed back into the next user turn so the model can fix it.
- **Rate limiting** — `rate_limiter.test.ts` simulates HTTP 429 with
  `Retry-After` and verifies exact-honor + exponential backoff.
- **Cost estimator break-even** — `estimate.test.ts` confirms caching is
  *more* expensive on N=1 (1.25× cache_write with nothing to amortize
  over) and pays off by N=3.
- **Idempotency** — `runner.test.ts` asserts a duplicate
  `(strategy, model, prompt_hash, case_id)` returns the cached result
  with zero extra LLM calls.
- **Metric regression guards** — `medications.test.ts` asserts
  containment matching does NOT match `"1g"` against `"10g"`;
  `set-f1.test.ts` asserts subset-matching does NOT match `"asthma"`
  against `"diabetes"`.

---

## Project layout

```
healosbench/
├── README.md                    ← Assignment spec (untouched)
├── NOTES.md                     ← Methodology + results writeup
├── ABOUT.md                     ← This file
│
├── apps/
│   ├── server/                  ← Hono on :8787
│   │   ├── src/
│   │   │   ├── index.ts         ← REST + SSE routes
│   │   │   ├── cli/eval.ts      ← `bun run eval` entry
│   │   │   └── services/        ← runner, extract, evaluate, run_events
│   │   └── test/                ← Integration tests
│   └── web/                     ← Next.js 16 on :3001
│       ├── src/app/
│       │   ├── page.tsx         ← Home
│       │   ├── runs/            ← Runs list + detail + case detail
│       │   ├── compare/         ← Compare view
│       │   ├── disagreements/   ← Disagreements view
│       │   └── prompts/         ← Prompts list / detail / diff
│       └── src/components/eval/ ← All eval-specific components
│
├── packages/
│   ├── llm/                     ← Anthropic SDK wrapper, strategies, retry, rate limit, estimate
│   ├── eval/                    ← Per-field metrics + hallucination detector
│   ├── shared/                  ← Shared TS types (Zod schemas + DTOs)
│   ├── db/                      ← Drizzle schema + migrations
│   └── env/                     ← Typed env loading
│
├── data/                        ← 50 transcripts + gold extractions + schema.json
├── results/                     ← CLI output for the headline runs
└── docs/
    ├── screenshots/             ← Dashboard captures used above
    └── videos/                  ← 90-second tour
```

---

## Running it locally

```bash
docker compose up -d              # Postgres on :5433

bun install

cd packages/db && bun run db:push && cd ../..

# apps/server/.env should have:
#   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/healosbench
#   ANTHROPIC_API_KEY=sk-ant-…

bun run dev                        # server :8787, web :3001

# or run a CLI eval headlessly
bun run eval -- --strategy=zero_shot
```

Open `http://localhost:3001` and the dashboard is live.

---

## Documentation map

```
README.md   ← what you were asked to build
NOTES.md    ← what was built, why, and the numbers
ABOUT.md    ← this file: the visual + narrative tour
```

`NOTES.md` is the assignment deliverable — methodology, results, and
the "what surprised me" / "what I'd build next" reflection.

`ABOUT.md` is for anyone landing on the repo cold who wants to *see*
the project before reading it.
