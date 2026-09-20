"""Export compact public metrics from the committed full-data audits."""

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def metrics(row):
    measured = row["probability_metrics_all_rows"]
    keys = ("count", "hard_count", "accuracy", "expected_accuracy", "nll",
            "brier", "expected_brier", "multiclass_ece", "ece_bins")
    result = {key: measured[key] for key in keys}
    result["failed"] = row["failed"]
    result["hard_correct"] = round(measured["accuracy"] * measured["hard_count"])
    return result


def main():
    models = []
    for model in ("2b", "9b"):
        path = ROOT / f"reports/full-data-eval-n1-v1/{model}-audit.json"
        raw = path.read_bytes()
        audit = json.loads(raw)
        assert audit["status"] == "passed" and audit["model_evaluation_complete"]
        models.append({
            "model": audit["model"], "revision": audit["revision"],
            "evaluation_source_commit": audit["evaluation_source_commit"],
            "audit_path": str(path.relative_to(ROOT)),
            "audit_sha256": hashlib.sha256(raw).hexdigest(),
            "coverage": audit["coverage"],
            "splits": {split: {"overall": metrics(row),
                                "by_source": {key: metrics(value) for key, value in row["by_source"].items()}}
                       for split, row in audit["metrics"].items()},
        })
    corpora = []
    totals = {}
    sources = set()
    for name in ("browser-drone-expansion-v1", "citation-control-v1",
                 "entity-alignment-control-v1", "amount-extraction-control-v1",
                 "email-selection-control-v1", "phone-extraction-control-v1",
                 "context-retention-control-v1", "sponsor-segment-control-v1",
                 "silent-failure-control-v1", "ir-control-v1", "mailroom-control-v1"):
        path = ROOT / f"reports/data-manifests/{name}.json"
        if not path.exists():
            path = ROOT / f"reports/{name}/manifest.json"
        raw = path.read_bytes()
        data = json.loads(raw)
        splits = data["summary"]["splits"]
        sources.update(data["summary"]["sources"])
        for split, count in splits.items():
            totals[split] = totals.get(split, 0) + count
        corpora.append({"name": name, "splits": splits,
                        "manifest_path": str(path.relative_to(ROOT)),
                        "manifest_sha256": hashlib.sha256(raw).hexdigest()})
    result = {
        "scope": "Completed release-v2 checkpoint evaluation; broader prepared inventory is separate.",
        "evaluation_models": models,
        "prepared_inventory": {"corpora": corpora, "splits": totals,
                               "total_decision_rows": sum(totals.values()), "task_source_identifiers": len(sources)},
        "limitations": [
            "2B and 9B trained on 80,816 release-v2 training rows; broader inventory is not their evaluation set.",
            "Hard accuracy excludes 960 soft-target rows per model; expected accuracy includes all rows.",
            "Synthetic controlled decision accuracy is not an end-to-end task or gameplay success rate.",
            "No full-data base-model baseline was run; no full-data training gain is claimed.",
            "27B final evaluation and final-model JF100/service suites are pending.",
            "The new corpora have not been used to retrain the released models; new-domain Open-Jev evaluation remains pending.",
            "JF100 is a separate holdout: 100 questions with three option rotations.",
        ],
    }
    output = ROOT / "site/results.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n")
    print(f"Exported {len(models)} model audits and {len(corpora)} corpus manifests.")


if __name__ == "__main__":
    main()
