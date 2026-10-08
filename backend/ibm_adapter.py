"""Manual gate-folding ZNE with Sampler; NOT built-in Sampler mitigation.

Pinned to legacy Runtime 0.47.0. No network access occurs on import.
"""
import math
import os
from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector, SparsePauliOp
from qiskit.transpiler import generate_preset_pass_manager
from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2
from .core import FACTORS, summarize

def build_circuit(factor):
    if factor not in FACTORS:
        raise ValueError('Only factors 1, 3, 5 are supported')
    circuit = QuantumCircuit(2)
    circuit.ry(math.acos(0.9), 0)
    # Nine logical CX gates. CX is its own inverse; odd folding preserves each CX.
    for _ in range(9):
        for _ in range(factor):
            circuit.cx(0, 1)
            circuit.barrier()
    circuit.measure_all()
    return circuit

def reference_value():
    circuit = build_circuit(1).remove_final_measurements(inplace=False)
    return float(Statevector.from_instruction(circuit).expectation_value(SparsePauliOp('ZI')).real)

def service():
    if os.getenv('IBM_ENABLE', '').lower() != 'true':
        raise ValueError('IBM execution is disabled')
    token = os.getenv('IBM_QUANTUM_TOKEN')
    # Optional: without an instance, Qiskit Runtime picks one the token can access.
    instance = os.getenv('IBM_QUANTUM_INSTANCE') or None
    if not token or not os.getenv('IBM_BACKEND'):
        raise ValueError('Set IBM_QUANTUM_TOKEN and IBM_BACKEND on the server')
    return QiskitRuntimeService(channel='ibm_quantum_platform', token=token, instance=instance)

def submit(shots):
    svc = service()
    backend = svc.backend(os.environ['IBM_BACKEND'])
    edge = next(iter(backend.coupling_map.get_edges()))
    pm = generate_preset_pass_manager(optimization_level=0, backend=backend,
        initial_layout=list(edge), seed_transpiler=42)
    circuits = [pm.run(build_circuit(factor)) for factor in FACTORS]
    gates = [sum(item.operation.num_qubits == 2 and item.operation.name != 'barrier'
                 for item in circuit.data) for circuit in circuits]
    if gates[0] == 0 or gates[1] < 2*gates[0] or gates[2] < 4*gates[0]:
        raise ValueError('Transpiler removed folding; aborting before QPU submission')
    sampler = SamplerV2(mode=backend)
    sampler.options.dynamical_decoupling.enable = False
    sampler.options.twirling.enable_gates = False
    sampler.options.twirling.enable_measure = False
    job = sampler.run(circuits, shots=shots)
    return dict(job_id=job.job_id(), backend=backend.name, physical_qubits=list(edge),
        two_qubit_gates=gates, reference=reference_value())

def poll(job_id):
    job = service().job(job_id)
    status = str(job.status()).upper()
    if status == 'DONE':
        result = job.result()
        points = [summarize(pub.data.meas.get_counts(), factor, bit_index=1)
                  for factor, pub in zip(FACTORS, result)]
        if len(points) != 3:
            raise ValueError('IBM returned an unexpected number of circuit results')
        return {'status':'completed', 'points':points}
    if status in ('ERROR','CANCELLED'):
        return {'status':'failed', 'error':'IBM job '+status}
    return {'status':'queued' if status in ('QUEUED','INITIALIZING','VALIDATING') else 'running'}
