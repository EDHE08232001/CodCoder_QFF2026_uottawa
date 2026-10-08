"""Transpile the calibration + GHZ circuits for a real backend and run them through Sampler.

Submits every calibration circuit plus the target circuit as one job, so a
single device snapshot (one submission, back-to-back jobs) backs both the
raw measurement and the correction -- avoids comparing a calibration taken
on one day against a target run taken on another.
"""
from __future__ import annotations

from collections import defaultdict

from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager
from qiskit_ibm_runtime import SamplerV2

from .circuits import calibration_circuits, full_basis_circuits, ghz_circuit

MAX_CORRELATED_QUBITS = 4  # caps a correlated-mode hardware job at 2**4 = 16 calibration circuits


def line_layout(backend, qubits: int) -> list[int]:
    """A chain of connected physical qubits, so the GHZ chain needs no swaps."""
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


def build_circuits(backend, qubits: int, calibration_mode: str, seed: int = 7) -> dict:
    if calibration_mode == "correlated" and qubits > MAX_CORRELATED_QUBITS:
        raise ValueError(f"correlated calibration on hardware is capped at {MAX_CORRELATED_QUBITS} qubits")
    layout = line_layout(backend, qubits)
    manager = generate_preset_pass_manager(optimization_level=1, backend=backend,
                                           initial_layout=layout, seed_transpiler=seed)
    calibration = (list(calibration_circuits(qubits)) if calibration_mode == "tensored"
                  else full_basis_circuits(qubits))
    isa_calibration = [manager.run(circuit) for circuit in calibration]
    isa_target = manager.run(ghz_circuit(qubits))
    return {"calibration": isa_calibration, "target": isa_target, "layout": layout,
            "calibration_circuits_used": len(isa_calibration)}


def submit(backend, calibration_circuits_list, target_circuit, shots: int):
    """Submit calibration circuits + the target circuit as one job without waiting."""
    sampler = SamplerV2(mode=backend)
    sampler.options.dynamical_decoupling.enable = False
    sampler.options.twirling.enable_gates = False
    sampler.options.twirling.enable_measure = False
    return sampler.run([*calibration_circuits_list, target_circuit], shots=shots)


def counts_from_result(result) -> list[dict[str, int]]:
    return [pub.data.meas.get_counts() for pub in result]


if __name__ == "__main__":
    # run from the project root:  python -m src.runner
    # Offline check against a fake Heron device; no token needed.
    from qiskit_ibm_runtime.fake_provider import FakeTorino

    backend = FakeTorino()
    layout = line_layout(backend, 4)
    print("line layout:", layout)
    edges = {tuple(sorted(edge)) for edge in backend.coupling_map.get_edges()}
    assert all(tuple(sorted(pair)) in edges for pair in zip(layout, layout[1:]))

    built = build_circuits(backend, 3, "tensored")
    assert built["calibration_circuits_used"] == 2
    print(f"tensored: {len(built['calibration'])} calibration circuits, "
          f"target depth {built['target'].depth()}")

    built_corr = build_circuits(backend, 3, "correlated")
    assert built_corr["calibration_circuits_used"] == 8

    try:
        build_circuits(backend, 5, "correlated")
        raise AssertionError("expected the correlated-qubit cap to be enforced")
    except ValueError:
        pass
    print("runner.py OK")
