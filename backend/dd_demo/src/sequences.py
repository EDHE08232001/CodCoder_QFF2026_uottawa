"""Pure-Python definitions of DD pulse sequences (no Qiskit needed).

A sequence is described by fractional pulse positions in (0, 1) over the idle
window and the rotation axis of each pulse.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class DDSequence:
    name: str
    positions: np.ndarray  # fractions of the total idle time, strictly in (0, 1)
    axes: tuple[str, ...]  # 'x' or 'y' for each pi pulse

    @property
    def n_pulses(self) -> int:
        return len(self.axes)


def _uniform(n: int) -> np.ndarray:
    """CPMG-style spacing: tau/2 at the ends, tau between pulses."""
    return (np.arange(1, n + 1) - 0.5) / n


def _udd(n: int) -> np.ndarray:
    """Uhrig spacing: t_k = sin^2(pi k / (2n + 2))."""
    return np.sin(np.pi * np.arange(1, n + 1) / (2 * n + 2)) ** 2


def build_sequence(name: str, n_pulses: int = 8) -> DDSequence:
    name = name.lower()
    if name == "free":
        return DDSequence("free", np.array([]), ())
    if name == "hahn":
        return DDSequence("hahn", _uniform(1), ("x",))
    if name == "cpmg":
        return DDSequence(f"cpmg{n_pulses}", _uniform(n_pulses), ("x",) * n_pulses)
    if name == "xy4":
        n = max(4, 4 * round(n_pulses / 4))
        axes = tuple("xyxy"[i % 4] for i in range(n))
        return DDSequence(f"xy4x{n // 4}", _uniform(n), axes)
    if name == "udd":
        return DDSequence(f"udd{n_pulses}", _udd(n_pulses), ("x",) * n_pulses)
    raise ValueError(f"Unknown sequence '{name}'. Use free/hahn/cpmg/xy4/udd.")

if __name__ == "__main__":
    np.set_printoptions(precision=3, suppress=True)
    for name in ["free", "hahn", "cpmg", "xy4", "udd"]:
        seq = build_sequence(name, n_pulses=8)
        print(f"{seq.name:8s} n_pulses={seq.n_pulses}")
        print("  positions:", seq.positions)
        print("  axes:     ", "".join(seq.axes) or "-")
        # sanity checks
        assert len(seq.positions) == seq.n_pulses
        assert np.all((seq.positions > 0) & (seq.positions < 1))
        assert np.all(np.diff(seq.positions) > 0)
    print("sequences.py OK")