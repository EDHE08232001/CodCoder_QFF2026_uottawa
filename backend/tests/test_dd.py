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
from qiskit.quantum_info import Statevector
from backend import dd_api
from backend import ibm_adapter
from backend.app import app
from backend.dd_demo.src import fastsim, game, runner
from backend.dd_demo.src.circuits import noisy_idle_circuit
from backend.dd_demo.src.noise import colored_noise
from backend.dd_demo.src.sequences import build_sequence

QUEBEC = 'hardware_ibm_quebec_20261005-231055'

def even(n, axes='x'):
    return [{'position':(i+.5)/n,'axis':axes[i%len(axes)]} for i in range(n)]

class SimulatorTests(unittest.TestCase):
    def test_fastsim_matches_qiskit_statevector(self):
        dt, total = 0.1e-6, 30e-6
        noise = colored_noise(6, 300, dt, 2*np.pi*20e3, rng=np.random.default_rng(3))
        for name in ('free','hahn','cpmg','xy4','udd'):
            for init in ('x','y'):
                seq = build_sequence(name, 5)
                fast = fastsim.survival_probability(seq, total, noise, dt, init, 0.05)
                exact = [Statevector(noisy_idle_circuit(seq, total, row, dt, init, 0.05)).probabilities()[0] for row in noise]
                np.testing.assert_allclose(fast, exact, atol=1e-10)

    def test_static_detuning_is_refocused_by_echo(self):
        noise = colored_noise(50, 400, 0.1e-6, 2*np.pi*25e3, kind='static', rng=np.random.default_rng(0))
        self.assertAlmostEqual(fastsim.mean_survival(build_sequence('hahn'), 40e-6, noise, 0.1e-6), 1.0, places=9)
        self.assertLess(fastsim.mean_survival(build_sequence('free'), 40e-6, noise, 0.1e-6), 0.6)

    def test_trajectories_start_on_the_initial_axis(self):
        traj = fastsim.bloch_trajectories(build_sequence('cpmg', 4), 20e-6, np.zeros((2, 200)), 0.1e-6, 11, init='y')
        self.assertEqual(traj.shape, (2, 11, 3))
        np.testing.assert_allclose(traj[:, 0], [[0, 1, 0]]*2, atol=1e-12)

class GameTests(unittest.TestCase):
    def test_each_level_teaches_its_lesson(self):
        self.assertTrue(game.play('echo', [(0.5,'x')])['passed'])
        self.assertFalse(game.play('echo', [(0.3,'x')])['passed'])
        self.assertFalse(game.play('drift', [(0.5,'x')])['passed'])
        self.assertTrue(game.play('drift', [(p,'x') for p in game.even_positions(10)])['passed'])
        slots = game.even_positions(16)
        self.assertFalse(game.play('wobble', [(p,'x') for p in slots])['passed'])
        self.assertTrue(game.play('wobble', [(p,'xy'[i%2]) for i,p in enumerate(slots)])['passed'])
        free, pulsed = game.play('fast', []), game.play('fast', [(p,'x') for p in game.even_positions(10)])
        self.assertLess(abs(free['signal']-pulsed['signal']), 0.1)
        self.assertIsNone(pulsed['target'])

    def test_results_are_deterministic(self):
        self.assertEqual(game.play('drift', [(0.25,'x'),(0.75,'x')]), game.play('drift', [(0.75,'x'),(0.25,'x')]))

class DDAPITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.data = patch.object(dd_api, 'DATA', Path(self.temp.name)/'runs')
        self.data.start()
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.data.stop()
        self.temp.cleanup()

    def test_levels_and_play(self):
        levels = self.client.get('/api/dd/levels').json()['levels']
        self.assertEqual([level['id'] for level in levels], ['echo','drift','wobble','fast'])
        result = self.client.post('/api/dd/play', json={'level':'echo','pulses':[{'position':0.5}]}).json()
        self.assertGreater(result['signal'], 0.99)
        self.assertEqual(result['stars'], 3)
        self.assertEqual(len(result['animation']['spins']), game.DISPLAY_SPINS)
        self.assertEqual(len(result['animation']['times_us']), game.FRAMES)
        self.assertAlmostEqual(result['pulses'][0]['time_us'], 20.0)

    def test_play_validation(self):
        bad = [{'level':'echo','pulses':even(2)}, {'level':'echo','pulses':[{'position':0}]},
               {'level':'echo','pulses':[{'position':1}]}, {'level':'drift','pulses':[{'position':.5},{'position':.5}]},
               {'level':'echo','pulses':[{'position':.5,'axis':'z'}]}, {'level':'other'}]
        for body in bad:
            self.assertEqual(self.client.post('/api/dd/play', json=body).status_code, 422, body)

    def test_explore_both_engines(self):
        for engine in ('theory','circuit'):
            body = {'engine':engine,'points':5,'pulses':4,'sequences':['free','cpmg','cpmg']}
            result = self.client.post('/api/dd/explore', json=body).json()
            self.assertEqual(len(result['times_us']), 5)
            self.assertEqual([c['name'] for c in result['curves']], ['free','cpmg4'])
        self.assertEqual(self.client.post('/api/dd/explore', json={'sigma_khz':0}).status_code, 422)
        self.assertEqual(self.client.post('/api/dd/explore', json={'sequences':[]}).status_code, 422)

    def test_saved_hardware_data(self):
        listing = self.client.get('/api/dd/hardware').json()
        self.assertIn(QUEBEC, [d['id'] for d in listing['datasets']])
        data = self.client.get('/api/dd/hardware/'+QUEBEC).json()
        self.assertEqual(data['backend'], 'ibm_quebec')
        self.assertFalse(data['simulated'])
        none = next(s for s in data['series'] if s['mode']=='none')
        self.assertAlmostEqual(none['p0'][3], 0.236)
        self.assertEqual(none['shots'], [2000]*8)
        for name in ('nope','..%2F..%2Fapp','hardware_x_1'):
            self.assertEqual(self.client.get('/api/dd/hardware/'+name).status_code, 404)

    def test_ibm_runs_are_gated(self):
        with patch.dict(os.environ, {'IBM_ENABLE':'false'}):
            self.assertEqual(self.client.post('/api/dd/hardware/runs', json={}).status_code, 403)
        with patch.dict(os.environ, {'IBM_ENABLE':'true','IBM_QUANTUM_TOKEN':'','IBM_QUANTUM_INSTANCE':'','IBM_BACKEND':''}):
            self.assertEqual(self.client.post('/api/dd/hardware/runs', json={}).status_code, 503)
        with patch.dict(os.environ, {'IBM_ENABLE':'true','IBM_QUANTUM_TOKEN':'t','IBM_QUANTUM_INSTANCE':'','IBM_BACKEND':'b'}), \
             patch.object(dd_api.POOL, 'submit'):
            self.assertEqual(self.client.post('/api/dd/hardware/runs', json={}).status_code, 202)  # instance is optional
        self.assertEqual(self.client.post('/api/dd/hardware/runs', json={'modes':['bad']}).status_code, 422)
        self.assertEqual(self.client.get('/api/dd/hardware/runs/not-a-uuid').status_code, 404)

    def test_ibm_submit_poll_and_save_without_network(self):
        backend = GenericBackendV2(2, basis_gates=['cx','rz','sx','x'], seed=42)
        submitted = []
        class FakeSampler:
            def __init__(self, mode):
                self.options = SimpleNamespace(dynamical_decoupling=SimpleNamespace(enable=None, sequence_type=None))
            def run(self, circuits, shots):
                submitted.append((self.options.dynamical_decoupling.enable, sum(c.count_ops().get('x',0) for c in circuits), shots))
                return SimpleNamespace(job_id=lambda: f'job-{len(submitted)}')
        counts = [{'0':900,'1':100}, {'0':700,'1':300}, {'0':600,'1':400}]
        result = [SimpleNamespace(data=SimpleNamespace(c=SimpleNamespace(get_counts=lambda c=c: c))) for c in counts]
        statuses = {'state':'QUEUED'}
        job = SimpleNamespace(status=lambda: statuses['state'], result=lambda: result)
        svc = SimpleNamespace(backend=lambda name: backend, job=lambda job_id: job)
        env = {'IBM_ENABLE':'true','IBM_QUANTUM_TOKEN':'t','IBM_QUANTUM_INSTANCE':'i','IBM_BACKEND':'generic'}
        results_dir = Path(self.temp.name)/'results'
        with patch.dict(os.environ, env), patch.object(ibm_adapter, 'service', return_value=svc), \
             patch.object(runner, 'SamplerV2', FakeSampler), patch.object(dd_api, 'RESULTS', results_dir), \
             patch.object(dd_api.POOL, 'submit', side_effect=lambda fn, *args: fn(*args)):
            body = {'qubit':1,'points':3,'max_delay_us':30,'shots':500,'modes':['none','runtime-XY4','manual-XX']}
            run = self.client.post('/api/dd/hardware/runs', json=body).json()
            self.assertEqual(self.client.post('/api/dd/hardware/runs', json=body).status_code, 409)
            queued = self.client.get('/api/dd/hardware/runs/'+run['id']).json()
            self.assertEqual(queued['status'], 'queued')
            self.assertEqual(queued['job_ids'], {'none':'job-1','runtime-XY4':'job-2','manual-XX':'job-3'})
            self.assertEqual(len(queued['delays_us']), 3)
            statuses['state'] = 'DONE'
            done = self.client.get('/api/dd/hardware/runs/'+run['id']).json()
            self.assertEqual(done['status'], 'completed')
            data = self.client.get('/api/dd/hardware/'+done['dataset_id']).json()
        self.assertEqual([s['mode'] for s in data['series']], ['none','runtime-XY4','manual-XX'])
        self.assertEqual(data['series'][0]['p0'], [0.9,0.7,0.6])
        self.assertEqual(submitted[0], (False, 0, 500))
        self.assertIs(submitted[1][0], True)
        self.assertIs(submitted[2][0], False)  # manual-XX pads circuits itself; runtime DD stays off
        self.assertEqual(submitted[2][1], 6)  # manual-XX: two X pulses per circuit
        saved = json.loads((results_dir/(done['dataset_id']+'.json')).read_text(encoding='utf-8'))
        self.assertEqual(saved['job_ids']['none'], 'job-1')

    def test_failed_ibm_submission_is_reported(self):
        env = {'IBM_ENABLE':'true','IBM_QUANTUM_TOKEN':'t','IBM_QUANTUM_INSTANCE':'i','IBM_BACKEND':'generic'}
        backend = GenericBackendV2(2, basis_gates=['cx','rz','sx','x'], seed=42)
        with patch.dict(os.environ, env), patch.object(ibm_adapter, 'service', return_value=SimpleNamespace(backend=lambda name: backend)), \
             patch.object(dd_api.POOL, 'submit', side_effect=lambda fn, *args: fn(*args)), self.assertLogs(level='ERROR'):
            run = self.client.post('/api/dd/hardware/runs', json={'qubit':7}).json()
            failed = self.client.get('/api/dd/hardware/runs/'+run['id']).json()
        self.assertEqual(failed['status'], 'failed')
        self.assertIn('qubit', failed['error'])

if __name__ == '__main__':
    unittest.main()
