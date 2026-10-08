"""Fast NumPy model: coherence of a dephasing qubit under a DD sequence.

Phase after time T:  phi = integral_0^T s(t) * beta(t) dt,
where s(t) = +/-1 flips sign at every pi pulse (the "switching function").
Coherence = < cos(phi) > averaged over noise realizations.
"""
from __future__ import annotations

import numpy as np

from .sequences import DDSequence


def switching_function(seq: DDSequence, total_time: float, t: np.ndarray) -> np.ndarray:
    n_before = np.searchsorted(seq.positions * total_time, t, side="right")
    return 1.0 - 2.0 * (n_before % 2)


def coherence_curve(
    seq: DDSequence, total_times: np.ndarray, noise: np.ndarray, dt: float
) -> np.ndarray:
    out = np.empty(len(total_times))
    for i, T in enumerate(total_times):
        m = int(round(T / dt))
        t = (np.arange(m) + 0.5) * dt
        s = switching_function(seq, T, t)
        phi = noise[:, :m] @ s * dt
        out[i] = np.mean(np.cos(phi))
    return out


if __name__ == "__main__":
    # run from the project root:  python -m src.theory
    from .noise import colored_noise
    from .sequences import build_sequence

    dt = 0.1e-6

    # 1) switching function: a Hahn echo flips the sign once, at the midpoint
    T = 10e-6
    t = (np.arange(100) + 0.5) * dt
    s = switching_function(build_sequence("hahn"), T, t)
    print("hahn switching: first half =", set(s[:50].tolist()),
          " second half =", set(s[50:].tolist()))
    assert set(s[:50].tolist()) == {1.0} and set(s[50:].tolist()) == {-1.0}

    # 2) a static detuning is cancelled exactly by a Hahn echo
    static = np.full((1, 1000), 2 * np.pi * 10e3)
    times = np.array([20e-6, 50e-6])
    c_free = coherence_curve(build_sequence("free"), times, static, dt)
    c_hahn = coherence_curve(build_sequence("hahn"), times, static, dt)
    print("static noise  free:", np.round(c_free, 3), " hahn:", np.round(c_hahn, 3))
    assert np.allclose(c_hahn, 1.0, atol=1e-6)

    # 3) 1/f noise: more pulses -> longer coherence
    noise = colored_noise(1000, 1000, dt, 2 * np.pi * 15e3, kind="1/f",
                          rng=np.random.default_rng(0))
    times = np.array([5e-6, 20e-6, 50e-6, 100e-6])
    print("times (us):", times * 1e6)
    res = {}
    for name in ["free", "hahn", "cpmg", "udd", "xy4"]:
        res[name] = coherence_curve(build_sequence(name, 8), times, noise, dt)
        print(f"{name:5s}", np.round(res[name], 3))
    assert res["cpmg"][-1] > res["hahn"][-1] > res["free"][-1] - 0.05
    assert res["free"][0] > 0.9
    print("theory.py OK")