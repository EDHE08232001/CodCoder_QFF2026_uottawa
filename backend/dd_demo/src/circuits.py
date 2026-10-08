"""Qiskit circuit builders.

* noisy_idle_circuit: idle window with an explicit noise trace baked in as RZ
  rotations between DD pulses (for the local, no-hardware simulation).
* ramsey_circuit: bare prepare / delay / un-prepare / measure circuit for real
  hardware, where the device supplies the noise.
"""
from __future__ import annotations

import math

import numpy as np
from qiskit import QuantumCircuit

from .sequences import DDSequence


def _prep(qc: QuantumCircuit, init: str) -> None:
    qc.h(0)
    if init == "y":
        qc.s(0)


def _unprep(qc: QuantumCircuit, init: str) -> None:
    if init == "y":
        qc.sdg(0)
    qc.h(0)


def _pulse(qc: QuantumCircuit, axis: str, eps: float = 0.0) -> None:
    angle = math.pi * (1.0 + eps)  # eps = fractional over-rotation
    (qc.rx if axis == "x" else qc.ry)(angle, 0)


def noisy_idle_circuit(
    seq: DDSequence,
    total_time: float,
    beta: np.ndarray,
    dt: float,
    init: str = "x",
    pulse_error: float = 0.0,
) -> QuantumCircuit:
    """Ramsey experiment where the idle noise beta(t) is applied as RZ gates."""
    m = int(round(total_time / dt))
    grid = np.arange(m + 1) * dt
    cum = np.concatenate([[0.0], np.cumsum(beta[:m]) * dt])

    def integral(t: float) -> float:
        return float(np.interp(t, grid, cum))

    edges = np.concatenate([[0.0], seq.positions * total_time, [total_time]])
    qc = QuantumCircuit(1)
    _prep(qc, init)
    for k in range(len(edges) - 1):
        qc.rz(integral(edges[k + 1]) - integral(edges[k]), 0)
        if k < seq.n_pulses:
            _pulse(qc, seq.axes[k], pulse_error)
    if seq.n_pulses % 2:  # odd pulse count: undo the net pi flip
        _pulse(qc, seq.axes[-1], pulse_error)
    _unprep(qc, init)
    return qc


def ramsey_circuit(delay_dt: int, init: str = "x") -> QuantumCircuit:
    """prepare -> idle(delay_dt) -> un-prepare -> measure. Ideal outcome is '0'."""
    qc = QuantumCircuit(1, 1)
    _prep(qc, init)
    qc.delay(delay_dt, 0, unit="dt")
    _unprep(qc, init)
    qc.measure(0, 0)
    return qc


if __name__ == "__main__":
    # run from the project root:  python -m src.circuits
    from qiskit.quantum_info import Statevector

    from .sequences import build_sequence

    def p0(qc: QuantumCircuit) -> float:
        return Statevector(qc).probabilities()[0]

    dt, n, T = 1e-7, 500, 40e-6
    static = np.full(n, 2 * np.pi * 10e3)  # static 10 kHz detuning
    zero = np.zeros(n)

    print("Hahn echo circuit (local sim):")
    print(noisy_idle_circuit(build_sequence("hahn"), T, static, dt).draw(fold=120))

    # 1) static detuning: free evolution scrambles, Hahn echo cancels it
    p_free = p0(noisy_idle_circuit(build_sequence("free"), T, static, dt))
    p_hahn = p0(noisy_idle_circuit(build_sequence("hahn"), T, static, dt))
    print(f"static detuning:  free P(0)={p_free:.3f}   hahn P(0)={p_hahn:.3f}")
    assert p_free < 0.5 and p_hahn > 0.999

    # 2) pulse errors only (no noise): XY4 is robust, CPMG is not (init=y)
    print("pulse error only (no noise), 3% over-rotation, 16 pulses, init=y:")
    res = {}
    for name in ["cpmg", "xy4"]:
        qc = noisy_idle_circuit(build_sequence(name, 16), T, zero, dt, init="y", pulse_error=0.03)
        res[name] = p0(qc)
        print(f"  {name:5s} P(0)={res[name]:.3f}")
    assert res["xy4"] > res["cpmg"]

    # 3) the bare circuit that goes to real hardware
    print("Hardware Ramsey circuit:")
    print(ramsey_circuit(160).draw(fold=120))
    print("circuits.py OK")