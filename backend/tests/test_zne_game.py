import math
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from fastapi.testclient import TestClient
from qiskit.quantum_info import Statevector, SparsePauliOp
from qiskit.providers.fake_provider import GenericBackendV2
from qiskit.transpiler import generate_preset_pass_manager
from backend.app import app
from backend import zne_api as app_module
from backend.zne_demo.src import hardware as ibm_adapter
from backend.zne_demo.src.analysis import fit, simulate, summarize

def points(values):
    return [dict(factor=x,mean=y,standard_error=0.01) for x,y in zip((1,3,5),values)]

class CoreTests(unittest.TestCase):
    def test_counts_to_expectation_and_endianness(self):
        self.assertAlmostEqual(summarize({'0':90,'1':10},1)['mean'],0.8)
        self.assertAlmostEqual(summarize({'10':80,'00':20},3,bit_index=1)['mean'],-0.6)
        self.assertGreater(summarize({'0':100},1)['standard_error'],0)

    def test_linear_zero_noise_reference(self):
        self.assertAlmostEqual(fit(points([0.8,0.6,0.4]),'linear')['estimate'],0.9,places=7)

    def test_exponential_zero_noise_reference(self):
        values=[0.9*0.8**x for x in (1,3,5)]
        self.assertAlmostEqual(fit(points(values),'exponential')['estimate'],0.9,places=6)

    def test_invalid_extrapolation_is_preserved(self):
        result=fit(points([0.8,0.4,0.2]),'exponential')
        self.assertTrue(result['outside_physical_range'])
        self.assertGreater(result['estimate'],1)

    def test_high_shot_sampling_is_close_to_model(self):
        for point in simulate('exponential',100000,42):
            self.assertLess(abs(point['mean']-0.9*0.8**point['factor']),0.012)
            self.assertEqual(point['zeros']+point['ones'],point['shots'])

class APITests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.patch=patch.object(app_module,'DATA',Path(self.temp.name))
        self.patch.start()
        self.client=TestClient(app)

    def tearDown(self):
        self.client.close()
        self.patch.stop()
        self.temp.cleanup()

    def test_full_aer_round_and_reference_secrecy(self):
        for level in ('linear','exponential'):
            response=self.client.post('/api/zne/runs',json={'level':level,'shots':10000,'seed':42})
            self.assertEqual(response.status_code,202)
            run=response.json()
            self.assertNotIn('reference',run)
            self.assertNotIn('reference',self.client.get('/api/zne/runs/'+run['id']).json())
            result=self.client.post('/api/zne/runs/'+run['id']+'/reveal',json={'model':level,'guess':0.9})
            self.assertEqual(result.status_code,200)
            self.assertAlmostEqual(result.json()['reference'],0.9)
            self.assertAlmostEqual(result.json()['player_error'],0,places=12)
            self.assertLess(result.json()['fitted_error'],0.08)

    def test_legacy_run_routes_share_the_same_storage(self):
        response = self.client.post('/api/runs', json={'shots':1000})
        self.assertEqual(response.status_code, 202)
        run_id = response.json()['id']
        self.assertEqual(self.client.get('/api/zne/runs/' + run_id).json(), response.json())
        self.assertEqual(self.client.get('/api/health').status_code, 200)
        self.assertEqual(self.client.get('/api/zne/health').status_code, 200)

    def test_invalid_requests(self):
        for body in ({'shots':0},{'shots':10001},{'mode':'bad'},{'level':'bad'}):
            self.assertEqual(self.client.post('/api/zne/runs',json=body).status_code,422)
        self.assertEqual(self.client.get('/api/zne/runs/not-a-uuid').status_code,404)

    def test_ibm_is_disabled_by_default(self):
        with patch.dict(os.environ,{'IBM_ENABLE':'false'}):
            self.assertEqual(self.client.post('/api/zne/runs',json={'mode':'ibm'}).status_code,403)

    def test_ibm_job_polling_then_reveal_with_mock(self):
        run={'id':'58a4706b-55b5-4e6c-944a-bb5f4ee6e321','mode':'ibm','status':'queued',
             'job_id':'mock-job','reference':0.9}
        app_module.save(run)
        with patch.object(ibm_adapter,'poll',return_value={'status':'completed','points':simulate('linear',10000,42)}):
            response=self.client.get('/api/zne/runs/'+run['id'])
            self.assertEqual(response.json()['status'],'completed')
        result=self.client.post('/api/zne/runs/'+run['id']+'/reveal',json={'model':'linear','guess':0.9})
        self.assertEqual(result.status_code,200)

class IBMAdapterTests(unittest.TestCase):
    def test_folding_preserves_ideal_answer_and_gate_count(self):
        for factor in (1,3,5):
            circuit=ibm_adapter.build_circuit(factor)
            self.assertEqual(circuit.count_ops()['cx'],9*factor)
            state=Statevector.from_instruction(circuit.remove_final_measurements(inplace=False))
            self.assertAlmostEqual(float(state.expectation_value(SparsePauliOp('ZI')).real),0.9,places=10)
        self.assertAlmostEqual(ibm_adapter.reference_value(),0.9,places=10)

    def test_transpiler_keeps_folding(self):
        backend=GenericBackendV2(2,basis_gates=['cx','rz','sx','x'],seed=42)
        pm=generate_preset_pass_manager(optimization_level=0,backend=backend,initial_layout=[0,1],seed_transpiler=42)
        for factor in (1,3,5):
            circuit=pm.run(ibm_adapter.build_circuit(factor))
            self.assertEqual(circuit.count_ops()['cx'],9*factor)

    def test_ibm_submission_without_network(self):
        backend=GenericBackendV2(2,basis_gates=['cx','rz','sx','x'],seed=42)
        svc=SimpleNamespace(backend=lambda name:backend)
        options=SimpleNamespace(dynamical_decoupling=SimpleNamespace(enable=True),
            twirling=SimpleNamespace(enable_gates=True,enable_measure=True))
        class FakeSampler:
            def __init__(self,mode):
                self.options=options
            def run(self,circuits,shots):
                self_test.assertEqual(len(circuits),3)
                self_test.assertEqual(shots,1000)
                return SimpleNamespace(job_id=lambda:'mock-job')
        self_test=self
        with patch.object(ibm_adapter,'service',return_value=svc),patch.object(ibm_adapter,'SamplerV2',FakeSampler),patch.dict(os.environ,{'IBM_BACKEND':'test'}):
            result=ibm_adapter.submit(1000)
        self.assertEqual(result['job_id'],'mock-job')
        self.assertEqual(result['two_qubit_gates'],[9,27,45])
        self.assertFalse(options.twirling.enable_measure)

    def test_ibm_result_parsing_without_network(self):
        counts={'00':90,'11':10}
        pubs=[SimpleNamespace(data=SimpleNamespace(meas=SimpleNamespace(get_counts=lambda:counts))) for _ in range(3)]
        job=SimpleNamespace(status=lambda:'DONE',result=lambda:pubs)
        with patch.object(ibm_adapter,'service',return_value=SimpleNamespace(job=lambda _:job)):
            result=ibm_adapter.poll('mock-job')
        self.assertEqual(result['status'],'completed')
        self.assertEqual([p['factor'] for p in result['points']],[1,3,5])
        self.assertTrue(all(math.isclose(p['mean'],0.8) for p in result['points']))

if __name__=='__main__':
    unittest.main()
