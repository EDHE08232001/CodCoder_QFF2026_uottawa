"""Real local circuit simulation using explicit, labeled Aer noise models."""
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, depolarizing_error
from .analysis import FACTORS, summarize
from .hardware import build_circuit, reference_value

NOISE_PROFILES = {'linear': 0.003, 'exponential': 0.015}


def simulate(level, shots, seed):
    if level not in NOISE_PROFILES:
        raise ValueError('Unknown Aer noise profile')
    error = NOISE_PROFILES[level]
    noise = NoiseModel()
    noise.add_all_qubit_quantum_error(depolarizing_error(error, 2), ['cx'])
    simulator = AerSimulator(method='density_matrix', noise_model=noise,
        max_parallel_threads=1)
    circuits = [build_circuit(factor) for factor in FACTORS]
    result = simulator.run(circuits, shots=shots, seed_simulator=seed).result()
    if not result.success:
        raise RuntimeError('Aer circuit simulation failed')
    points = [summarize(result.get_counts(index), factor, bit_index=1)
              for index, factor in enumerate(FACTORS)]
    return dict(points=points, reference=reference_value(),
        source='Qiskit Aer circuit simulator (specified noise model, not IBM hardware)',
        noise_model=dict(channel='two_qubit_depolarizing', error_parameter=error,
            readout_error=False, note='Specified per-CX channel; not a calibrated IBM model.'),
        two_qubit_gates=[c.count_ops()['cx'] for c in circuits],
        noise_factors=list(FACTORS))
