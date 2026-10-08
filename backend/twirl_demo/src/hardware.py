"""Transpile the quench for a real backend, twirl it, and run it through Sampler.

The twirl is applied *after* transpilation, on the device's own two-qubit gate
(cz or ecr) and written with x and rz only, so the Pauli frames are already in
the hardware basis and no later pass can optimise them away. The frames do add
one or two single-qubit gates per qubit per layer, which is the real price of
twirling on hardware.

Sampler's own gate and measurement twirling is switched off: the randomisation
in this lab must be the only one in play.
"""
from __future__ import annotations

from collections import defaultdict

import numpy as np
from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager
from qiskit_ibm_runtime import SamplerV2

from . import twirl
from .problems import WITNESS_ANGLE, quench_circuit, witness_circuit


def line_layout(backend, qubits: int) -> list[int]:
    """A chain of connected physical qubits, so the circuit needs no swaps."""
    neighbours = defaultdict(set)
    for left, right in backend.coupling_map.get_edges():
        neighbours[left].add(right)
        neighbours[right].add(left)

    def extend(path):
        if len(path) == qubits:
            return path
        for candidate in sorted(neighbours[path[-1]] - set(path)):
            found = extend(path + [candidate])
            if found:
                return found
        return None

    for start in sorted(neighbours):
        path = extend([start])
        if path:
            return path
    raise ValueError(f"{backend.name} has no chain of {qubits} connected qubits")


def build_circuits(backend, qubits: int, steps: int, field: float,
                   randomizations: int, seed: int = 7, experiment: str = "quench") -> dict:
    """One transpiled bare circuit plus ``randomizations`` twirled copies of it."""
    inject_z = 0.0
    if experiment == "witness":
        qubits = 2
        logical = witness_circuit()
        inject_z = WITNESS_ANGLE
    else:
        logical = quench_circuit(qubits, steps, field)
    layout = line_layout(backend, qubits)
    manager = generate_preset_pass_manager(optimization_level=1, backend=backend,
                                           initial_layout=layout, seed_transpiler=seed)
    bare = manager.run(logical)
    entangling = sum(instruction.operation.num_qubits == 2 and instruction.operation.name != "barrier"
                     for instruction in bare.data)
    twirlable = twirl.two_qubit_gates(bare)
    if not twirlable or twirlable != entangling:
        raise ValueError(f"{backend.name} uses a two-qubit gate this lab cannot twirl; "
                         f"{twirlable} of {entangling} gates are known")
    circuits, frames = twirl.randomizations(bare, randomizations, np.random.default_rng(seed),
                                            basis_gates=True, inject_z=inject_z)
    submitted_bare = twirl.inject_z_kicks(bare, inject_z)
    for circuit in circuits:
        if twirl.two_qubit_gates(circuit) != twirlable:
            raise ValueError("Twirling changed the two-qubit gate count; aborting before submission")
    return {"bare": submitted_bare, "twirled": circuits, "frames": frames, "layout": layout,
            "two_qubit_gates": twirlable, "frames_per_circuit": len(frames[0]) if frames else 0,
            "experiment": experiment, "inject_z": inject_z}


def submit(backend, circuits, shots: int):
    """Submit every circuit as one job without waiting; returns the runtime job."""
    sampler = SamplerV2(mode=backend)
    # Set these explicitly so neither side of the comparison inherits a service default.
    sampler.options.dynamical_decoupling.enable = False
    sampler.options.twirling.enable_gates = False
    sampler.options.twirling.enable_measure = False
    return sampler.run(list(circuits), shots=shots)


def counts_from_result(result) -> list[dict[str, int]]:
    return [pub.data.meas.get_counts() for pub in result]


if __name__ == "__main__":
    # run from the project root:  python -m src.hardware
    # Offline check against a fake Heron device; no token needed.
    from qiskit_ibm_runtime.fake_provider import FakeTorino

    backend = FakeTorino()
    print(f"backend {backend.name}, two-qubit basis "
          f"{sorted(set(backend.operation_names) & set(twirl.TWIRLED_GATES))}")

    layout = line_layout(backend, 4)
    print("line layout:", layout)
    edges = {tuple(sorted(edge)) for edge in backend.coupling_map.get_edges()}
    assert all(tuple(sorted(pair)) in edges for pair in zip(layout, layout[1:]))

    built = build_circuits(backend, qubits=4, steps=2, field=0.6, randomizations=3)
    print(f"ISA bare: {built['two_qubit_gates']} two-qubit gates, depth {built['bare'].depth()}, "
          f"ops {dict(sorted(built['bare'].count_ops().items()))}")
    print(f"ISA twirled: depth {built['twirled'][0].depth()}, "
          f"ops {dict(sorted(built['twirled'][0].count_ops().items()))}")
    assert built["frames_per_circuit"] == built["two_qubit_gates"] == 12
    assert all(set(circuit.count_ops()) <= set(built["bare"].count_ops()) | {"x", "rz"}
               for circuit in built["twirled"]), "twirled circuits must stay in the device basis"
    print("hardware.py OK")
