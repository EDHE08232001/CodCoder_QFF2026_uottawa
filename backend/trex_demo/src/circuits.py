"""Calibration and target circuits for readout mitigation.

Two ways to calibrate an n-qubit assignment matrix:
* tensored/local: 2 circuits total (global |0...0> and |1...1>), regardless
  of n -- cheap, but only correct when qubits misread independently.
* correlated: 2**n circuits, one per computational basis state -- exact
  either way, at exponential cost.

The target circuit is a GHZ state: a known, genuinely entangled distribution
(half |0...0>, half |1...1>) to correct, not just a classical bias.
"""
from __future__ import annotations

import numpy as np
from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector


def calibration_circuits(n: int) -> tuple[QuantumCircuit, QuantumCircuit]:
    """The cheap, 'tensored' calibration: global |0...0> and global |1...1>."""
    zeros = QuantumCircuit(n, name="cal_0")
    zeros.measure_all()
    ones = QuantumCircuit(n, name="cal_1")
    ones.x(range(n))
    ones.measure_all()
    return zeros, ones


def full_basis_circuits(n: int) -> list[QuantumCircuit]:
    """The expensive, exact 'correlated' calibration: one circuit per basis state."""
    circuits = []
    for state in range(2 ** n):
        circuit = QuantumCircuit(n, name=f"cal_basis_{state}")
        flipped = [qubit for qubit in range(n) if (state >> qubit) & 1]
        if flipped:
            circuit.x(flipped)
        circuit.measure_all()
        circuits.append(circuit)
    return circuits


def ghz_circuit(n: int, measure: bool = True) -> QuantumCircuit:
    """H on qubit 0, then a CX chain: |0...0> + |1...1>, normalised."""
    if n < 1:
        raise ValueError("n must be at least 1")
    circuit = QuantumCircuit(n, name=f"ghz_{n}")
    circuit.h(0)
    for qubit in range(n - 1):
        circuit.cx(qubit, qubit + 1)
    if measure:
        circuit.measure_all()
    return circuit


def ideal_probabilities(circuit: QuantumCircuit) -> np.ndarray:
    """Exact noiseless outcome distribution of an unmeasured circuit (qubit 0 = index 0)."""
    return Statevector.from_instruction(circuit).probabilities()


if __name__ == "__main__":
    # run from the project root:  python -m src.circuits
    zeros, ones = calibration_circuits(3)
    assert zeros.num_qubits == ones.num_qubits == 3
    assert ones.count_ops()["x"] == 3

    basis = full_basis_circuits(2)
    assert len(basis) == 4
    assert basis[0].count_ops().get("x", 0) == 0          # |00>
    assert basis[3].count_ops()["x"] == 2                 # |11>

    ghz2 = ghz_circuit(2, measure=False)
    probabilities = ideal_probabilities(ghz2)
    print("GHZ(2) ideal distribution:", probabilities)
    np.testing.assert_allclose(probabilities, [0.5, 0.0, 0.0, 0.5], atol=1e-9)

    ghz4 = ghz_circuit(4, measure=False)
    probabilities4 = ideal_probabilities(ghz4)
    assert np.isclose(probabilities4[0], 0.5) and np.isclose(probabilities4[-1], 0.5)
    assert np.isclose(probabilities4.sum(), 1.0)
    print("circuits.py OK")
