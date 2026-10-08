import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient
from qiskit.providers.fake_provider import GenericBackendV2

from backend import ibm_adapter
from backend import trex_api
from backend.app import app
from backend.trex_demo.src import analysis, calibration, circuits, game, noise, runner


class CalibrationTests(unittest.TestCase):
    def test_hand_computed_inversion(self):
        a = calibration.assignment_matrix_1q(p01=0.2, p10=0.1)
        true = np.array([0.3, 0.7])
        np.testing.assert_allclose(calibration.invert_correct(a, a @ true), true, atol=1e-9)

    def test_nnls_stays_physical_where_inversion_does_not(self):
        matrix = np.array([[0.9, 0.85], [0.1, 0.15]])
        measured = np.array([0.5, 0.5])
        self.assertLess(calibration.invert_correct(matrix, measured).min(), 0)
        fixed = calibration.nnls_correct(matrix, measured)
        self.assertGreaterEqual(fixed.min(), -1e-9)
        self.assertAlmostEqual(fixed.sum(), 1.0, places=9)


class LevelTests(unittest.TestCase):
    def test_bias_and_crowd_levels_pass(self):
        self.assertTrue(game.play('bias')['passed'])
        self.assertTrue(game.play('crowd')['passed'])

    def test_crosstalk_level_needs_the_correlated_calibration(self):
        tensored = game.play('crosstalk', calibration_mode='tensored')
        correlated = game.play('crosstalk', calibration_mode='correlated')
        self.assertFalse(tensored['passed'], 'the cheap calibration should not fix a correlated error')
        self.assertTrue(correlated['passed'], 'the full calibration should fix it')
        self.assertEqual(tensored['calibration_circuits_used'], 2)
        self.assertEqual(correlated['calibration_circuits_used'], 16)

    def test_ghz_level_flags_unphysical_inversion_and_nnls_fixes_it(self):
        result = game.play('ghz', calibration_mode='correlated')
        self.assertGreater(result['inverted_negative_mass'], 0)
        self.assertLess(abs(result['parity_corrected'] - 1.0), abs(result['parity_raw'] - 1.0))

    def test_play_is_deterministic_given_a_seed(self):
        self.assertEqual(game.play('bias'), game.play('bias'))

    def test_level_rejects_an_unsupported_calibration_mode(self):
        with self.assertRaises(ValueError):
            game.play('bias', calibration_mode='correlated')


class HardwareBuildTests(unittest.TestCase):
    def backend(self, qubits=5):
        return GenericBackendV2(qubits, basis_gates=['cx', 'rz', 'sx', 'x'], seed=42)

    def test_circuit_counts_depend_on_calibration_mode(self):
        tensored = runner.build_circuits(self.backend(), 3, 'tensored')
        self.assertEqual(tensored['calibration_circuits_used'], 2)
        correlated = runner.build_circuits(self.backend(), 3, 'correlated')
        self.assertEqual(correlated['calibration_circuits_used'], 8)

    def test_correlated_qubit_cap_is_enforced(self):
        with self.assertRaises(ValueError):
            runner.build_circuits(self.backend(), runner.MAX_CORRELATED_QUBITS + 1, 'correlated')


class TrexAPITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.data = patch.object(trex_api, 'DATA', Path(self.temp.name) / 'runs')
        self.data.start()
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.data.stop()
        self.temp.cleanup()

    def test_levels(self):
        body = self.client.get('/api/trex/levels').json()
        self.assertEqual([level['id'] for level in body['levels']], ['bias', 'crowd', 'crosstalk', 'ghz'])
        self.assertIn('ibm_enabled', body)

    def test_play_scores_the_levels(self):
        tensored = self.client.post('/api/trex/play', json={'level': 'crosstalk'}).json()
        self.assertFalse(tensored['passed'])
        correlated = self.client.post('/api/trex/play',
                                      json={'level': 'crosstalk', 'calibration_mode': 'correlated'}).json()
        self.assertTrue(correlated['passed'])

    def test_explore_runs_a_custom_scenario(self):
        body = self.client.post('/api/trex/explore', json={'qubits': 3}).json()
        self.assertEqual(body['qubits'], 3)
        self.assertIn('corrected_distribution', body)

    def test_request_validation(self):
        bad_play = [{'level': 'nope'}, {'level': 'bias', 'calibration_mode': 'nope'}]
        for body in bad_play:
            self.assertEqual(self.client.post('/api/trex/play', json=body).status_code, 422, body)
        bad_explore = [{'qubits': 0}, {'qubits': game.MAX_SANDBOX_QUBITS + 1}, {'shots': 10}, {'shots': 50000},
                      {'qubits': 2, 'per_qubit_errors': [[0.1, 0.1]]}]
        for body in bad_explore:
            self.assertEqual(self.client.post('/api/trex/explore', json=body).status_code, 422, body)

    def test_dataset_listing_and_lookup(self):
        results = Path(self.temp.name) / 'results'
        name = 'trex_fake_torino_20260101-120000'
        analysis.save_json(results / (name + '.json'), {'backend': 'fake_torino', 'qubits': 2,
                                                         'calibration_mode': 'tensored', 'shots': 64,
                                                         'corrected_total_variation': 0.01})
        with patch.object(trex_api, 'RESULTS', results):
            listing = self.client.get('/api/trex/hardware').json()
            self.assertEqual([d['id'] for d in listing['datasets']], [name])
            self.assertTrue(listing['datasets'][0]['simulated'])
            self.assertEqual(self.client.get('/api/trex/hardware/' + name).json()['qubits'], 2)
            for bad in ('nope', '..%2F..%2Fapp', 'trex_x_1'):
                self.assertEqual(self.client.get('/api/trex/hardware/' + bad).status_code, 404)

    def test_ibm_runs_are_gated(self):
        with patch.dict(os.environ, {'IBM_ENABLE': 'false'}):
            self.assertEqual(self.client.post('/api/trex/hardware/runs', json={}).status_code, 403)
        with patch.dict(os.environ, {'IBM_ENABLE': 'true', 'IBM_QUANTUM_TOKEN': '', 'IBM_BACKEND': ''}):
            self.assertEqual(self.client.post('/api/trex/hardware/runs', json={}).status_code, 503)
        with patch.dict(os.environ, {'IBM_ENABLE': 'true', 'IBM_QUANTUM_TOKEN': 't',
                                     'IBM_QUANTUM_INSTANCE': '', 'IBM_BACKEND': 'b'}), \
             patch.object(trex_api.POOL, 'submit'):
            self.assertEqual(self.client.post('/api/trex/hardware/runs', json={}).status_code, 202)
        self.assertEqual(self.client.post('/api/trex/hardware/runs',
                                          json={'qubits': runner.MAX_CORRELATED_QUBITS + 1}).status_code, 422)
        self.assertEqual(self.client.get('/api/trex/hardware/runs/not-a-uuid').status_code, 404)

    def test_ibm_submit_poll_and_save_without_network(self):
        backend = GenericBackendV2(5, basis_gates=['cx', 'rz', 'sx', 'x'], seed=42)
        submitted = []

        class FakeSampler:
            def __init__(self, mode):
                self.options = SimpleNamespace(
                    dynamical_decoupling=SimpleNamespace(enable=True),
                    twirling=SimpleNamespace(enable_gates=True, enable_measure=True))

            def run(self, circuits, shots):
                submitted.append({'circuits': circuits, 'shots': shots,
                                  'dd': self.options.dynamical_decoupling.enable,
                                  'gates': self.options.twirling.enable_gates,
                                  'measure': self.options.twirling.enable_measure})
                return SimpleNamespace(job_id=lambda: 'job-1')

        # 2 calibration circuits (tensored) + 1 target circuit.
        calibration_counts = [{'0000': 100}, {'1111': 90, '1110': 10}]
        target_counts = {'0000': 48, '1111': 44, '0001': 8}
        pubs = [SimpleNamespace(data=SimpleNamespace(meas=SimpleNamespace(get_counts=lambda c=c: c)))
                for c in calibration_counts + [target_counts]]
        state = {'status': 'QUEUED'}
        job = SimpleNamespace(status=lambda: state['status'], result=lambda: pubs)
        service = SimpleNamespace(backend=lambda name: backend, job=lambda job_id: job)
        env = {'IBM_ENABLE': 'true', 'IBM_QUANTUM_TOKEN': 't', 'IBM_BACKEND': 'generic'}
        results = Path(self.temp.name) / 'results'
        with patch.dict(os.environ, env), patch.object(ibm_adapter, 'service', return_value=service), \
             patch.object(runner, 'SamplerV2', FakeSampler), \
             patch.object(trex_api, 'RESULTS', results), \
             patch.object(trex_api.POOL, 'submit', side_effect=lambda fn, *args: fn(*args)):
            body = {'qubits': 4, 'calibration_mode': 'tensored', 'shots': 100}
            run = self.client.post('/api/trex/hardware/runs', json=body).json()
            self.assertEqual(self.client.post('/api/trex/hardware/runs', json=body).status_code, 409)
            queued = self.client.get('/api/trex/hardware/runs/' + run['id']).json()
            self.assertEqual(queued['status'], 'queued')
            self.assertEqual(queued['job_id'], 'job-1')
            self.assertEqual(queued['calibration_circuits_used'], 2)
            state['status'] = 'DONE'
            done = self.client.get('/api/trex/hardware/runs/' + run['id']).json()
            self.assertEqual(done['status'], 'completed')
            data = self.client.get('/api/trex/hardware/' + done['dataset_id']).json()

        self.assertEqual(len(submitted), 1)
        self.assertEqual(submitted[0]['shots'], 100)
        self.assertEqual(len(submitted[0]['circuits']), 3)  # 2 calibration + 1 target
        self.assertFalse(submitted[0]['dd'])
        self.assertFalse(submitted[0]['gates'])
        self.assertFalse(submitted[0]['measure'])
        self.assertEqual(data['backend'], 'generic_backend_5q')
        self.assertEqual(data['calibration_counts'], calibration_counts)
        self.assertEqual(data['target_counts'], target_counts)
        saved = json.loads((results / (done['dataset_id'] + '.json')).read_text(encoding='utf-8'))
        self.assertEqual(saved['target_counts'], target_counts)

    def test_failed_ibm_submission_is_reported(self):
        env = {'IBM_ENABLE': 'true', 'IBM_QUANTUM_TOKEN': 't', 'IBM_BACKEND': 'generic'}
        backend = GenericBackendV2(2, basis_gates=['cx', 'rz', 'sx', 'x'], seed=42)
        with patch.dict(os.environ, env), \
             patch.object(ibm_adapter, 'service', return_value=SimpleNamespace(backend=lambda name: backend)), \
             patch.object(trex_api.POOL, 'submit', side_effect=lambda fn, *args: fn(*args)), \
             self.assertLogs(level='ERROR'):
            run = self.client.post('/api/trex/hardware/runs', json={'qubits': 4}).json()
            failed = self.client.get('/api/trex/hardware/runs/' + run['id']).json()
        self.assertEqual(failed['status'], 'failed')
        self.assertIn('IBM submission failed', failed['error'])


if __name__ == '__main__':
    unittest.main()
