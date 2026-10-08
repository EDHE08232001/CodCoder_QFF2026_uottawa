"""Pauli twirling: wrap every two-qubit gate in a random Pauli frame.

For a Clifford gate C and a Pauli P, the conjugate Q = C P C+ is another Pauli,
so running P, then C, then Q equals C up to a global phase - the logical
circuit is untouched. The noise that sits on C, however, gets conjugated by a
random Pauli. Averaged over the 16 two-qubit Paulis this replaces the noise
channel by its Pauli-twirled version, which keeps only the diagonal (stochastic)
part: coherent errors stop adding up shot after shot.

Twirling does not make the noise smaller. A channel that is already a Pauli
channel (depolarizing, bit flips) is its own twirl and is left unchanged.
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np
from qiskit import QuantumCircuit
from qiskit.circuit.library import CXGate, CZGate, ECRGate
from qiskit.quantum_info import Clifford, Pauli

PAULI_LABELS = tuple(left + right for left in "IXYZ" for right in "IXYZ")
# Two-qubit gates we twirl: the simulator basis plus the IBM hardware bases.
TWIRLED_GATES = {"cx": CXGate(), "cz": CZGate(), "ecr": ECRGate()}


@lru_cache(maxsize=len(TWIRLED_GATES))
def frame_table(name: str) -> tuple[tuple[str, str], ...]:
    """The 16 (before, after) Pauli pairs that leave ``name`` unchanged."""
    if name not in TWIRLED_GATES:
        raise ValueError(f"Cannot twirl '{name}'. Known gates: {', '.join(sorted(TWIRLED_GATES))}")
    clifford = Clifford(TWIRLED_GATES[name])
    pairs = []
    for label in PAULI_LABELS:
        # frame='s' gives the Schroedinger conjugate C P C+, which is what goes after the gate.
        after = Pauli(label).evolve(clifford, frame="s").to_label().lstrip("+-i")
        pairs.append((label, after))
    return tuple(pairs)


def apply_pauli(circuit: QuantumCircuit, label: str, qubits, basis_gates: bool = False) -> None:
    """Append a Pauli to ``circuit``; the last character of the label acts on qubits[0].

    With ``basis_gates`` the Pauli is written with x and rz(pi) only, so it can be
    appended to an already transpiled circuit without breaking the IBM basis.
    """
    for qubit, character in zip(qubits, reversed(label)):
        if character == "I":
            continue
        if not basis_gates:
            {"X": circuit.x, "Y": circuit.y, "Z": circuit.z}[character](qubit)
        elif character == "X":
            circuit.x(qubit)
        elif character == "Z":
            circuit.rz(np.pi, qubit)          # Z up to a global phase
        else:
            circuit.x(qubit)                  # Z X = i Y, so X then Z gives Y up to a phase
            circuit.rz(np.pi, qubit)


def two_qubit_gates(circuit: QuantumCircuit) -> int:
    return sum(instruction.operation.name in TWIRLED_GATES for instruction in circuit.data)


def inject_z_kicks(circuit: QuantumCircuit, angle: float) -> QuantumCircuit:
    """Put RZ(angle) on both qubits of every twirled two-qubit gate (the coherent kick)."""
    if angle <= 0:
        return circuit
    injected = circuit.copy_empty_like()
    for instruction in circuit.data:
        injected.append(instruction)
        if instruction.operation.name in TWIRLED_GATES:
            for qubit in instruction.qubits:
                injected.rz(angle, qubit)
    return injected


def twirl(circuit: QuantumCircuit, rng: np.random.Generator,
          basis_gates: bool = False, inject_z: float = 0.0) -> tuple[QuantumCircuit, list[dict]]:
    """One randomisation of ``circuit``, plus the Pauli frame chosen for each gate.

    ``inject_z`` is applied after the two-qubit gate and still inside the frame, so
    the after-Pauli conjugates the kick the same way hardware noise on that gate would.
    """
    twirled = circuit.copy_empty_like()
    frames = []
    for instruction in circuit.data:
        name = instruction.operation.name
        if name not in TWIRLED_GATES:
            twirled.append(instruction)
            continue
        table = frame_table(name)
        before, after = table[rng.integers(len(table))]
        apply_pauli(twirled, before, instruction.qubits, basis_gates)
        twirled.append(instruction)
        if inject_z > 0:
            for qubit in instruction.qubits:
                twirled.rz(inject_z, qubit)
        apply_pauli(twirled, after, instruction.qubits, basis_gates)
        frames.append({"gate": name, "qubits": [circuit.find_bit(q).index for q in instruction.qubits],
                       "before": before, "after": after})
    return twirled, frames


def randomizations(circuit: QuantumCircuit, count: int, rng: np.random.Generator,
                   basis_gates: bool = False, inject_z: float = 0.0) -> tuple[list[QuantumCircuit], list[list[dict]]]:
    pairs = [twirl(circuit, rng, basis_gates, inject_z) for _ in range(count)]
    return [circuit for circuit, _ in pairs], [frames for _, frames in pairs]


if __name__ == "__main__":
    # run from the project root:  python -m src.twirl
    from qiskit.quantum_info import Operator, Statevector

    from .problems import quench_circuit

    def same_up_to_phase(left: np.ndarray, right: np.ndarray) -> bool:
        phase = np.trace(right.conj().T @ left) / left.shape[0]
        return abs(abs(phase) - 1) < 1e-9 and np.allclose(left, phase * right)

    for name in sorted(TWIRLED_GATES):
        table = frame_table(name)
        assert len(table) == 16 and len({after for _, after in table}) == 16
        gate = Operator(TWIRLED_GATES[name]).data
        for before, after in table:
            framed = Pauli(after).to_matrix() @ gate @ Pauli(before).to_matrix()
            assert same_up_to_phase(framed, gate), f"{name}: {before} -> {after} changes the gate"
        print(f"{name}: 16 Pauli frames verified, e.g. II->{dict(table)['II']}, XI->{dict(table)['XI']}")

    rng = np.random.default_rng(0)
    bare = quench_circuit(4, 3, 1.0, measure=False)
    reference = Statevector(bare).probabilities()
    for _ in range(20):
        twirled, frames = twirl(bare, rng)
        assert len(frames) == two_qubit_gates(bare) == 18
        np.testing.assert_allclose(Statevector(twirled).probabilities(), reference, atol=1e-12)
    print(f"20 randomisations of a {two_qubit_gates(bare)}-CX quench leave the ideal outcome unchanged")

    # The basis-gate form (x, rz) must describe the same frames as the x/y/z form.
    plain, plain_frames = twirl(bare, np.random.default_rng(1))
    basis, basis_frames = twirl(bare, np.random.default_rng(1), basis_gates=True)
    assert plain_frames == basis_frames
    np.testing.assert_allclose(Statevector(basis).probabilities(), reference, atol=1e-12)
    assert same_up_to_phase(Operator(basis).data, Operator(plain).data)
    print("basis-gate frames (x, rz) agree with the x/y/z frames")
    print("twirl.py OK")
