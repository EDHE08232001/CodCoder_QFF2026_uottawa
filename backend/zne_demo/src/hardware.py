"""Manual gate-folding ZNE with Sampler; NOT built-in Sampler mitigation.

Pinned to legacy Runtime 0.47.0. No network access occurs on import.
"""
import math
import os
from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector, SparsePauliOp, Operator
import numpy as np
from qiskit.transpiler import generate_preset_pass_manager
from qiskit_ibm_runtime import SamplerV2
from .analysis import FACTORS, summarize

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
    """Reuse the unchanged shared IBM connection used by DD and Pauli."""
    from ... import ibm_adapter
    return ibm_adapter.service()


def fold_native(circuit, factor):
    """Fold the fixed ISA circuit, preserving its layout and measurement mapping.

    Supports self-inverse native two-qubit gates (CX, CZ, ECR). Refuse other
    gates rather than silently submitting unsupported inverse instructions.
    """
    if factor not in FACTORS:
        raise ValueError('Only factors 1, 3, 5 are supported')
    folded = circuit.copy_empty_like()
    folded.metadata = dict(circuit.metadata or {}, zne_factor=factor)
    for item in circuit.data:
        gate = item.operation
        qargs = [folded.qubits[circuit.find_bit(q).index] for q in item.qubits]
        cargs = [folded.clbits[circuit.find_bit(c).index] for c in item.clbits]
        if gate.num_qubits == 2 and gate.name != 'barrier':
            matrix = Operator(gate).data
            if gate.name not in ('cx', 'cz', 'ecr') or not np.allclose(matrix @ matrix, np.eye(4), atol=1e-10):
                raise ValueError(f'Native gate {gate.name} needs a supported inverse-folding implementation')
            for repeat in range(factor):
                if repeat:
                    folded.barrier(*qargs)
                folded.append(gate.copy(), qargs, cargs)
        else:
            folded.append(gate.copy(), qargs, cargs)
    return folded

def native_gate_count(circuit):
    return sum(item.operation.num_qubits == 2 and item.operation.name != 'barrier'
               for item in circuit.data)

def prepare_circuits(backend, edge):
    pm = generate_preset_pass_manager(optimization_level=0, backend=backend,
        initial_layout=list(edge), seed_transpiler=42)
    base = pm.run(build_circuit(1))
    circuits = [fold_native(base, factor) for factor in FACTORS]
    gates = [native_gate_count(circuit) for circuit in circuits]
    if gates[0] == 0 or gates != [gates[0] * factor for factor in FACTORS]:
        raise ValueError('Native folding did not preserve the requested gate-count factors')
    for circuit in circuits:
        for item in circuit.data:
            if item.operation.name == 'barrier':
                continue
            qubits = tuple(circuit.find_bit(q).index for q in item.qubits)
            if not backend.target.instruction_supported(operation_name=item.operation.name, qargs=qubits):
                raise ValueError('Folded circuit contains an instruction outside the backend target')
    return circuits, gates

def submit(shots):
    svc = service()
    backend = svc.backend(os.environ['IBM_BACKEND'])
    edge = next(iter(backend.coupling_map.get_edges()))
    circuits, gates = prepare_circuits(backend, edge)
    sampler = SamplerV2(mode=backend)
    sampler.options.dynamical_decoupling.enable = False
    sampler.options.twirling.enable_gates = False
    sampler.options.twirling.enable_measure = False
    job = sampler.run(circuits, shots=shots)
    return dict(job_id=job.job_id(), backend=backend.name, physical_qubits=list(edge),
        two_qubit_gates=gates, circuit_depths=[c.depth() for c in circuits],
        folding_method='transpile_first_native', noise_factors=list(FACTORS),
        reference=reference_value())

def poll(job_id):
    job = service().job(job_id)
    original_status = job.status()
    status = str(getattr(original_status, 'name', original_status)).upper()
    if status == 'DONE':
        result = job.result()
        if len(result) != len(FACTORS):
            raise ValueError('IBM returned an unexpected number of circuit results')
        points = [summarize(pub.data.meas.get_counts(), factor, bit_index=1)
                  for factor, pub in zip(FACTORS, result)]
        if len(points) != 3:
            raise ValueError('IBM returned an unexpected number of circuit results')
        return {'status':'completed', 'points':points}
    if status in ('ERROR','CANCELLED'):
        return {'status':'failed', 'error':'IBM job '+status}
    return {'status':'queued' if status in ('QUEUED','INITIALIZING','VALIDATING') else 'running'}
