"""Teaching scenarios behind the CODFISH "Pulse Patrol" web game (NumPy only).

Each level is a fixed, seeded noise scenario. The player proposes a pulse
sequence and gets back the score (from the exact simulator in fastsim.py),
the preset sequences for comparison and a short animation of sample spins.

Score convention ("signal"): 2 * P(0) - 1, i.e. how much of the starting
superposition survives the idle window. 1 = perfectly kept, 0 = scrambled,
negative = coherently rotated towards the opposite state.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from functools import lru_cache

import numpy as np

from .fastsim import bloch_trajectories, survival_probability
from .noise import colored_noise
from .sequences import DDSequence, build_sequence
from .theory import coherence_curve

DT = 0.1e-6            # noise sample spacing, seconds
FRAMES = 96            # animation frames sent to the browser
DISPLAY_SPINS = 12     # sample spins drawn in the animation
PRESET_LABELS = {"free": "No pulses", "hahn": "Hahn echo", "cpmg": "CPMG", "udd": "UDD", "xy4": "XY4"}
NOISE_KINDS = ("1/f", "lorentzian", "white", "static")


@dataclass(frozen=True)
class Level:
    id: str
    noise: str
    sigma_khz: float
    total_time_us: float
    max_pulses: int
    target: float | None          # signal needed to pass; None = cannot be beaten (quiz level)
    init: str = "x"
    pulse_error: float = 0.0      # fractional over-rotation of every pi pulse
    edit: str = "place"           # "place": pulses anywhere; "axes": evenly spaced, choose X/Y
    slot_counts: tuple[int, ...] = ()
    realizations: int = 800
    seed: int = 0
    presets: tuple[str, ...] = ("free", "hahn", "cpmg", "udd", "xy4")

    @property
    def total_time(self) -> float:
        return self.total_time_us * 1e-6

    @property
    def n_steps(self) -> int:
        return int(round(self.total_time / DT))


LEVELS: dict[str, Level] = {
    level.id: level
    for level in [
        Level("echo", "static", 25.0, 40.0, 1, 0.9, realizations=600, seed=10, presets=("free", "hahn")),
        Level("drift", "1/f", 15.0, 100.0, 10, 0.5, seed=11),
        Level("wobble", "1/f", 10.0, 80.0, 16, 0.8, init="y", pulse_error=0.05, edit="axes",
              slot_counts=(4, 8, 12, 16), realizations=400, seed=12, presets=("free", "cpmg", "xy4")),
        Level("fast", "white", 90.0, 60.0, 10, None, realizations=2000, seed=13),
    ]
}


def describe_levels() -> list[dict]:
    return [asdict(level) for level in LEVELS.values()]


@lru_cache(maxsize=6)  # each entry is at most 1000 x 2000 floats (16 MB)
def _noise(kind: str, sigma_khz: float, n_steps: int, realizations: int, seed: int) -> np.ndarray:
    trace = colored_noise(realizations, n_steps, DT, 2 * np.pi * sigma_khz * 1e3, kind=kind,
                          rng=np.random.default_rng(seed))
    trace.setflags(write=False)  # shared through the cache
    return trace


def level_noise(level: Level) -> np.ndarray:
    return _noise(level.noise, level.sigma_khz, level.n_steps, level.realizations, level.seed)


def display_noise(level: Level) -> np.ndarray:
    """The few spins drawn on screen: evenly spread offsets for the static case."""
    if level.noise == "static":
        sigma = 2 * np.pi * level.sigma_khz * 1e3
        offsets = np.linspace(-1.6, 1.6, DISPLAY_SPINS) * sigma
        return np.repeat(offsets[:, None], level.n_steps, axis=1)
    return level_noise(level)[:DISPLAY_SPINS]


def make_sequence(pulses: list[tuple[float, str]], name: str = "custom") -> DDSequence:
    """Validate (position, axis) pairs and build a sorted DDSequence."""
    ordered = sorted((float(p), str(a).lower()) for p, a in pulses)
    positions = np.array([p for p, _ in ordered], dtype=float)
    axes = tuple(a for _, a in ordered)
    if not np.all(np.isfinite(positions)) or np.any((positions <= 0) | (positions >= 1)):
        raise ValueError("Pulse positions must lie strictly between 0 and 1")
    if np.any(np.diff(positions) < 1e-3):
        raise ValueError("Two pulses cannot share the same position")
    if any(a not in ("x", "y") for a in axes):
        raise ValueError("Pulse axis must be 'x' or 'y'")
    return DDSequence(name, positions, axes)


def even_positions(n: int) -> list[float]:
    return [round(float(p), 6) for p in (np.arange(1, n + 1) - 0.5) / n]


def signal(level: Level, seq: DDSequence) -> float:
    p0 = survival_probability(seq, level.total_time, level_noise(level), DT, level.init, level.pulse_error)
    return float(2 * np.mean(p0) - 1)


def preset_sequences(level: Level) -> list[tuple[str, DDSequence]]:
    n = max(level.slot_counts) if level.edit == "axes" else level.max_pulses
    return [(name, build_sequence(name, n)) for name in level.presets]


def _pulse_list(seq: DDSequence, level: Level) -> list[dict]:
    return [{"position": round(float(p), 6), "axis": a, "time_us": round(float(p) * level.total_time_us, 3)}
            for p, a in zip(seq.positions, seq.axes)]


def _stars(level: Level, score: float, best: float) -> int:
    if level.target is None or score < level.target:
        return 0
    if score >= best - 0.02:
        return 3
    if score >= (level.target + best) / 2:
        return 2
    return 1


def animate(level: Level, seq: DDSequence, frames: int = FRAMES) -> dict:
    spins = bloch_trajectories(seq, level.total_time, display_noise(level), DT, frames,
                               level.init, level.pulse_error)
    ensemble = bloch_trajectories(seq, level.total_time, level_noise(level), DT, frames,
                                  level.init, level.pulse_error)
    coherence = np.linalg.norm(ensemble[:, :, :2].mean(axis=0), axis=-1)
    return {
        "times_us": np.round(np.linspace(0, level.total_time_us, frames), 3).tolist(),
        "spins": np.round(spins[:, :, :2], 3).tolist(),
        "coherence": np.round(coherence, 4).tolist(),
    }


def play(level_id: str, pulses: list[tuple[float, str]]) -> dict:
    level = LEVELS.get(level_id)
    if level is None:
        raise KeyError(level_id)
    if len(pulses) > level.max_pulses:
        raise ValueError(f"This level allows at most {level.max_pulses} pulse{'s' if level.max_pulses != 1 else ''}")
    seq = make_sequence(pulses)
    score = signal(level, seq)
    presets = []
    for key, preset in preset_sequences(level):
        presets.append({"name": preset.name, "label": PRESET_LABELS[key],
                        "signal": round(signal(level, preset), 4), "pulses": _pulse_list(preset, level)})
    with_pulses = [p for p in presets if p["pulses"]]
    best = max(with_pulses, key=lambda p: p["signal"]) if with_pulses else presets[0]
    baseline = next(p["signal"] for p in presets if p["name"] == "free")
    return {
        "level": level.id,
        "signal": round(score, 4),
        "p0": round((1 + score) / 2, 4),
        "baseline": baseline,
        "target": level.target,
        "passed": level.target is not None and score >= level.target,
        "stars": _stars(level, score, best["signal"]),
        "best": {"name": best["name"], "signal": best["signal"]},
        "presets": presets,
        "pulses": _pulse_list(seq, level),
        "animation": animate(level, seq),
    }


def explore(engine: str = "theory", noise: str = "1/f", sigma_khz: float = 15.0, pulses: int = 8,
            max_time_us: float = 100.0, points: int = 20, init: str = "x", pulse_error: float = 0.0,
            sequences: tuple[str, ...] = ("free", "hahn", "cpmg", "udd", "xy4"), seed: int = 7) -> dict:
    """Signal versus idle time for several sequences, like ``main.py theory`` / ``main.py local``."""
    if engine not in ("theory", "circuit"):
        raise ValueError("engine must be 'theory' or 'circuit'")
    if noise not in NOISE_KINDS:
        raise ValueError(f"noise must be one of {NOISE_KINDS}")
    realizations = 1000 if engine == "theory" else 400
    n_steps = int(np.ceil(max_time_us * 1e-6 / DT))
    trace = _noise(noise, float(sigma_khz), n_steps, realizations, int(seed))
    times = np.linspace(max_time_us / points, max_time_us, points) * 1e-6
    curves = []
    for name in dict.fromkeys(sequences):  # de-duplicate, keep order
        seq = build_sequence(name, pulses)
        if engine == "theory":
            values = coherence_curve(seq, times, trace, DT)
        else:
            values = np.array([2 * np.mean(survival_probability(seq, T, trace, DT, init, pulse_error)) - 1
                               for T in times])
        curves.append({"name": seq.name, "sequence": name, "pulses": seq.n_pulses,
                       "values": np.round(values, 4).tolist()})
    return {"engine": engine, "noise": noise, "sigma_khz": sigma_khz, "init": init if engine == "circuit" else "x",
            "pulse_error": pulse_error if engine == "circuit" else 0.0,
            "times_us": np.round(times * 1e6, 3).tolist(), "curves": curves}


if __name__ == "__main__":
    # run from the project root:  python -m src.game
    import time

    t0 = time.time()
    echo = play("echo", [(0.5, "x")])
    off = play("echo", [(0.3, "x")])
    print(f"echo   mid pulse {echo['signal']:.3f} (passed={echo['passed']}), 30% pulse {off['signal']:.3f}, "
          f"no pulse {echo['baseline']:.3f}")
    assert echo["passed"] and echo["stars"] == 3 and not off["passed"]

    drift_one = play("drift", [(0.5, "x")])
    drift_ten = play("drift", [(p, "x") for p in even_positions(10)])
    print(f"drift  hahn {drift_one['signal']:.3f}, 10 even pulses {drift_ten['signal']:.3f} "
          f"(target {drift_ten['target']}), presets "
          + ", ".join(f"{p['name']}={p['signal']:.3f}" for p in drift_ten["presets"]))
    assert not drift_one["passed"] and drift_ten["passed"]

    slots = even_positions(16)
    all_x = play("wobble", [(p, "x") for p in slots])
    alt = play("wobble", [(p, "xy"[i % 2]) for i, p in enumerate(slots)])
    print(f"wobble all-X {all_x['signal']:.3f}, XYXY {alt['signal']:.3f} (target {alt['target']})")
    assert not all_x["passed"] and alt["passed"]

    fast_free = play("fast", [])
    fast_dd = play("fast", [(p, "x") for p in even_positions(10)])
    print(f"fast   free {fast_free['signal']:.3f}, 10 pulses {fast_dd['signal']:.3f}")
    assert abs(fast_dd["signal"] - fast_free["signal"]) < 0.1 and not fast_dd["passed"]

    frames = echo["animation"]
    assert len(frames["times_us"]) == FRAMES and len(frames["spins"]) == DISPLAY_SPINS
    assert frames["coherence"][0] > 0.99 and frames["coherence"][-1] > 0.9

    for engine in ("theory", "circuit"):
        out = explore(engine=engine, points=6)
        print(f"explore[{engine}] @ {out['times_us'][-1]} us: "
              + ", ".join(f"{c['name']}={c['values'][-1]:.3f}" for c in out["curves"]))
    print(f"({time.time() - t0:.1f}s)")
    print("game.py OK")
