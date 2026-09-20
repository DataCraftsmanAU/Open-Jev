# Compare Open-Jev, Jev and OpenAI on saved cases

This comparison has separate latency and quality tracks. The 11-workload
[latency experiment](inference-latency.md) does not cover every use case.
`scripts/build_provider_suite.py` indexes **73,333 frozen test/OOD decision
rows across 23 task-source identifiers** without changing training data. Its
first coverage pass contains 146 labelled requests plus all 43 existing saved
example requests. The examples have no new gold labels: response validity and
latency are measured, but they do not contribute to accuracy.

Two cases per source/split/task-type stratum are selected by a fixed SHA256
ordering before observing any provider result. This small deterministic suite
is a coverage check, not a representative population estimate. Some selected
rows share a family. Full test/OOD evaluation remains a separate pending stage.
The standalone JF100 suite preserves all 100 items and three option rotations;
TREC DL19/DL20 reranking remains a separate IR holdout. Neither enters training.

## Provider contract

All providers receive the same state, question, candidate descriptions and
order. The typed-row adapter checks byte-identical candidate prompt round trips.
Targets, group labels, generation metadata and rationale remain in a separate
gold file. Snapshot choices do not establish complete game, browser or flight
success; those require closed-loop environment evaluation.

OpenAI Responses uses strict JSON Schema and returns a Choice key, a Boolean
Noul, or an integer Score level. It does not generate probability vectors.
The models are **GPT-5.6 Luna with reasoning `none`** and **GPT-6 Astra with
reasoning `low`**. These settings are supported by the official model pages;
only aliases were listed there at measurement time, so requests and returned
model IDs are recorded. They represent different quality/latency settings, not
an equal reasoning budget. Both completed the full 11-workload latency run:
220 measured requests and 33 warmups per model, with zero request errors.
Customer-service P50/P95 is 918.13/1443.13 ms for Luna and
1938.39/2375.71 ms for Astra. Their total standard list-price estimates for all
253 attempts are $0.027253 and $1.348982, respectively; these are not invoices.

The OpenAI timing covers full response completion and validation, including
generation, DNS/TCP/TLS and HTTP. Request-to-schema construction is outside its
timer; Open-Jev's Predictor timer includes compilation. Every remote request
uses a fresh connection, concurrency one, and no retries. Server-side automatic
prompt caching may still apply; returned cached-token usage is retained.
Client location, output token limits, reasoning settings and full request
payloads are recorded. OpenAI outputs are not substituted into the trained
decision head or treated as calibrated probabilities.

Actual input, cached input, output and reasoning-token usage are retained where
returned. Cost is a standard list-price estimate, not an invoice: Luna
$0.20/$0.02/$1.20 and Astra $10/$1/$50 per million input/cached-input/output
tokens for this short-context workload. The captured official sources are
[Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna),
[Astra](https://developers.openai.com/api/docs/models/gpt-6-astra),
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
and [Responses](https://developers.openai.com/api/reference/resources/responses/methods/create),
accessed September 20, 2026.

## Quality accounting

`scripts/summarize_provider_quality.py` counts failed decisions as zero and
keeps unattempted cases pending. One-hot targets contribute to hard accuracy;
soft targets contribute their selected probability mass to expected accuracy
and are excluded from hard accuracy. Score is compared by discrete most likely
level here, not by expected numeric score. No fabricated one-hot model
probabilities are used for Brier, calibration or likelihood metrics.

The first Jev coverage run completed all 189 requests with HTTP 200. Four
responses had probability mass 0.99 and failed the predeclared strict 1e-6 mass
check; three were labelled cases. Original errors and raw probabilities are
retained. A separate categorical-only analysis accepts those three usable
finite choices, without renormalizing their probabilities or claiming strict
probability validity. On the 140 hard targets Jev answers 117 correctly; six
soft-target cases are separate. This is the small coverage suite, not all
73,333 rows.

The existing 2B/9B release evaluation contains byte-bound predictions for 82
of these same selected rows (76 hard, six soft). Historical predictions are
reused only after matching the whole row hash, checkpoint hash, target and
audited prediction-file hash. They supply quality evidence and no new latency.
On those **same 76 hard cases**, Open-Jev 2B scores 65, Open-Jev 9B scores 72,
and newly measured Jev scores 66. The 64 newer selected rows still require
Open-Jev inference. Do not compare the 82-row and 146-row denominators.

The new Jev JF100 run completed all 300 rotations with 232 correct categorical
answers; two responses had non-unit probability mass and are explicitly
identified in the separate decision-only analysis. Further independent probes
cover all integers 1–100 in FizzBuzz (299/300 typed decisions correct) and
132 controlled IR requests (165/165 hard decisions, nine soft targets). The
IR probe covers six original query instances and is not TREC evaluation.
These additional suites do not alter the frozen 189-request coverage pass.
The queued OpenAI quality runs evaluate the same saved coverage, JF100, IR and
FizzBuzz requests. New Open-Jev GPU inference remains scheduled after the
active training allocation is released.

## Reproduce

Build from the frozen local corpora, then use the environment variables
`TYPESAFE_API_KEY` and `OPENAI_API_KEY`. Never store keys in source or results.

```bash
python -m scripts.build_provider_suite --output data/provider-comparison-v1
python -m scripts.benchmark_jev_api_latency \
  --requests data/provider-comparison-v1/requests.json \
  --output runs/jev-coverage --warmup 0 --repetitions 1 --max-seconds 1800
python -m scripts.benchmark_openai_api \
  --requests data/provider-comparison-v1/requests.json \
  --model gpt-5.6-luna --output runs/luna-coverage \
  --warmup 0 --repetitions 1 --max-seconds 3600
python -m scripts.summarize_provider_quality \
  --gold data/provider-comparison-v1/gold.json \
  --samples runs/jev-coverage/samples.jsonl --categorical-only \
  --output runs/jev-coverage-quality.json
```

The original frozen inventory includes Wikispeedia records whose redistribution
permission has not been confirmed. Both the full registry and the selected
request/payload/raw-response bundles can contain those records; do not publish
them wholesale. Publish per-source statistics, hashes and explicitly filtered
redistributable evidence. The public HF projection omits those original rows.
