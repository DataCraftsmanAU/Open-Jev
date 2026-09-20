# N1 post-training continuation

`scripts/run_posttraining_evaluation.py` is a one-shot CPU supervisor for the
existing final 27B run. It was deployed from commit
`15e81b989eddb64ec68333feb27e382719a1ab81` and launched as **PID 1603179**.
A read-only check at **2026-09-20 23:42:51 UTC** verified that the process was
alive in `waiting_for_training`, with an empty `CUDA_VISIBLE_DEVICES` and no
completed evaluation stages. The CPU continuation is running; expansion and
service GPU evaluations have not started at this observation.

Deployment passed all **18 focused tests** on N1 and `--prepare-only` before
launch. The live source hash matched the tested implementation, and its tracked
checkout was clean. Private local deployment evidence is retained under
`runs/posttraining-evaluation-n1-v1/` (`deployment.json`, `launch.json`, and
`remote-tests-and-plan.log`); the independent observation is in
`reports/runtime-checks/posttraining-evaluation-supervisor-deployment-private.json`.

The private plan is `runs/posttraining-evaluation-n1-v1/plan.json`. It binds the
actual supervisor **1437936**, torchrun **1444386**, ranks **1444414–1444417**,
their process start times, command hashes, parent identities, and GPU 0–3 UUIDs.
The retired supervisor 1239866 is never restarted or signalled. Its historical
status is not a completion prerequisite.

The deployment provisions three separate checkouts from a Git bundle:

| Checkout | Revision |
| --- | --- |
| `/mnt/localssd/open-jev/posttraining-15e81b98` | `15e81b989eddb64ec68333feb27e382719a1ab81` |
| `/mnt/localssd/open-jev/expansion-eval-0b6e4fcc` | `0b6e4fcca3306b9fe98b96a08074e78b4674fd16` |
| `/mnt/localssd/open-jev/final-eval-ceb1ea85` | `ceb1ea85d7905d18972afb39da0f5f0baef2097a` |

Startup validated the pinned revisions and clean tracked files before entering
`waiting_for_training`. These detached worktrees are separate from the active
`/mnt/localssd/open-jev/four-gpu-repo`. The supervisor never clones or changes a
checkout.

Review the plan without process queries, GPU queries, or subprocess execution:

```bash
python3 -m scripts.run_posttraining_evaluation \
  --plan runs/posttraining-evaluation-n1-v1/plan.json --prepare-only
```

The existing CPU supervisor was launched from
`/mnt/localssd/open-jev/posttraining-15e81b98` with:

```bash
CUDA_VISIBLE_DEVICES='' /usr/bin/python3 -S \
  -m scripts.run_posttraining_evaluation \
  --expected-commit 15e81b989eddb64ec68333feb27e382719a1ab81 \
  --plan /data/zefan/open-jev/queues/posttraining-deploy-15e81b98/plan.json \
  --wait-hours 36 --poll-seconds 30
```

The private plan currently selects
`/data/zefan/open-jev/queues/posttraining-20260920` for its status, logs and
checkpoint-readiness evidence. Live status is `status.json` in that directory.
Existing queue or evaluation outputs are refused; there is no automatic retry
or overwrite. This deployment uses a 36-hour wait budget and 30-second polling
(the CLI's default wait budget is 48 hours). Signals stop/reap only an owned
evaluation child.

| Reported phase | Required evidence before advancing |
| --- | --- |
| `waiting_for_training` | All six identified processes ended; the actual interlude reports final completion with training exit code zero. PID reuse or failed training aborts. |
| `checking_final_checkpoint` | Pinned CPU validation of final 2B/9B/27B files; 27B must have its full 27,581-step finite log, fixed calibration, passing reload and recorded run identity. |
| `waiting_for_schedule_lease` / `waiting_for_gpu_leases_*` | The original scheduling and GPU leases are released; physical GPUs 0–3 retain their recorded UUIDs and are idle. |
| `running_expansion` | The exact prepared evaluator runs all 40,281 expansion test/OOD rows on GPUs 0–3. |
| `waiting_for_expansion_audit` | The independent audit and its original capture manifest pass the gate described below. |
| `checking_benchmark_separation` | Existing pinned JF100 source audit and both frozen-dataset separation checks succeed. |
| `running_service_2b_9b`, then `running_service_27b` | The existing workflow, JF100, game, browser and drone commands run serially on GPU 3 with 16K input, batch size 1 and typed Doom decisions. |
| `complete_with_pending_stages` | All three prepared GPU stages finished and their manifests/cleanup passed. Contact and amount remain explicitly pending. |

The supervisor holds the four-GPU scheduling lock while evaluating or awaiting
the audit. Evaluation children acquire their own GPU leases; the parent probes
and releases those leases before starting a child. It cannot bypass a busy
card or lease. It preserves every failed measurement and stops the sequence on
a failed child, invalid artifact, changed checkpoint or invalid audit.

After expansion finishes, follow the existing
[independent package/capture/verification workflow](final-checkpoint-evaluation.md).
Place the resulting `27b-audit.json` and its original `capture.json` under the
queue output's `audit-gate/` directory. Transfer each to a temporary filename
and rename atomically when complete. This is an evidence handoff, not a new
approval requirement. The supervisor does not itself package or transfer
evidence, and remains visibly waiting until this handoff finishes.

The gate requires the passed 40,281-row audit, the reviewed verifier hashes,
identical checkpoint/calibration/data identities, the full captured file set,
and unchanged current training/evaluation/controller bytes. A failed or
mismatched report aborts; a missing report keeps the CPU supervisor waiting.

Contact/amount have tested HTTP evaluator entry points but no reviewed pinned
per-model service-lifecycle commands in this plan. Their outputs cannot be
claimed complete when the prepared stages end.

## Bounded contact/amount follow-up

The smallest follow-up reuses `scripts.run_service_suite.py` for its existing
GPU-3 lease, owned server startup, readiness/identity probe, measurement logs and
server cleanup. Commit `15e81b989eddb64ec68333feb27e382719a1ab81` contains both
`scripts.evaluate_contact_service` and `scripts.evaluate_amount_service` plus
the existing lifecycle helper. A new reviewed revision would add two
measurement choices and a control-data-root argument to that helper, with
commands wired to its verified model/revision/checkpoint/temperature identity.
The deployed supervisor and its three frozen stage commands stay pinned.

Before that separate follow-up can run:

1. PID 1603179 must finish all three prepared stages and release its scheduling
   lock; its completed manifests and the independent expansion audit must pass.
2. A separate checkout/environment must contain the reviewed extension, frozen
   email/phone/amount corpora and matching producer files. Phone evaluation
   requires `phonenumbers==9.0.14`. CPU preflight must verify the complete held-out
   selections: **1,924 contact documents** and **864 amount documents** per model.
3. For each verified final 2B/9B/27B checkpoint, start the existing server on
   physical GPU 3 with 16,384 tokens and batch size 1. Run contact with
   `--corpora email phone --splits test ood`, then amount with
   `--splits test ood`. Both evaluators receive the server's verified base
   revision, checkpoint digest and saved temperature. Use new output directories
   and retain A-stage selections, dependent B-stage outcomes and all failures.
4. Shut down the owned server, verify GPU cleanup, then advance to the next
   model. These corpora are transfer tests for the existing checkpoints; they
   were not included in the active training mixture.

This follow-up is a reviewed path forward, not an implemented or deployed
contact/amount lifecycle. The current queue continues to report both as pending.

Local CPU checks:

```bash
python3 -m unittest tests.test_posttraining_evaluation -v
```

These tests exercise process reuse, failed/incomplete training, real lease
contention, foreign GPU ownership, manifest completeness, audit identity and
byte changes, owned-child cleanup, phase ordering and refusal to replay outputs.
They do not load weights, contact an API, allocate a GPU or deploy the supervisor.
