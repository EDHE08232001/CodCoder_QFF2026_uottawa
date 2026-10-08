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
from qiskit.quantum_info import Operator, Pauli, Statevector
from backend import ibm_adapter
from backend import twirl_api
from backend.app import app
from backend.twirl_demo.src import analysis, game, hardware, noise, problems, twirl

SETTINGS = {'qubits': 4, 'steps': 4, 'field': 0.6, 'randomizations': 16, 'shots': 512}


class TwirlTests(unittest.TestCase):
    def test_every_pauli_frame_leaves_the_gate_unchanged(self):
        for name, gate in twirl.TWIRLED_GATES.items():
            matrix = Operator(gate).data
            table = twirl.frame_table(name)
            self.assertEqual(len(table), 16)
            for before, after in table:
                framed = Pauli(after).to_matrix() @ matrix @ Pauli(before).to_matrix()
                phase = np.trace(matrix.conj().T @ framed)/4
                self.assertAlmostEqual(abs(phase), 1.0, places=9)
                np.testing.assert_allclose(framed, phase*matrix, atol=1e-9)

    def test_witness_kick_is_visible_and_twirling_helps(self):
        bare = problems.witness_circuit(pairs=3, measure=False)
        self.assertAlmostEqual(problems.witness_ideal()['magnetization'], 1.0, places=9)
        np.testing.assert_allclose(Statevector(bare).probabilities()[0], 1.0, atol=1e-12)
        kicked = twirl.inject_z_kicks(bare, problems.WITNESS_ANGLE)
        p_kicked = float(Statevector(kicked).probabilities()[0])
        twirled, _ = twirl.randomizations(bare, 32, np.random.default_rng(0), inject_z=problems.WITNESS_ANGLE)
        p_twirled = float(np.mean([Statevector(circuit).probabilities()[0] for circuit in twirled]))
        self.assertLess(p_kicked, 0.97)
        self.assertGreater(p_twirled, p_kicked + 0.02)

    def test_randomizations_do_not_change_the_ideal_circuit(self):
        bare = problems.quench_circuit(4, 3, 0.6, measure=False)
        reference = Statevector(bare).probabilities()
        circuits, frames = twirl.randomizations(bare, 8, np.random.default_rng(0))
        self.assertTrue(all(len(frame) == twirl.two_qubit_gates(bare) for frame in frames))
        for circuit in circuits:
            np.testing.assert_allclose(Statevector(circuit).probabilities(), reference, atol=1e-12)

    def test_twirling_a_pauli_channel_is_exactly_the_identity(self):
        """The claim behind the 'twirling does nothing' level, without any sampling."""
        from qiskit_aer import AerSimulator
        bare = problems.quench_circuit(3, 2, 0.6, measure=False)
        twirled, _ = twirl.twirl(bare, np.random.default_rng(3))
        for angle, depolarizing, identical in ((0.0, 0.05, True), (0.08, 0.0, False)):
            simulator = AerSimulator(noise_model=noise.noise_model(angle, depolarizing),
                                     method='density_matrix')
            states = []
            for circuit in (bare, twirled):
                saved = circuit.copy()
                saved.save_density_matrix()
                states.append(simulator.run(saved).result().data()['density_matrix'])
            distance = float(np.abs(np.asarray(states[0])-np.asarray(states[1])).sum())
            self.assertEqual(distance < 1e-9, identical, f'angle={angle} depolarizing={depolarizing}')


class ScenarioTests(unittest.TestCase):
    def test_coherent_noise_is_tamed_and_pauli_noise_is_not(self):
        helped = game.play('coherent', **SETTINGS)
        self.assertTrue(helped['comparison']['improved'])
        self.assertLess(helped['twirled']['error'], helped['unmitigated']['error']/3)
        self.assertTrue(helped['passed'])
        untouched = game.play('stochastic', **SETTINGS)
        self.assertTrue(untouched['comparison']['unchanged'])
        self.assertGreater(untouched['unmitigated']['error'], 0.05)

    def test_mixed_noise_keeps_only_its_stochastic_part(self):
        mixed = game.play('mixed', **SETTINGS)
        stochastic = game.play('stochastic', **SETTINGS)
        self.assertTrue(mixed['comparison']['improved'])
        self.assertAlmostEqual(mixed['twirled']['error'], stochastic['twirled']['error'], delta=0.03)

    def test_both_treatments_spend_the_same_shots(self):
        result = game.play('clean', **SETTINGS)
        self.assertEqual(result['unmitigated']['shots'], result['twirled']['shots'])
        self.assertEqual(result['twirled']['shots'], SETTINGS['randomizations']*SETTINGS['shots'])
        self.assertEqual(result['twirled']['circuits'], SETTINGS['randomizations'])

    def test_results_are_deterministic(self):
        self.assertEqual(game.play('coherent', **SETTINGS, seed=5),
                         game.play('coherent', **SETTINGS, seed=5))


class HardwareBuildTests(unittest.TestCase):
    def backend(self, qubits=5):
        return GenericBackendV2(qubits, basis_gates=['cx', 'rz', 'sx', 'x'], seed=42)

    def test_layout_is_a_connected_chain(self):
        backend = self.backend()
        layout = hardware.line_layout(backend, 4)
        edges = {tuple(sorted(edge)) for edge in backend.coupling_map.get_edges()}
        self.assertEqual(len(set(layout)), 4)
        self.assertTrue(all(tuple(sorted(pair)) in edges for pair in zip(layout, layout[1:])))
        with self.assertRaises(ValueError):
            hardware.line_layout(self.backend(2), 4)

    def test_transpiled_frames_stay_in_the_device_basis(self):
        built = hardware.build_circuits(self.backend(), 4, 2, 0.6, randomizations=3)
        self.assertEqual(built['two_qubit_gates'], 12)
        self.assertEqual(built['frames_per_circuit'], 12)
        allowed = set(built['bare'].count_ops()) | {'x', 'rz'}
        for circuit in built['twirled']:
            self.assertEqual(twirl.two_qubit_gates(circuit), 12)
            self.assertLessEqual(set(circuit.count_ops()), allowed)

    def test_ibm_witness_preset_uses_two_qubits(self):
        built = hardware.build_circuits(self.backend(), 4, 2, 0.6, randomizations=3, experiment='witness')
        self.assertEqual(built['experiment'], 'witness')
        self.assertEqual(len(built['layout']), 2)
        self.assertEqual(built['two_qubit_gates'], 12)
        self.assertGreater(built['inject_z'], 0)
        self.assertIn('rz', built['bare'].count_ops())

    def test_untwirlable_two_qubit_gate_is_refused(self):
        backend = GenericBackendV2(5, basis_gates=['iswap', 'rz', 'sx', 'x'], seed=42)
        with self.assertRaises(ValueError):
            hardware.build_circuits(backend, 4, 2, 0.6, randomizations=2)


class TwirlAPITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.data = patch.object(twirl_api, 'DATA', Path(self.temp.name)/'runs')
        self.data.start()
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.data.stop()
        self.temp.cleanup()

    def test_scenarios(self):
        body = self.client.get('/api/twirl/scenarios').json()
        self.assertEqual([s['id'] for s in body['scenarios']],
                         ['coherent', 'stochastic', 'mixed', 'clean'])
        self.assertEqual(body['defaults']['randomizations'], 16)
        self.assertIn('aer_available', body)
        self.assertEqual(body['ibm_preset']['experiment'], 'witness')
        self.assertEqual(body['ibm_preset']['qubits'], 2)
        self.assertEqual(body['ibm_preset']['two_qubit_gates'], 12)

    def test_circuit_preview_proves_the_twirl_is_invisible(self):
        body = self.client.post('/api/twirl/circuit', json={'qubits': 3, 'steps': 2}).json()
        self.assertTrue(body['ideal_match'])
        self.assertEqual(body['frame_count'], 8)
        self.assertEqual(body['bare']['two_qubit_gates'], body['twirled']['two_qubit_gates'])
        self.assertGreater(body['twirled']['gates'], body['bare']['gates'])
        self.assertEqual(len(body['frames']), 8)
        self.assertEqual(set(body['frames'][0]), {'gate', 'qubits', 'before', 'after'})

    def test_play_scores_the_levels(self):
        body = self.client.post('/api/twirl/play', json={'scenario': 'coherent', **SETTINGS}).json()
        self.assertTrue(body['passed'])
        self.assertEqual(body['stars'], 3)
        self.assertEqual(body['backend'], 'aer')
        self.assertEqual(body['two_qubit_gates'], 24)
        self.assertEqual(len(body['twirled']['values']), 16)
        self.assertEqual(len(body['ideal']['distribution']), 16)
        self.assertEqual(self.client.post('/api/twirl/play',
                                          json={'scenario': 'stochastic', **SETTINGS}).json()['passed'], False)

    def test_request_validation(self):
        bad = [{'qubits': 1}, {'qubits': 7}, {'steps': 0}, {'steps': 9}, {'shots': 10},
               {'shots': 5000}, {'randomizations': 0}, {'randomizations': 65},
               {'scenario': 'magic'}, {'coherent_angle': 0.5}, {'depolarizing': 0.5}, {'field': 3}]
        for body in bad:
            self.assertEqual(self.client.post('/api/twirl/play', json=body).status_code, 422, body)
        for body in ({'qubits': 1}, {'steps': 9}):
            self.assertEqual(self.client.post('/api/twirl/circuit', json=body).status_code, 422, body)

    def test_play_reports_a_missing_simulator(self):
        with patch.object(noise, 'aer_available', return_value=False):
            response = self.client.post('/api/twirl/play', json={'scenario': 'clean'})
        self.assertEqual(response.status_code, 503)
        self.assertIn('Aer', response.json()['detail'])

    def test_dataset_listing_and_lookup(self):
        results = Path(self.temp.name)/'results'
        name = 'twirl_aer_20260101-120000'
        analysis.save_json(results/(name+'.json'), {'backend': 'aer', 'qubits': 4, 'steps': 4,
                                                    'field': 0.6, 'randomizations': 2, 'shots': 64,
                                                    'scenario': 'coherent'})
        with patch.object(twirl_api, 'RESULTS', results):
            listing = self.client.get('/api/twirl/hardware').json()
            self.assertEqual([d['id'] for d in listing['datasets']], [name])
            self.assertTrue(listing['datasets'][0]['simulated'])
            self.assertEqual(self.client.get('/api/twirl/hardware/'+name).json()['scenario'], 'coherent')
            for bad in ('nope', '..%2F..%2Fapp', 'twirl_x_1'):
                self.assertEqual(self.client.get('/api/twirl/hardware/'+bad).status_code, 404)

    def test_ibm_runs_are_gated(self):
        with patch.dict(os.environ, {'IBM_ENABLE': 'false'}):
            self.assertEqual(self.client.post('/api/twirl/hardware/runs', json={}).status_code, 403)
        with patch.dict(os.environ, {'IBM_ENABLE': 'true', 'IBM_QUANTUM_TOKEN': '', 'IBM_BACKEND': ''}):
            self.assertEqual(self.client.post('/api/twirl/hardware/runs', json={}).status_code, 503)
        with patch.dict(os.environ, {'IBM_ENABLE': 'true', 'IBM_QUANTUM_TOKEN': 't',
                                     'IBM_QUANTUM_INSTANCE': '', 'IBM_BACKEND': 'b'}), \
             patch.object(twirl_api.POOL, 'submit'):
            self.assertEqual(self.client.post('/api/twirl/hardware/runs', json={}).status_code, 202)
        self.assertEqual(self.client.post('/api/twirl/hardware/runs',
                                          json={'randomizations': 33}).status_code, 422)
        self.assertEqual(self.client.get('/api/twirl/hardware/runs/not-a-uuid').status_code, 404)

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

        # Both halves average to a magnetisation of 0.5, reached in different ways.
        raw = [{'00': 32}, {'01': 32}]
        twirled = [{'00': 24, '11': 8}, {'00': 24, '11': 8}]
        pubs = [SimpleNamespace(data=SimpleNamespace(meas=SimpleNamespace(get_counts=lambda c=c: c)))
                for c in raw+twirled]
        state = {'status': 'QUEUED'}
        job = SimpleNamespace(status=lambda: state['status'], result=lambda: pubs)
        service = SimpleNamespace(backend=lambda name: backend, job=lambda job_id: job)
        env = {'IBM_ENABLE': 'true', 'IBM_QUANTUM_TOKEN': 't', 'IBM_BACKEND': 'generic'}
        results = Path(self.temp.name)/'results'
        with patch.dict(os.environ, env), patch.object(ibm_adapter, 'service', return_value=service), \
             patch.object(hardware, 'SamplerV2', FakeSampler), \
             patch.object(twirl_api, 'RESULTS', results), \
             patch.object(twirl_api.POOL, 'submit', side_effect=lambda fn, *args: fn(*args)):
            body = {'qubits': 4, 'steps': 2, 'randomizations': 2, 'shots': 32}
            run = self.client.post('/api/twirl/hardware/runs', json=body).json()
            self.assertEqual(self.client.post('/api/twirl/hardware/runs', json=body).status_code, 409)
            queued = self.client.get('/api/twirl/hardware/runs/'+run['id']).json()
            self.assertEqual(queued['status'], 'queued')
            self.assertEqual(queued['job_id'], 'job-1')
            self.assertEqual(queued['two_qubit_gates'], 12)
            state['status'] = 'DONE'
            done = self.client.get('/api/twirl/hardware/runs/'+run['id']).json()
            self.assertEqual(done['status'], 'completed')
            data = self.client.get('/api/twirl/hardware/'+done['dataset_id']).json()

        self.assertEqual(len(submitted), 1)
        self.assertEqual(submitted[0]['shots'], 32)
        self.assertEqual(len(submitted[0]['circuits']), 4)  # 2 bare repeats + 2 twirled
        self.assertFalse(submitted[0]['dd'])
        self.assertFalse(submitted[0]['gates'])   # Sampler's own twirling must stay off
        self.assertFalse(submitted[0]['measure'])
        self.assertAlmostEqual(data['unmitigated']['magnetization'], 0.5)
        self.assertAlmostEqual(data['twirled']['magnetization'], 0.5)
        self.assertEqual(data['unmitigated']['shots'], 64)
        self.assertEqual(data['backend'], 'generic_backend_5q')
        self.assertEqual(data['layout'], queued['layout'])
        self.assertEqual(data['experiment'], 'witness')
        self.assertEqual(len(queued['layout']), 2)
        saved = json.loads((results/(done['dataset_id']+'.json')).read_text(encoding='utf-8'))
        self.assertEqual(saved['counts']['unmitigated'], raw)

    def test_failed_ibm_submission_is_reported(self):
        env = {'IBM_ENABLE': 'true', 'IBM_QUANTUM_TOKEN': 't', 'IBM_BACKEND': 'generic'}
        backend = GenericBackendV2(2, basis_gates=['iswap', 'rz', 'sx', 'x'], seed=42)
        with patch.dict(os.environ, env), \
             patch.object(ibm_adapter, 'service', return_value=SimpleNamespace(backend=lambda name: backend)), \
             patch.object(twirl_api.POOL, 'submit', side_effect=lambda fn, *args: fn(*args)), \
             self.assertLogs(level='ERROR'):
            run = self.client.post('/api/twirl/hardware/runs', json={}).json()
            failed = self.client.get('/api/twirl/hardware/runs/'+run['id']).json()
        self.assertEqual(failed['status'], 'failed')
        self.assertIn('IBM submission failed', failed['error'])


if __name__ == '__main__':
    unittest.main()
