"""Trotterised transverse-field Ising quench circuits and their exact references.

H = -J * sum_i Z_i Z_{i+1} - h * sum_i X_i on an open chain, started from
|0...0> (the h = 0 ground state) and quenched by switching the field on.

One Trotter step advances the state by STEP_TIME / J and costs 2 (n - 1)
two-qubit gates, so the circuit is deep enough for gate errors to matter while
staying small enough to simulate exactly. Every ZZ rotation is written as
CX - RZ - CX so the two-qubit gates the twirl acts on are explicit.
"""
from __future__ import annotations

import numpy as np
from qiskit import QuantumCircuit
from qiskit.quantum_info import SparsePauliOp, Statevector
from scipy.linalg import expm

J = 1.0              # ZZ coupling; sets the energy and time unit
STEP_TIME = 0.4      # Trotter step length, in units of 1/J
MIN_QUBITS, MAX_QUBITS = 2, 6
MAX_STEPS = 8


def bonds(qubits: int) -> list[tuple[int, int]]:
    """Chain bonds, even ones first: the two layers of a Trotter step."""
    chain = [(i, i + 1) for i in range(qubits - 1)]
    return [bond for bond in chain if bond[0] % 2 == 0] + [bond for bond in chain if bond[0] % 2]


def quench_circuit(qubits: int, steps: int, field: float, measure: bool = True) -> QuantumCircuit:
    """Trotterised quench of the transverse-field Ising chain from |0...0>."""
    if not MIN_QUBITS <= qubits <= MAX_QUBITS:
        raise ValueError(f"qubits must be between {MIN_QUBITS} and {MAX_QUBITS}")
    if not 1 <= steps <= MAX_STEPS:
        raise ValueError(f"steps must be between 1 and {MAX_STEPS}")
    zz_angle = -2 * J * STEP_TIME      # exp(+i J dt ZZ) = RZZ(-2 J dt)
    x_angle = -2 * field * STEP_TIME   # exp(+i h dt X)  = RX(-2 h dt)
    circuit = QuantumCircuit(qubits)
    for step in range(steps):
        for control, target in bonds(qubits):
            circuit.cx(control, target)
            circuit.rz(zz_angle, target)
            circuit.cx(control, target)
        circuit.rx(x_angle, range(qubits))
        if step < steps - 1:
            circuit.barrier()
    if measure:
        circuit.measure_all()
    return circuit


def hamiltonian(qubits: int, field: float) -> SparsePauliOp:
    terms = [("Z" * 2, [i, i + 1], -J) for i in range(qubits - 1)]
    terms += [("X", [i], -field) for i in range(qubits)]
    return SparsePauliOp.from_sparse_list(terms, num_qubits=qubits)


def _magnetization(state: Statevector, qubits: int) -> tuple[float, list[float]]:
    per_qubit = [float(state.expectation_value(SparsePauliOp.from_sparse_list(
        [("Z", [i], 1.0)], num_qubits=qubits)).real) for i in range(qubits)]
    return float(np.mean(per_qubit)), per_qubit


def ideal(qubits: int, steps: int, field: float) -> dict:
    """Noiseless outcome of the Trotter circuit: the target every run aims at."""
    state = Statevector.from_instruction(quench_circuit(qubits, steps, field, measure=False))
    magnetization, per_qubit = _magnetization(state, qubits)
    probabilities = state.probabilities()
    return {"magnetization": round(magnetization, 6),
            "per_qubit": [round(value, 6) for value in per_qubit],
            "distribution": {format(index, f"0{qubits}b"): round(float(p), 6)
                             for index, p in enumerate(probabilities)}}


def exact(qubits: int, steps: int, field: float) -> dict:
    """Continuous-time answer: shows Trotter error, which no mitigation removes."""
    matrix = hamiltonian(qubits, field).to_matrix()
    vector = np.zeros(2 ** qubits, dtype=complex)
    vector[0] = 1.0
    state = Statevector(expm(-1j * matrix * steps * STEP_TIME) @ vector)
    magnetization, per_qubit = _magnetization(state, qubits)
    return {"magnetization": round(magnetization, 6),
            "per_qubit": [round(value, 6) for value in per_qubit]}


def describe(qubits: int, steps: int, field: float) -> dict:
    return {"qubits": qubits, "steps": steps, "field": field, "coupling": J,
            "step_time": STEP_TIME, "total_time": round(steps * STEP_TIME, 6),
            "two_qubit_gates": 2 * (qubits - 1) * steps}


# IBM coherent-witness preset: an identity sandwich where a known Z kick after
# every two-qubit gate is visible, so twirling has something to cancel.
WITNESS_QUBITS = 2
WITNESS_PAIRS = 6
WITNESS_ANGLE = 0.08
WITNESS_RANDOMIZATIONS = 16
WITNESS_SHOTS = 512


def witness_circuit(pairs: int = WITNESS_PAIRS, measure: bool = True) -> QuantumCircuit:
    """H — (CX CX)×pairs — H. Perfect gates return |00⟩; magnetization is +1."""
    if pairs < 1:
        raise ValueError("pairs must be at least 1")
    circuit = QuantumCircuit(WITNESS_QUBITS)
    circuit.h([0, 1])
    for _ in range(pairs):
        circuit.cx(0, 1)
        circuit.barrier()
        circuit.cx(0, 1)
        circuit.barrier()
    circuit.h([0, 1])
    if measure:
        circuit.measure_all()
    return circuit


def witness_ideal() -> dict:
    state = Statevector.from_instruction(witness_circuit(measure=False))
    magnetization, per_qubit = _magnetization(state, WITNESS_QUBITS)
    probabilities = state.probabilities()
    return {"magnetization": round(magnetization, 6),
            "per_qubit": [round(value, 6) for value in per_qubit],
            "distribution": {format(index, f"0{WITNESS_QUBITS}b"): round(float(p), 6)
                             for index, p in enumerate(probabilities)}}


def witness_describe() -> dict:
    return {"experiment": "witness",
            "label": "Coherent identity sandwich",
            "qubits": WITNESS_QUBITS, "pairs": WITNESS_PAIRS, "steps": WITNESS_PAIRS,
            "field": 0.0, "coherent_angle": WITNESS_ANGLE,
            "two_qubit_gates": 2 * WITNESS_PAIRS,
            "randomizations": WITNESS_RANDOMIZATIONS, "shots": WITNESS_SHOTS,
            "ideal": 1.0,
            "brief": ("Two qubits, Hadamards around six CX–CX identity pairs (12 two-qubit gates). "
                      "A 0.08 rad Z kick is added after every two-qubit gate so a coherent error "
                      "is guaranteed to be there. Twirling randomizes that kick. Target ⟨Z⟩ = +1.")}


if __name__ == "__main__":
    # run from the project root:  python -m src.problems
    print("bonds(5):", bonds(5))
    assert bonds(5) == [(0, 1), (2, 3), (1, 2), (3, 4)]

    circuit = quench_circuit(3, 2, 1.0)
    print(circuit.draw(fold=120))
    assert circuit.count_ops()["cx"] == 2 * 2 * 2

    for steps in range(1, 6):
        trotter = ideal(4, steps, 1.0)
        continuous = exact(4, steps, 1.0)
        print(f"steps={steps} t={steps * STEP_TIME:.1f}  Trotter <Z>={trotter['magnetization']:+.4f}  "
              f"exact <Z>={continuous['magnetization']:+.4f}  "
              f"Trotter error={abs(trotter['magnetization'] - continuous['magnetization']):.4f}")

    one_step = ideal(4, 1, 1.0)
    assert abs(sum(one_step["distribution"].values()) - 1) < 1e-5
    # A single step of the exact and the Trotter evolution agree to O(dt^2).
    assert abs(one_step["magnetization"] - exact(4, 1, 1.0)["magnetization"]) < 0.05
    # Zero field leaves the chain in |0...0>.
    assert abs(ideal(4, 4, 0.0)["magnetization"] - 1.0) < 1e-9
    print("problems.py OK")
