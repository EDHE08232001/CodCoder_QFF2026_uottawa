"""Transpile, optionally add DD, and execute Ramsey sweeps on a backend."""
from __future__ import annotations

import numpy as np
from qiskit.circuit.library import XGate
from qiskit.transpiler import PassManager
from qiskit.transpiler.passes import ALAPScheduleAnalysis, PadDynamicalDecoupling
from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager
from qiskit_ibm_runtime import SamplerV2

from .circuits import ramsey_circuit

# mode strings:  "none" | "runtime-XX" | "runtime-XpXm" | "runtime-XY4" | "manual-XX"
RUNTIME_SEQS = {"XX", "XpXm", "XY4"}


def delays_in_dt(backend, delays_s: np.ndarray) -> list[int]:
    """Round delays to a multiple of the backend's delay granularity (in dt)."""
    g = max(16, getattr(backend.target, "granularity", 16) or 16)  # IBM delays: multiples of 16 dt
    return [max(g, int(round(d / backend.dt / g)) * g) for d in delays_s]


def build_isa_circuits(backend, qubit: int, delays_dt: list[int], init: str):
    pm = generate_preset_pass_manager(
        optimization_level=1, backend=backend, initial_layout=[qubit]
    )
    return pm.run([ramsey_circuit(d, init) for d in delays_dt])


def add_manual_dd(backend, circuits):
    """Explicit DD pass (shows what the runtime option does under the hood)."""
    target = backend.target
    pm = PassManager(
        [
            ALAPScheduleAnalysis(target=target),
            PadDynamicalDecoupling(
                target=target,
                dd_sequence=[XGate(), XGate()],
                pulse_alignment=target.pulse_alignment,
            ),
        ]
    )
    return pm.run(circuits)


MODES = ("none", *(f"runtime-{seq}" for seq in sorted(RUNTIME_SEQS)), "manual-XX")


def submit_sweep(backend, circuits, mode: str, shots: int):
    """Submit all circuits as one job without waiting; returns the runtime job."""
    if mode not in MODES:
        raise ValueError(f"Unknown mode '{mode}'. Use one of {', '.join(MODES)}")
    sampler = SamplerV2(mode=backend)
    # Set DD explicitly so the baseline never depends on the service default.
    sampler.options.dynamical_decoupling.enable = mode.startswith("runtime-")
    if mode.startswith("runtime-"):
        sampler.options.dynamical_decoupling.sequence_type = mode.split("-", 1)[1]
    elif mode == "manual-XX":
        circuits = add_manual_dd(backend, circuits)
    return sampler.run(circuits, shots=shots)


def counts_from_result(result) -> list[dict[str, int]]:
    return [r.data.c.get_counts() for r in result]


def run_sweep(backend, circuits, mode: str, shots: int):
    """Run all circuits in one job; returns a list of count dicts."""
    job = submit_sweep(backend, circuits, mode, shots)
    print(f"  [{mode}] job id: {job.job_id()}")
    return counts_from_result(job.result())


def count_dd_pulses(circuit) -> int:
    ops = circuit.count_ops()
    return int(ops.get("x", 0))


if __name__ == "__main__":
    # run from the project root:  python -m src.runner
    # Offline check on the fake backend (takes ~30 s). Edit `backend` to test a real device.
    import time

    from .analysis import p0_curve
    from .ibm import fake_backend

    backend = fake_backend()
    delays_dt = delays_in_dt(backend, np.array([10e-6, 30e-6, 60e-6]))
    print("delays (dt):", delays_dt, "->",
          [round(d * backend.dt * 1e6, 2) for d in delays_dt], "us")
    assert all(d % 16 == 0 for d in delays_dt)

    isa = build_isa_circuits(backend, qubit=0, delays_dt=delays_dt, init="x")
    dd = add_manual_dd(backend, isa)
    n_plain = [count_dd_pulses(c) for c in isa]
    n_dd = [count_dd_pulses(c) for c in dd]
    print("x gates without DD:    ", n_plain)
    print("x gates with manual-XX:", n_dd)
    assert all(b > a for a, b in zip(n_plain, n_dd))

    t0 = time.time()
    for mode in ["none", "manual-XX"]:  # runtime-* options are ignored by the local simulator
        counts = run_sweep(backend, isa, mode, shots=300)
        print(f"{mode:10s} P(0) =", np.round(p0_curve(counts), 3))
    print(f"({time.time() - t0:.0f}s)")
    print("runner.py OK")