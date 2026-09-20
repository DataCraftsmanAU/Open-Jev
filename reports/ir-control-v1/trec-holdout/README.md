# Isolated TREC holdout preparation

These files are text-free provenance, structural checks and the recorded conversion source for TREC-DL19/DL20. Actual query/passages/qrels remain in ignored `runs/external/ir-holdout`. They are not Open-Jev training data or an MIT/CC0 dataset release.

DL19 has 43 judged queries and 4,300 candidate occurrences; DL20 has 54 queries and 5,400. Every query has 100 unique candidate documents, official query text and complete qrels. Manifests contain pinned public download URLs, checksums, preprocessing and reuse terms. Candidate-source bytes match the pinned Hugging Face LFS digests; qrels and queries match the official-file checksums recorded by ir_datasets.

No Jev, Open-Jev or OpenAI inference was run here. nDCG in verification files is arithmetic on downloaded BM25 rankings, not a new retrieval run or a model result. Runtime token truncation still needs an explicit policy.

`prepare.py` is the exact recorded converter snapshot. It expects the raw/source layout described by the manifests next to it, and execution from the Open-Jev checkout. Reproduce in a new isolated directory outside training data, placing the source snapshot there; it refuses to overwrite prepared outputs. Do not place restricted external passages in this public evidence directory.
