"""CPU-only launcher regression checks; no GPU, model, or network calls."""

import argparse
from contextlib import ExitStack, redirect_stdout, redirect_stderr
import hashlib
import io
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock

from scripts import run_service_suite as suite


class ServiceSuiteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.policy_path = self.root / "state/auto_research/resource_policy.json"
        self.policy_path.parent.mkdir(parents=True, exist_ok=True)
        self.policy_path.write_text(json.dumps({
            "expected_hostname": "allowed-node", "allowed_gpu_indices": [0, 1, 2, 3],
            "training_gpu_indices": [0, 1, 2], "serial_evaluation_gpu_index": 3,
            "prohibited_nodes": ["forbidden-node"],
        }))
        root_patch = patch.object(suite, "ROOT", self.root)
        root_patch.start()
        self.addCleanup(root_patch.stop)

    def checkpoint(self, tag):
        path = self.root / 'runs' / f'{tag}-pilot-v1' / 'checkpoint'
        path.mkdir(parents=True)
        (path / 'model.json').write_text(json.dumps({'model_id': suite.MODELS[tag], 'revision': 'abc123'}))
        (path / 'temperature.json').write_text(json.dumps({'temperature': 1.25}))
        (path / 'weights.bin').write_bytes(b'local-test-not-model-weights')
        return path

    def test_hash_and_wrong_model(self):
        path = self.checkpoint('2b')
        actual = suite.checkpoint_identity(path, '2b', 'commit')
        digest = hashlib.sha256()
        for item in sorted(path.iterdir()):
            digest.update(item.name.encode() + b'\0' + item.read_bytes())
        self.assertEqual(actual['checkpoint_sha256'], digest.hexdigest())
        (path / 'weights.bin').write_bytes(b'modified')
        self.assertNotEqual(suite.checkpoint_identity(path, '2b', 'commit'), actual)
        with self.assertRaisesRegex(ValueError, 'wrong base model'):
            suite.checkpoint_identity(path, '9b', 'commit')

    def test_bad_temperature(self):
        path = self.checkpoint('2b')
        for value in (0, -1, float('nan'), float('inf'), True):
            (path / 'temperature.json').write_text(json.dumps({'temperature': value}))
            with self.assertRaises(ValueError):
                suite.checkpoint_identity(path, '2b', 'commit')

    def test_gpu_selection_and_busy_rejection(self):
        outputs = ['GPU-target, Test Device, 0, 0\n', 'GPU-other, 99, other-job, 3000\n']
        with patch.object(suite.subprocess, 'check_output', side_effect=outputs):
            result = suite.gpu_snapshot(3)
        self.assertEqual(result['uuid'], 'GPU-target')
        self.assertEqual(result['compute_processes'], [])
        with patch.object(suite, 'gpu_snapshot', return_value=result):
            self.assertEqual(suite.require_free_gpu(3), result)
        result['compute_processes'] = [{'pid': 12}]
        with patch.object(suite, 'gpu_snapshot', return_value=result), self.assertRaisesRegex(RuntimeError, 'occupied'):
            suite.require_free_gpu(3)

    def test_probe_rejects_changed_identity_and_invalid_probability(self):
        expected = suite.checkpoint_identity(self.checkpoint('2b'), '2b', 'commit')
        response = {'model': expected['model'], 'metadata': {key: value for key, value in expected.items() if key != 'model'},
                    'answers': {'identity_probe': {'type': 'noul', 'noul': 0.75}}}
        process = Mock()
        process.poll.return_value = None
        def probe():
            with patch.object(suite, 'urlopen', return_value=io.BytesIO(json.dumps(response).encode())):
                return suite.probe_identity(process, expected)
        self.assertEqual(probe(), response)
        response['metadata']['checkpoint_sha256'] = 'wrong'
        with self.assertRaisesRegex(RuntimeError, 'does not match'):
            probe()
        response['metadata']['checkpoint_sha256'] = expected['checkpoint_sha256']
        for value in (float('nan'), float('inf'), -0.2, 1.2, True, '0.5'):
            response['answers']['identity_probe']['noul'] = value
            with self.assertRaisesRegex(RuntimeError, 'finite Noul'):
                probe()

    def test_readiness_requires_own_log(self):
        path = self.root / 'server.log'
        path.write_text('unrelated startup\n')
        self.assertFalse(suite.ready_line(path, suite.MODELS['2b']))
        path.write_text(json.dumps({'url': suite.BASE, 'model': suite.MODELS['2b'], 'method': suite.METHOD}) + '\n')
        self.assertTrue(suite.ready_line(path, suite.MODELS['2b']))
        self.assertFalse(suite.ready_line(path, suite.MODELS['9b']))
        process = Mock()
        process.poll.return_value = 9
        process.returncode = 9
        with patch.object(suite, 'urlopen') as request, self.assertRaisesRegex(RuntimeError, 'server exited 9'):
            suite.wait_ready(process, path, {'model': suite.MODELS['2b']}, 1)
        request.assert_not_called()

    def test_command_workloads(self):
        args = argparse.Namespace(include_doom=True, workflow_cases=Path('cases'), frontier_source=Path('frontier'),
                                  measurements=list(suite.MEASUREMENTS))
        commands = dict(suite.measurement_commands(args, Path('output'), suite.MODELS['2b'], Path('checkpoint')))
        self.assertEqual(list(commands), ['demo_requests', 'workflows', 'frontier_100', 'games'])
        self.assertIn('--include-doom', commands['games'])
        self.assertEqual(commands['games'][commands['games'].index('--doom-decision-mode') + 1], 'combined-v1')
        self.assertIn('10001,10002,10003', commands['games'])
        self.assertIn('40', commands['games'])
        self.assertIn('12', commands['workflows'])
        self.assertIn('ood', commands['workflows'])
        for name in ('workflows', 'frontier_100', 'games'):
            self.assertIn(suite.MODELS['2b'], commands[name])
            self.assertIn(suite.METHOD, commands[name])

    def test_typed_doom_mode_reaches_game_evaluator(self):
        args = argparse.Namespace(include_doom=True, doom_decision_mode='typed-v1',
                                  workflow_cases=Path('cases'), frontier_source=Path('frontier'),
                                  measurements=['games'])
        command = dict(suite.measurement_commands(args, Path('output'), suite.MODELS['2b'], Path('checkpoint')))['games']
        self.assertEqual(command[command.index('--doom-decision-mode') + 1], 'typed-v1')

    def test_cli_guard_before_gpu_and_children(self):
        for extra in (["--expected-hostname", "different-node"],
                      ["--expected-hostname", "unallocated-node", "--gpu", "0"],
                      ["--expected-hostname", "unallocated-node"]):
            with patch.object(suite.socket, "gethostname", return_value="unallocated-node"), \
                    patch.object(suite, "gpu_snapshot") as gpu, \
                    patch.object(suite.subprocess, "Popen") as spawn, redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as raised:
                    suite.main([*extra, "--output-root", str(self.root / "output")])
                self.assertEqual(raised.exception.code, 2)
            gpu.assert_not_called()
            spawn.assert_not_called()

    def test_binding_policy_cannot_override_hostname_or_training_card(self):
        policy_path = self.root / 'state/auto_research/resource_policy.json'
        policy_path.parent.mkdir(parents=True, exist_ok=True)
        policy = {'expected_hostname': 'allowed-node', 'allowed_gpu_indices': [0, 1, 2, 3],
                  'training_gpu_indices': [0, 1, 2], 'serial_evaluation_gpu_index': 3,
                  'prohibited_nodes': ['forbidden-node']}
        policy_path.write_text(json.dumps(policy))
        with patch.object(suite, 'ROOT', self.root):
            with patch.object(suite.socket, 'gethostname', return_value='allowed-node'):
                result = suite.enforce_resource_policy(3, 'allowed-node')
                self.assertEqual(result['sha256'], hashlib.sha256(policy_path.read_bytes()).hexdigest())
                with self.assertRaises(ValueError):
                    suite.enforce_resource_policy(3, 'arbitrary-node')
                with self.assertRaises(ValueError):
                    suite.enforce_resource_policy(0, 'allowed-node')
            with patch.object(suite.socket, 'gethostname', return_value='arbitrary-node'), self.assertRaises(ValueError):
                suite.enforce_resource_policy(3, 'arbitrary-node')

    def test_nan_timeout_rejected_on_authorized_host(self):
        for flag in ('--startup-timeout', '--measurement-timeout'):
            with patch.object(suite.socket, 'gethostname', return_value='allowed-node'), \
                 patch.object(suite, 'gpu_snapshot') as gpu, patch.object(suite.subprocess, 'Popen') as spawn, \
                 redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as raised:
                    suite.main(['--expected-hostname', 'allowed-node', '--output-root', str(self.root / 'output'), flag, 'nan'])
                self.assertEqual(raised.exception.code, 2)
            gpu.assert_not_called()
            spawn.assert_not_called()

    def test_nonpositive_server_capacity_rejected_before_gpu_or_spawn(self):
        for flag in ("--max-length", "--batch-size"):
            for value in ("0", "-1"):
                with patch.object(suite.socket, "gethostname", return_value="allowed-node"), \
                        patch.object(suite, "gpu_snapshot") as gpu, \
                        patch.object(suite.subprocess, "Popen") as spawn, redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit) as raised:
                        suite.main(["--expected-hostname", "allowed-node", "--output-root",
                                    str(self.root / "output"), flag, value])
                    self.assertEqual(raised.exception.code, 2)
                gpu.assert_not_called()
                spawn.assert_not_called()

    def test_measurement_exit_and_live_pid_record(self):
        updates, record = [], {}
        result = suite.run_measurement([sys.executable, '-c', 'raise SystemExit(7)'], self.root / 'fail.log', os.environ, 5,
                                       record=record, update=lambda: updates.append(dict(record)))
        self.assertIs(result, record)
        self.assertEqual(record['exit_code'], 7)
        self.assertEqual(record['child_exit_code'], 7)
        self.assertIn('pid', updates[0])
        self.assertNotIn('exit_code', updates[0])
        self.assertIn('ended_at_utc', updates[-1])

    def test_measurement_timeout_reaps_own_child(self):
        record = suite.run_measurement([sys.executable, '-c', 'import time; time.sleep(5)'], self.root / 'timeout.log', os.environ, 0.05)
        self.assertEqual(record['exit_code'], 124)
        self.assertTrue(record['timeout'])
        self.assertEqual(record['child_exit_code'], -signal.SIGTERM)
        with self.assertRaises(ProcessLookupError):
            os.kill(record['pid'], 0)

    def test_measurement_interrupt_recorded_and_reaped(self):
        process = Mock()
        process.pid = 123
        process.poll.return_value = None
        process.wait.side_effect = [KeyboardInterrupt('test interruption'), -15, -15]
        updates, record = [], {}
        with patch.object(suite.subprocess, 'Popen', return_value=process), self.assertRaises(KeyboardInterrupt):
            suite.run_measurement(['test-child'], self.root / 'interrupt.log', {}, 5,
                                  record=record, update=lambda: updates.append(dict(record)))
        self.assertEqual(record['exit_code'], 130)
        self.assertEqual(record['child_exit_code'], -15)
        self.assertEqual(record['error_type'], 'KeyboardInterrupt')
        process.terminate.assert_called_once()
        self.assertEqual(len(updates), 2)

    def test_existing_measurement_logs_not_overwritten(self):
        path = self.root / 'old.log'
        path.write_text('keep')
        with patch.object(suite.subprocess, 'Popen') as spawn, self.assertRaises(FileExistsError):
            suite.run_measurement(['test-child'], path, {}, 5)
        spawn.assert_not_called()
        self.assertEqual(path.read_text(), 'keep')

    def run_main_mocked(self, *, mismatch=False, capacity=None, measurements=None, include_latency=True, models=None):
        for tag in suite.MODELS if models is None else models:
            self.checkpoint(tag)
        frontier = self.root / 'frontier'
        frontier.mkdir()
        cases = self.root / 'cases.jsonl'
        if measurements is None or "workflows" in measurements:
            cases.write_text('{}\n')
        browser_cases = self.root / 'browser_cases.jsonl'
        if measurements is not None and "browser" in measurements:
            browser_cases.write_text('{}\n')
        drone_cases = self.root / 'drone_cases.jsonl'
        if measurements is not None and "drone" in measurements:
            drone_cases.write_text('{}\n')
        request = self.root / 'request.json'
        request.write_text('{}\n')
        output = self.root / 'output'
        active, servers, phases, envs = [], [], [], []
        snapshot = {'physical_gpu': 3, 'uuid': 'GPU-physical-three', 'name': 'Test GPU', 'memory_used_mib': 0,
                    'utilization_percent': 0, 'compute_processes': []}
        class Server:
            def __init__(inner, command, **kwargs):
                self.assertFalse(active)
                inner.command = command
                inner.pid = 1000 + len(servers)
                inner.returncode = None
                active.append(inner)
                servers.append(inner)
                envs.append(kwargs['env'].copy())
            def poll(inner):
                return inner.returncode
            def terminate(inner):
                inner.returncode = -15
                active.remove(inner)
            def wait(inner, timeout=None):
                return inner.returncode
            def kill(inner):
                raise AssertionError('normal cleanup should not need kill')
        def free(gpu, **kwargs):
            self.assertEqual(gpu, 3)
            self.assertFalse(active)
            return snapshot.copy()
        def loaded(gpu):
            self.assertEqual(gpu, 3)
            return {**snapshot, 'compute_processes': [{'pid': active[0].pid}]}
        probe_count = [0]
        expected = {}
        def probe(server, identity):
            self.assertIn(server, active)
            probe_count[0] += 1
            if mismatch and probe_count[0] == 2:
                raise RuntimeError('test identity mismatch')
            expected.clear()
            expected.update(identity)
            return {'model': identity['model'], 'metadata': {k: v for k, v in identity.items() if k != 'model'}}
        def measure(command, log, env, timeout, *, record, update):
            phase = log.stem
            if phase == 'latency':
                self.assertFalse(active)
            else:
                self.assertEqual(len(active), 1)
            self.assertEqual(env['CUDA_VISIBLE_DEVICES'], 'GPU-physical-three')
            phases.append(phase)
            record.update(command=command, pid=2000 + len(phases), exit_code=7 if phase == 'workflows' else 0)
            update()
            if phase == 'demo_requests':
                response = {'model': expected['model'], 'metadata': {k: v for k, v in expected.items() if k != 'model'}}
                log.with_suffix('.jsonl').write_text(json.dumps({'response': response}) + '\n')
            return record
        args = ['--expected-hostname', 'allowed-node', '--checkpoint-root', str(self.root / 'runs'),
                '--frontier-source', str(frontier), '--workflow-cases', str(cases),
                '--browser-cases', str(browser_cases), '--drone-cases', str(drone_cases), '--output-root', str(output)]
        if include_latency:
            args.extend(["--include-latency", "--latency-request", str(request)])
        if capacity:
            args.extend(["--max-length", str(capacity[0]), "--batch-size", str(capacity[1])])
        if measurements is not None:
            args.extend(["--measurements", *measurements])
        if models is not None:
            args.extend(["--models", *models])
        with ExitStack() as stack:
            for name, value in [('require_free_gpu', free), ('gpu_snapshot', loaded), ('require_free_port', Mock()),
                                ('wait_ready', Mock(return_value={'status': 'ready'})), ('probe_identity', probe), ('run_measurement', measure)]:
                stack.enter_context(patch.object(suite, name, value))
            stack.enter_context(patch.object(suite.subprocess, 'Popen', Server))
            stack.enter_context(patch.object(suite.subprocess, 'check_output', return_value='test-commit\n'))
            stack.enter_context(patch.object(suite.socket, 'gethostname', return_value='allowed-node'))
            # Never acquire or overwrite the live launcher's advisory lock.
            stack.enter_context(patch.object(suite, "open", create=True,
                                            side_effect=lambda *args, **kwargs: (self.root / "suite.lock").open("a+")))
            stack.enter_context(patch.object(suite.signal, 'signal'))
            stack.enter_context(redirect_stdout(io.StringIO()))
            if mismatch:
                with self.assertRaisesRegex(RuntimeError, 'test identity mismatch'):
                    suite.main(args)
            else:
                expected_failure = measurements is None or "workflows" in measurements
                self.assertEqual(suite.main(args), int(expected_failure))
            manifest = json.loads((output / 'manifest.json').read_text())
            count = len(servers)
            with self.assertRaises(FileExistsError):
                suite.main(args)
            self.assertEqual(len(servers), count)
        self.assertFalse(active)
        self.assertTrue(all(server.returncode == -15 for server in servers))
        self.assertTrue(all(env['HF_HUB_OFFLINE'] == env['TRANSFORMERS_OFFLINE'] == '1' for env in envs))
        self.assertTrue(all(env['CUDA_VISIBLE_DEVICES'] == snapshot['uuid'] for env in envs))
        return manifest, servers, phases

    def test_three_models_serial_semantic_failure_continues_latency_last(self):
        manifest, servers, measurements = self.run_main_mocked()
        self.assertEqual(len(servers), 3)
        self.assertEqual(measurements, ['demo_requests', 'workflows', 'frontier_100', 'games'] * 3 + ['latency'])
        self.assertEqual(manifest['status'], 'complete_with_measurement_failures')
        self.assertEqual(manifest['current_phase'], 'finished')
        self.assertEqual(manifest['child_cuda_visible_devices'], 'GPU-physical-three')
        self.assertEqual(set(manifest['models']), {'2b', '9b', '27b'})

    def test_identity_mismatch_stops_and_cleans_server(self):
        manifest, servers, measurements = self.run_main_mocked(mismatch=True)
        self.assertEqual(len(servers), 1)
        self.assertEqual(measurements, ['demo_requests'])
        self.assertEqual(manifest['status'], 'failed')
        self.assertIn('test identity mismatch', manifest['error'])
        self.assertEqual(manifest['models']['2b']['server_exit_code'], -15)

    def test_larger_capacity_reaches_every_server_and_identity(self):
        manifest, servers, _ = self.run_main_mocked(capacity=(16384, 4))
        self.assertEqual(manifest["configuration"]["max_length"], 16384)
        self.assertEqual(manifest["configuration"]["batch_size"], 4)
        for server in servers:
            self.assertEqual(server.command[server.command.index("--max-length") + 1], "16384")
            self.assertEqual(server.command[server.command.index("--batch-size") + 1], "4")
        for report in manifest["models"].values():
            self.assertEqual(report["expected_identity"]["max_length"], 16384)

    def test_frontier_only_runs_all_three_checkpoints_without_workflow_input(self):
        manifest, servers, measurements = self.run_main_mocked(
            capacity=(16384, 1), measurements=["frontier_100"], include_latency=False)
        self.assertEqual(len(servers), 3)
        self.assertEqual(measurements, ["frontier_100"] * 3)
        self.assertEqual(manifest["status"], "complete")
        self.assertEqual(manifest["configuration"]["measurements"], ["frontier_100"])
        self.assertNotIn("latency", manifest)
        self.assertFalse((self.root / "cases.jsonl").exists())
        for report in manifest["models"].values():
            self.assertEqual(set(report["measurements"]), {"frontier_100"})
            self.assertEqual(report["expected_identity"]["max_length"], 16384)
            command = report["measurements"]["frontier_100"]["command"]
            self.assertEqual(command[command.index("-m") + 1], "jev.eval_frontier")
            self.assertNotIn("--limit", command)
        for server in servers:
            self.assertEqual(server.command[server.command.index("--batch-size") + 1], "1")

    def test_selected_checkpoint_does_not_require_other_model_files(self):
        manifest, servers, measurements = self.run_main_mocked(
            measurements=["frontier_100"], include_latency=False, models=["9b"])
        self.assertEqual(len(servers), 1)
        self.assertEqual(measurements, ["frontier_100"])
        self.assertEqual(manifest["configuration"]["models"], ["9b"])
        self.assertEqual(list(manifest["models"]), ["9b"])
        self.assertEqual(manifest["status"], "complete")
        self.assertFalse((self.root / "runs/2b-pilot-v1").exists())
        self.assertFalse((self.root / "runs/27b-pilot-v1").exists())

    def test_repeated_or_unknown_model_rejected_before_gpu_or_spawn(self):
        for models in (["2b", "2b"], ["unknown"]):
            with patch.object(suite.socket, "gethostname", return_value="allowed-node"), \
                    patch.object(suite, "gpu_snapshot") as gpu, \
                    patch.object(suite.subprocess, "Popen") as spawn, redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as raised:
                    suite.main(["--expected-hostname", "allowed-node", "--output-root",
                                str(self.root / "output"), "--models", *models])
                self.assertEqual(raised.exception.code, 2)
            gpu.assert_not_called()
            spawn.assert_not_called()

    def test_browser_only_passes_checkpoint_identity_without_workflow_input(self):
        manifest, servers, measurements = self.run_main_mocked(
            measurements=["browser"], include_latency=False, models=["2b"])
        self.assertEqual(len(servers), 1)
        self.assertEqual(measurements, ["browser"])
        self.assertEqual(manifest["status"], "complete")
        report = manifest["models"]["2b"]
        command = report["measurements"]["browser"]["command"]
        self.assertEqual(command[command.index("-m") + 1], "scripts.evaluate_browser_service")
        for flag, key in (("--expected-revision", "base_revision"),
                          ("--expected-checkpoint-sha256", "checkpoint_sha256")):
            self.assertEqual(command[command.index(flag) + 1], report["expected_identity"][key])
        self.assertFalse((self.root / "cases.jsonl").exists())

    def test_missing_browser_cases_rejected_before_gpu_or_spawn(self):
        with patch.object(suite.socket, "gethostname", return_value="allowed-node"), \
                patch.object(suite, "gpu_snapshot") as gpu, \
                patch.object(suite.subprocess, "Popen") as spawn, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as raised:
                suite.main(["--expected-hostname", "allowed-node", "--output-root", str(self.root / "output"),
                            "--measurements", "browser", "--browser-cases", str(self.root / "missing.jsonl")])
            self.assertEqual(raised.exception.code, 2)
        gpu.assert_not_called()
        spawn.assert_not_called()

    def test_drone_only_pins_identity_and_keeps_gpu_cleanup(self):
        manifest, servers, measurements = self.run_main_mocked(
            measurements=["drone"], include_latency=False, models=["27b"])
        self.assertEqual(len(servers), 1)
        self.assertEqual(measurements, ["drone"])
        self.assertEqual(manifest["status"], "complete")
        report = manifest["models"]["27b"]
        command = report["measurements"]["drone"]["command"]
        self.assertEqual(command[command.index("-m") + 1], "scripts.evaluate_drone_service")
        self.assertEqual(command[command.index("--cases") + 1], str((self.root / "drone_cases.jsonl").resolve()))
        for flag, key in (("--expected-revision", "base_revision"),
                          ("--expected-checkpoint-sha256", "checkpoint_sha256")):
            self.assertEqual(command[command.index(flag) + 1], report["expected_identity"][key])
        self.assertEqual(report["server_exit_code"], -15)
        self.assertFalse((self.root / "cases.jsonl").exists())
        self.assertFalse((self.root / "browser_cases.jsonl").exists())

    def test_missing_drone_cases_rejected_before_gpu_or_spawn(self):
        with patch.object(suite.socket, "gethostname", return_value="allowed-node"), \
                patch.object(suite, "gpu_snapshot") as gpu, \
                patch.object(suite.subprocess, "Popen") as spawn, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as raised:
                suite.main(["--expected-hostname", "allowed-node", "--output-root", str(self.root / "output"),
                            "--measurements", "drone", "--drone-cases", str(self.root / "missing.jsonl")])
            self.assertEqual(raised.exception.code, 2)
        gpu.assert_not_called()
        spawn.assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
