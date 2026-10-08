"""Vectorised single-qubit simulator for the noisy-idle DD experiment (NumPy only).

Same physics as ``circuits.noisy_idle_circuit``: prepare |+> or |+i>, let the
detuning noise act as RZ rotations between instantaneous pi pulses (with an
optional fractional over-rotation), undo the preparation and read P(0). All
noise realizations are evolved at once, so a full sweep takes milliseconds
instead of one Qiskit Statevector per realization. The test suite checks that
both implementations agree to machine precision.

Qiskit conventions: RZ(t) = diag(e^{-it/2}, e^{it/2}), RX/RY(a) = exp(-i a X/2), exp(-i a Y/2).
"""
from __future__ import annotations

import math

import numpy as np

from .sequences import DDSequence

_INIT_STATES = {
    "x": np.array([1, 1], dtype=complex) / math.sqrt(2),   # H|0>   = |+>
    "y": np.array([1, 1j], dtype=complex) / math.sqrt(2),  # S H|0> = |+i>
}


def _pulse_matrix(axis: str, eps: float) -> np.ndarray:
    half = math.pi * (1.0 + eps) / 2
    c, s = math.cos(half), math.sin(half)
    if axis == "x":
        return np.array([[c, -1j * s], [-1j * s, c]], dtype=complex)
    if axis == "y":
        return np.array([[c, -s], [s, c]], dtype=complex)
    raise ValueError(f"Unknown pulse axis '{axis}'")


def _rz(states: np.ndarray, theta: np.ndarray) -> np.ndarray:
    out = states.copy()
    out[:, 0] *= np.exp(-0.5j * theta)
    out[:, 1] *= np.exp(0.5j * theta)
    return out


def _cumulative_phase(beta: np.ndarray, dt: float, m: int) -> np.ndarray:
    return np.concatenate([np.zeros((beta.shape[0], 1)), np.cumsum(beta[:, :m], axis=1) * dt], axis=1)


def _phase_at(cum: np.ndarray, t: float, dt: float) -> np.ndarray:
    """Linear interpolation of the integrated phase, identical to np.interp on the dt grid."""
    m = cum.shape[1] - 1
    pos = t / dt
    i = int(min(max(math.floor(pos), 0), m - 1))
    frac = min(max(pos - i, 0.0), 1.0)
    return cum[:, i] + frac * (cum[:, i + 1] - cum[:, i])


def _check_noise(beta: np.ndarray, total_time: float, dt: float) -> tuple[np.ndarray, int]:
    beta = np.atleast_2d(np.asarray(beta, dtype=float))
    m = int(round(total_time / dt))
    if m < 1:
        raise ValueError("total_time must span at least one noise sample")
    if beta.shape[1] < m:
        raise ValueError(f"noise trace has {beta.shape[1]} samples, need {m}")
    return beta, m


def bloch(states: np.ndarray) -> np.ndarray:
    """Bloch vectors (..., 3) of single-qubit states (..., 2)."""
    a, b = states[..., 0], states[..., 1]
    ab = np.conj(a) * b
    return np.stack([2 * ab.real, 2 * ab.imag, np.abs(a) ** 2 - np.abs(b) ** 2], axis=-1)


def survival_probability(
    seq: DDSequence,
    total_time: float,
    beta: np.ndarray,
    dt: float,
    init: str = "x",
    pulse_error: float = 0.0,
) -> np.ndarray:
    """P(0) for every noise realization (rows of ``beta``); matches noisy_idle_circuit."""
    beta, m = _check_noise(beta, total_time, dt)
    cum = _cumulative_phase(beta, dt, m)
    psi0 = _INIT_STATES[init]
    states = np.tile(psi0, (beta.shape[0], 1))
    edges = np.concatenate([[0.0], seq.positions * total_time, [total_time]])
    pulses = [_pulse_matrix(axis, pulse_error) for axis in seq.axes]
    previous = _phase_at(cum, edges[0], dt)
    for k in range(len(edges) - 1):
        current = _phase_at(cum, edges[k + 1], dt)
        states = _rz(states, current - previous)
        previous = current
        if k < seq.n_pulses:
            states = states @ pulses[k].T
    if seq.n_pulses % 2:  # odd pulse count: undo the net pi flip, as in circuits.py
        states = states @ pulses[-1].T
    overlap = states @ np.conj(psi0)
    return np.abs(overlap) ** 2


def mean_survival(seq, total_time, beta, dt, init="x", pulse_error=0.0) -> float:
    return float(np.mean(survival_probability(seq, total_time, beta, dt, init, pulse_error)))


def survival_curve(seq, total_times, beta, dt, init="x", pulse_error=0.0) -> np.ndarray:
    return np.array([mean_survival(seq, T, beta, dt, init, pulse_error) for T in total_times])


def bloch_trajectories(
    seq: DDSequence,
    total_time: float,
    beta: np.ndarray,
    dt: float,
    frames: int,
    init: str = "x",
    pulse_error: float = 0.0,
) -> np.ndarray:
    """Lab-frame Bloch vectors, shape (n_spins, frames, 3), on an even time grid.

    Pulses are applied the instant the clock passes their position, so the
    picture shows each spin precessing, jumping at every pi pulse and (for
    slow noise) refocusing. No corrective final pulse is added here.
    """
    beta, m = _check_noise(beta, total_time, dt)
    cum = _cumulative_phase(beta, dt, m)
    states = np.tile(_INIT_STATES[init], (beta.shape[0], 1))
    events = sorted(
        [(t, 1, None) for t in np.linspace(0.0, total_time, frames)]
        + [(p * total_time, 0, axis) for p, axis in zip(seq.positions, seq.axes)],
        key=lambda event: (event[0], event[1]),
    )
    out = []
    clock = 0.0
    previous = _phase_at(cum, 0.0, dt)
    for t, kind, axis in events:
        if t > clock:
            current = _phase_at(cum, t, dt)
            states = _rz(states, current - previous)
            previous, clock = current, t
        if kind == 0:
            states = states @ _pulse_matrix(axis, pulse_error).T
        else:
            out.append(bloch(states))
    return np.stack(out, axis=1)


if __name__ == "__main__":
    # run from the project root:  python -m src.fastsim
    import time

    from qiskit.quantum_info import Statevector

    from .circuits import noisy_idle_circuit
    from .noise import colored_noise
    from .sequences import build_sequence

    dt, T = 0.1e-6, 40e-6
    noise = colored_noise(20, 400, dt, 2 * np.pi * 20e3, rng=np.random.default_rng(1))
    worst = 0.0
    for name in ["free", "hahn", "cpmg", "xy4", "udd"]:
        for init in ["x", "y"]:
            seq = build_sequence(name, 6)
            fast = survival_probability(seq, T, noise, dt, init=init, pulse_error=0.04)
            slow = [Statevector(noisy_idle_circuit(seq, T, noise[r], dt, init, 0.04)).probabilities()[0]
                    for r in range(len(noise))]
            worst = max(worst, float(np.max(np.abs(fast - slow))))
    print(f"max |fastsim - qiskit| over 200 cases = {worst:.2e}")
    assert worst < 1e-9

    traj = bloch_trajectories(build_sequence("hahn"), T, np.full((3, 400), 2 * np.pi * 10e3), dt, 41)
    print("Hahn echo, static detuning: start", np.round(traj[0, 0], 3), " end", np.round(traj[0, -1], 3))
    assert np.allclose(traj[:, -1], [1, 0, 0], atol=1e-9)

    big = colored_noise(2000, 1000, dt, 2 * np.pi * 15e3, rng=np.random.default_rng(0))
    t0 = time.time()
    p = mean_survival(build_sequence("xy4", 16), 100e-6, big, dt, init="y", pulse_error=0.03)
    print(f"2000 realizations, 16 pulses: P(0)={p:.3f} in {1e3 * (time.time() - t0):.1f} ms")
    print("fastsim.py OK")
