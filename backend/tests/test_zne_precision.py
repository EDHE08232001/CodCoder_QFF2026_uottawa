import math
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np
from qiskit import QuantumCircuit
from qiskit.providers.fake_provider import GenericBackendV2
from qiskit.quantum_info import Statevector
from backend.zne_demo.src import analysis, hardware, simulator
from backend import zne_api


def points(values, error=.01):
    return [dict(factor=f, mean=m, standard_error=error) for f,m in zip((1,3,5),values)]


class PrecisionTests(unittest.TestCase):
    def test_exact_weighted_linear_estimate_and_uncertainty(self):
        result = analysis.fit(points([.8,.6,.4]), 'linear')
        self.assertAlmostEqual(result['estimate'], .9, places=12)
        self.assertAlmostEqual(result['estimate_standard_error'], .01*math.sqrt(210/144), places=12)
        self.assertTrue(result['reliable_under_model'])
        self.assertAlmostEqual(result['curve'][0]['standard_error'], result['estimate_standard_error'], places=12)
        self.assertTrue(all(math.isfinite(p['standard_error']) and p['standard_error'] > 0 for p in result['curve']))

    def test_flat_data_and_wrong_model_are_flagged(self):
        flat = analysis.fit(points([.894,.900,.872], .015), 'linear')
        self.assertFalse(flat['reliable_under_model'])
        self.assertGreater(flat['trend_p_value'], .05)
        wrong = analysis.fit(points([.8,.4,.8], .005), 'linear')
        self.assertLess(wrong['fit_p_value'], .01)

    def test_invalid_finite_values_are_rejected(self):
        for value in [float('nan'),float('inf'),1.1]:
            with self.assertRaises(ValueError):
                analysis.fit(points([value,.6,.4]), 'linear')

    def test_native_folding_preserves_state_mapping_and_target(self):
        for basis in ['cx','cz','ecr']:
            backend = GenericBackendV2(2,basis_gates=[basis,'rz','sx','x'],seed=42)
            circuits, counts = hardware.prepare_circuits(backend,[0,1])
            self.assertEqual(counts,[9,27,45])
            base = Statevector.from_instruction(circuits[0].remove_final_measurements(inplace=False))
            for circuit in circuits:
                state = Statevector.from_instruction(circuit.remove_final_measurements(inplace=False))
                self.assertTrue(base.equiv(state))
                measurements = [(circuit.find_bit(i.qubits[0]).index,circuit.find_bit(i.clbits[0]).index)
                    for i in circuit.data if i.operation.name=='measure']
                self.assertEqual(measurements,[(0,0),(1,1)])

    def test_unsupported_native_gate_aborts(self):
        circuit = QuantumCircuit(2)
        circuit.rzz(.2,0,1)
        with self.assertRaises(ValueError):
            hardware.fold_native(circuit,3)

    def test_extra_ibm_results_are_not_silently_truncated(self):
        job = SimpleNamespace(status=lambda:'DONE',result=lambda:[None]*4)
        with patch.object(hardware,'service',return_value=SimpleNamespace(job=lambda _:job)):
            with self.assertRaises(ValueError):
                hardware.poll('mock-job')

    def test_aer_executes_circuits_and_matches_specified_noise(self):
        for profile in simulator.NOISE_PROFILES:
            result=simulator.simulate(profile,10000,42)
            self.assertIn('Aer',result['source'])
            self.assertEqual(result['two_qubit_gates'],[9,27,45])
            for p in result['points']:
                self.assertEqual(p['zeros']+p['ones'],10000)
                expected=.9*(1-simulator.NOISE_PROFILES[profile])**(9*p['factor'])
                self.assertLess(abs(p['mean']-expected),5*p['standard_error'])
            self.assertEqual(result['points'],simulator.simulate(profile,10000,42)['points'])

    def test_only_aer_and_ibm_can_be_requested(self):
        self.assertEqual(zne_api.RunRequest().mode,'aer')
        with self.assertRaises(ValueError):
            zne_api.RunRequest(mode='teaching')

    def test_aer_round_does_not_expose_reference_until_reveal(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(zne_api,'DATA',Path(temp)):
            run=zne_api.create_run(zne_api.RunRequest(mode='aer',shots=10000,level='exponential'))
            self.assertNotIn('reference',run)
            self.assertEqual(zne_api.get_run(run['id']),run)
            result=zne_api.reveal(run['id'],zne_api.Guess(model='exponential',guess=.9))
            self.assertAlmostEqual(result['reference'],.9)
            self.assertLess(result['fitted_error'],.08)
            self.assertIn('warnings',result)

    def test_active_job_can_be_resumed_and_remote_completion_is_saved(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(zne_api,'DATA',Path(temp)):
            self.assertIsNone(zne_api.active_run())
            run=dict(id='5a45736d-b387-44e1-b903-2e8a65b382bb',mode='ibm',
                     status='queued',job_id='mock-job',reference=.9,shots=4000,level='exponential')
            zne_api.save(run)
            with patch.object(hardware,'poll',return_value={'status':'running'}):
                active=zne_api.active_run()
                self.assertEqual(active['id'],run['id'])
                self.assertEqual(active['status'],'running')
                self.assertNotIn('reference',active)
            with patch.object(hardware,'poll',return_value={'status':'completed','points':points([.8,.6,.4])}):
                active=zne_api.active_run()
                self.assertEqual(active['status'],'completed')
                self.assertEqual(len(active['points']),3)
                self.assertNotIn('reference',active)
            self.assertIsNone(zne_api.active_run())
            self.assertEqual(zne_api.read(run['id'])['status'],'completed')


if __name__=='__main__':
    unittest.main()
