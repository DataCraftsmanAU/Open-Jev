# Isolated TREC holdout preparation

These files are text-free provenance, structural checks and the recorded conversion source for TREC-DL19/DL20. Actual query/passages/qrels remain in ignored `runs/external/ir-holdout`. They are not Open-Jev training data or an MIT/CC0 dataset release.

DL19 has 43 judged queries and 4,300 candidate occurrences; DL20 has 54 queries and 5,400. Every query has 100 unique candidate documents, official query text and complete qrels. Manifests contain pinned public download URLs, checksums, preprocessing and reuse terms. Candidate-source bytes match the pinned Hugging Face LFS digests; qrels and queries match the official-file checksums recorded by ir_datasets.

No Jev, Open-Jev or OpenAI inference was run here. nDCG in verification files is arithmetic on downloaded BM25 rankings, not a new retrieval run or a model result. Runtime token truncation still needs an explicit policy.

`prepare.py` is the exact recorded converter snapshot. It expects the raw/source layout described by the manifests next to it, and execution from the Open-Jev checkout. Reproduce in a new isolated directory outside training data, placing the source snapshot there; it refuses to overwrite prepared outputs. Do not place restricted external passages in this public evidence directory.

## Frozen provider run protocol

The [provider evaluation plan](provider-evaluation-plan.json) freezes all 97
queries and 9,700 candidate occurrences before any provider call. The separate
[preparation record](provider-input-preparation.json) binds the input-only
artifact by SHA256. `scripts/prepare_trec_provider_input.py` uses tiktoken 0.11.0
with `decode(encode(text)[:limit])`: 32 query tokens and 128 passage-prefix
tokens. Ten passage occurrences introduce a replacement character at the
prefix boundary; five re-encode to 129 tokens. These source-style strings are
preserved identically across providers, without a second truncation.

`scripts/evaluate_trec_provider.py` runs the existing independently authored
`general-ir-v1` listwise Score method, with a 20-passage window and step 10.
Each complete query consumes nine requests, or 873 requests per provider for
the full dataset. Initial candidate text/order and the algorithm match across
providers; later windows depend on each provider's earlier rankings. OpenAI
returns integer Score levels while Jev supplies scalar expected scores. This
is not an exact reproduction of the author's prompts, gateway or historical
model. Open-Jev checkpoint token limits require their own preflight before
GPU evaluation.

The runner reads no qrels. It saves exact inputs, each request before calling,
each raw response, every selected query ID, and complete/failed/pending states.
Full qrels remain separate for later nDCG@10 calculation. All 43/54 judged
queries stay in each benchmark's denominator. No result is claimed here by
preparing or starting the runner.

Strict Jev validation retains a 1e-6 probability-mass tolerance and 0.035
rounded-Score expectation tolerance. The predeclared supplementary scalar
analysis may continue only for the exact mass-only error with valid model,
keys, finite values and expectation consistency. It uses the actual scalar,
never renormalizes vectors, marks the primary query invalid and stores its
supplementary ranking separately. Primary strict metrics must give such
queries zero contribution. All other errors fail the query.

Each provider runs sequentially, without retries, with at most 873 requests,
a 60-second timeout and three-hour run limit. OpenAI has a 2,048 output-token
limit and an $80 threshold based on returned usage estimates, checked before
the next request. The final request can cross that estimate threshold; unknown
costs are counted, and this is not an invoice cap. Budget or endpoint stops
retain pending queries. Jev costs are unknown at runtime, not zero. Actual
query latency and request latency are separate; a simulated CPU run is not
model-quality evidence.

```bash
python -m pip install tiktoken==0.11.0
python -m scripts.prepare_trec_provider_input \
  --output runs/external/ir-holdout/provider-listwise-score-v1
python -m scripts.evaluate_trec_provider \
  --input runs/external/ir-holdout/provider-listwise-score-v1/input.json \
  --input-sha256 cc7bc949dbc269dacb61bdb61fc8982db14bc4df3698f9d32f5f1c8b6795eb83 \
  --output runs/trec-jev-listwise-score-v1 --model jev-1.13.0
```

Use `TYPESAFE_API_KEY` or `OPENAI_API_KEY` through the environment, never source
or command arguments. Output directories must be new; the runner does not
resume or resubmit prior requests. Real passage/input/response bundles remain
outside public code and training releases.
