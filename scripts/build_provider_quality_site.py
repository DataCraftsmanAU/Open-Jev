"""Publish aggregate quality counts from saved, hash-bound provider reports."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

REPORTS = Path('reports/provider-comparison-20260920')
PUBLIC = 'https://github.com/Zefan-Cai/Open-Jev/blob/main/'
PROVIDERS = [
    {'id': '2b', 'name': 'Open-Jev-2B'},
    {'id': '9b', 'name': 'Open-Jev-9B'},
    {'id': 'jev', 'name': 'Jev 1.13.0'},
    {'id': 'luna', 'name': 'GPT-5.6 Luna (none)'},
    {'id': 'astra', 'name': 'GPT-6 Astra (low)'},
]


def identity(row):
    return row['request_id'], row.get('question_id', 'decision')


def report_path(provider, suite):
    if provider in ('2b', '9b'):
        return REPORTS / f'{provider}-coverage-quality-archive.json' if suite == 'coverage' else None
    prefix = {'jev': 'jev', 'luna': 'openai-gpt-5.6-luna', 'astra': 'openai-gpt-6-astra'}[provider]
    return REPORTS / f'{prefix}-{suite}-quality.json'


def read_report(root, relative):
    if relative is None or not (root / relative).exists():
        return None
    value = json.loads((root / relative).read_bytes())
    rows = value['rows']
    if len({identity(r) for r in rows}) != len(rows):
        raise ValueError(f'Duplicate decisions: {relative}')
    hard = [r for r in rows if r['hard_target']]
    if (len(hard) != value['overall']['hard_targets'] or
            sum(r['correct'] for r in hard) != value['overall']['hard_correct']):
        raise ValueError(f'Aggregate disagrees with actual rows: {relative}')
    return value


def build(root):
    archives = [read_report(root, report_path(p, 'coverage')) for p in ('2b', '9b')]
    if any(a is None for a in archives):
        raise ValueError('Both verified historical coverage reports are required')
    common = {identity(r) for r in archives[0]['rows'] if r['hard_target']}
    if common != {identity(r) for r in archives[1]['rows'] if r['hard_target']} or len(common) != 76:
        raise ValueError('The frozen common 76-case archive changed')
    reference = {identity(r): r for r in archives[0]['rows']}
    specifications = [
        ('matched-coverage', 'Same 76 coverage decisions', 'coverage', 76, 0, 76,
         'Exactly the same hard cases for every provider. Released 2B/9B predictions are reused after exact row/checkpoint/hash verification; they are not new inference or latency measurements.'),
        ('coverage', 'Broader domain coverage', 'coverage', 140, 6, 189,
         '146 labelled decisions and 43 unlabelled saved examples. Six soft targets and the unlabelled examples are excluded from hard accuracy. The released models still need 64 newer hard cases.'),
        ('jf100', 'Jev Frontier 100', 'jf100', 300, 0, 300,
         '100 external holdout items in three candidate rotations; 300 correlated decisions, not 300 independent problems.'),
        ('ir-pilot', 'Graded retrieval controls', 'ir-pilot', 165, 9, 132,
         'Six original queries across three families, with 8 passages per query. Hard categorical decisions only; nine tied-best soft targets are separate. This is not TREC or full heap-reranking quality.'),
        ('fizzbuzz', 'FizzBuzz controls', 'fizzbuzz', 300, 0, 100,
         'Integers 1-100, each with two Nouls and one Choice. Original probe; the community post did not supply a complete prompt to reproduce.'),
        ('mailroom', 'Multilingual mailroom controls', 'mailroom', 921, 0, 87,
         '87 requests with 11 heads each. The category of 36 non-bill messages has no gold and is excluded. 921 supervised decisions, with shared families and repeated inputs; not end-to-end email automation.'),
    ]
    suites, evidence = [], {}
    for sid, label, source_suite, planned, soft, requests, note in specifications:
        results = {}
        for provider in PROVIDERS:
            pid = provider['id']
            relative = report_path(pid, source_suite)
            report = read_report(root, relative)
            rows = [] if report is None else [r for r in report['rows'] if r['hard_target']]
            if sid == 'matched-coverage':
                rows = [r for r in rows if identity(r) in common]
                for row in rows:
                    expected = reference[identity(row)]
                    if any(row[k] != expected[k] for k in ('target', 'source', 'kind')):
                        raise ValueError('Common-case gold differs across providers')
            if len(rows) > planned:
                raise ValueError(f'Unexpected suite expansion: {pid}/{sid}')
            pending = planned - len(rows)
            result = {'status': 'pending' if not rows else 'partial' if pending else 'complete',
                      'correct': sum(r['correct'] for r in rows), 'total': len(rows),
                      'planned': planned, 'pending': pending,
                      'errors': sum(not r['success'] for r in rows),
                      'strict_probability_mass_failures_counted_categorically':
                          sum(r.get('strict_probability_mass_failure', False) for r in rows)}
            if report is not None:
                result['evidence_url'] = PUBLIC + str(relative)
                evidence[str(relative)] = hashlib.sha256((root / relative).read_bytes()).hexdigest()
                if sid != 'matched-coverage':
                    result['by_source'] = report['by_source']
            results[pid] = result
        suites.append({'id': sid, 'label': label, 'hard_targets': planned, 'soft_targets': soft,
                       'requests': requests, 'note': note, 'results': results})
    return {'schema_version': 1, 'generated_at': datetime.now(timezone.utc).isoformat(),
            'status': 'partial', 'providers': PROVIDERS, 'suites': suites,
            'scope': 'Fixed coverage checks and separate probes. Counts match the frozen supplied labels; a post-hoc audit flags six game references and one customer rubric ambiguity. Common-case sensitivity counts with identical exclusions are available in the method; primary counts stay unchanged. The 73,333-row full test/OOD registry remains pending; an additive 107,922-row registry is prepared but not evaluated. These are categorical decisions, not calibrated probabilities or closed-loop game success rates. Failed decisions count as incorrect; unattempted decisions remain pending.',
            'decision_policy': 'Choice uses the returned selection. Noul uses argmax of [1-p, p], with exact ties selecting false. Score uses its most probable level; OpenAI returns a categorical integer. Jev probability-mass failures with usable finite choices are reported separately in decision-only analysis; vectors are never renormalized.',
            'method_url': PUBLIC + 'docs/provider-comparison.md',
            'source_report_sha256': evidence,
            'public_data_policy': 'Only derived results and hashes are published here. Original Wikispeedia text in request and raw-response bundles is excluded.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('.'))
    parser.add_argument('--output', type=Path, default=Path('site/provider-quality.json'))
    args = parser.parse_args()
    result = build(args.root)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'output': str(args.output), 'status': result['status'], 'suites': len(result['suites'])}))


if __name__ == '__main__':
    main()
