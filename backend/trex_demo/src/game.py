"""Teaching levels behind the CODFISH "Detector Decoder" web game (NumPy + qiskit circuits only).

Each level is a fixed, seeded readout-error scenario. The player (or the API,
for fixed levels) picks a calibration strategy -- 'tensored' (cheap: 2 global
calibration circuits, assumes every qubit misreads independently) or
'correlated' (expensive: 2**n basis-state circuits, exact either way) -- and
the backend scores how well that calibration corrects a noisy measurement
against the known, noiseless answer.

  bias       1 biased qubit, no crosstalk          -> the 2x2 matrix, inverted
  crowd      4 qubits, independent errors only      -> tensored is exact and cheap
  crosstalk  same qubits, plus readout crosstalk     -> tensored is not enough; correlated is
  ghz        entangled target, scored by parity      -> inversion can be unphysical; nnls stays physical
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from functools import lru_cache

import numpy as np

from . import calibration, circuits, noise

CalibrationMode = str  # 'tensored' | 'correlated'


@dataclass(frozen=True)
class Level:
    id: str
    label: str
    description: str
    qubits: int
    per_qubit_errors: tuple[tuple[float, float], ...]
    crosstalk_pairs: tuple[tuple[int, int, float], ...] = ()
    target_kind: str = "ghz"          # 'bias' (classical) or 'ghz' (entangled)
    target_bias: float | None = None  # only for target_kind == 'bias': true P(measure 1)
    metric: str = "distribution"      # 'distribution' (total variation) or 'parity' (<Z...Z>)
    target: float = 0.03              # pass threshold on the metric (lower is better)
    shots: int = 4096
    seed: int = 7
    modes: tuple[CalibrationMode, ...] = ("tensored",)


LEVELS: dict[str, Level] = {
    level.id: level
    for level in [
        Level("bias", "Biased detector", "One qubit with an asymmetric readout error.",
              qubits=1, per_qubit_errors=((0.25, 0.08),),
              target_kind="bias", target_bias=0.7, metric="distribution", target=0.02, seed=10),
        Level("crowd", "A crowd of honest detectors", "Four qubits, each with its own independent readout error.",
              qubits=4,
              per_qubit_errors=((0.10, 0.03), (0.15, 0.05), (0.05, 0.02), (0.20, 0.10)),
              metric="distribution", target=0.03, seed=11),
        Level("crosstalk", "Two detectors gossip", "Same four qubits, but two pairs now misread together.",
              qubits=4,
              per_qubit_errors=((0.10, 0.03), (0.15, 0.05), (0.05, 0.02), (0.20, 0.10)),
              crosstalk_pairs=((0, 1, 0.15), (2, 3, 0.15)),
              metric="distribution", target=0.04, shots=8192, modes=("tensored", "correlated"), seed=12),
        Level("ghz", "Correct the entangled state", "A GHZ state scored by its parity, not just raw counts.",
              qubits=4,
              per_qubit_errors=((0.08, 0.03), (0.10, 0.04), (0.06, 0.02), (0.12, 0.05)),
              crosstalk_pairs=((1, 2, 0.06),),
              metric="parity", target=0.05, modes=("tensored", "correlated"), seed=13),
    ]
}
MAX_SANDBOX_QUBITS = 5


def describe_levels() -> list[dict]:
    return [asdict(level) for level in LEVELS.values()]


def _ideal_distribution(level: Level) -> np.ndarray:
    if level.target_kind == "bias":
        return np.array([1 - level.target_bias, level.target_bias])
    return circuits.ideal_probabilities(circuits.ghz_circuit(level.qubits, measure=False))


def _parity(vector: np.ndarray, qubits: int) -> float:
    """<Z_0 Z_1 ... Z_{qubits-1}>: +1 for an even number of 1s, -1 for odd."""
    signs = np.array([1 - 2 * (bin(state).count("1") % 2) for state in range(len(vector))])
    return float(vector @ signs)


def _stars(target: float, score: float, passed: bool) -> int:
    if not passed:
        return 0
    if score <= target / 5:
        return 3
    return 2 if score <= target / 2 else 1


def _calibrate(qubits: int, mode: str, per_qubit_errors, crosstalk_pairs, shots: int,
               rng: np.random.Generator) -> tuple[np.ndarray, int]:
    if mode == "tensored":
        counts0 = noise.calibration_counts(qubits, 0, shots, per_qubit_errors, crosstalk_pairs, rng)
        counts1 = noise.calibration_counts(qubits, 2 ** qubits - 1, shots, per_qubit_errors, crosstalk_pairs, rng)
        matrices = [calibration.calibrate_1q_from_global_counts(counts0, counts1, qubit, qubits)
                   for qubit in range(qubits)]
        return calibration.tensor_assignment_matrix(matrices), 2
    if mode == "correlated":
        basis_counts = [noise.calibration_counts(qubits, state, shots, per_qubit_errors, crosstalk_pairs, rng)
                        for state in range(2 ** qubits)]
        return calibration.correlated_assignment_matrix(basis_counts), 2 ** qubits
    raise ValueError("calibration_mode must be 'tensored' or 'correlated'")


def _run(qubits: int, per_qubit_errors, crosstalk_pairs, ideal: np.ndarray, calibration_mode: str,
        shots: int, seed: int) -> dict:
    rng = np.random.default_rng(seed)
    assignment, calibration_circuits_used = _calibrate(qubits, calibration_mode, per_qubit_errors,
                                                        crosstalk_pairs, shots, rng)
    raw_counts = noise.target_counts(ideal, shots, per_qubit_errors, crosstalk_pairs, rng)
    measured = calibration.counts_to_vector(raw_counts, qubits)
    inverted = calibration.invert_correct(assignment, measured)
    corrected = calibration.nnls_correct(assignment, measured)
    return {
        "calibration_mode": calibration_mode,
        "calibration_circuits_used": calibration_circuits_used,
        "assignment_matrix": assignment.tolist(),
        "assignment_condition_number": round(calibration.condition_number(assignment), 3),
        "raw_distribution": calibration.vector_to_counts(measured, qubits),
        "corrected_distribution": calibration.vector_to_counts(corrected, qubits),
        "inverted_distribution": calibration.vector_to_counts(inverted, qubits),
        "inverted_negative_mass": round(float(-inverted[inverted < 0].sum()), 6),
        "ideal_distribution": calibration.vector_to_counts(ideal, qubits),
        "raw_total_variation": round(calibration.total_variation(measured, ideal), 6),
        "corrected_total_variation": round(calibration.total_variation(corrected, ideal), 6),
    }


def play(level_id: str, calibration_mode: str = "tensored", shots: int | None = None,
         seed: int | None = None) -> dict:
    level = LEVELS.get(level_id)
    if level is None:
        raise ValueError(f"Unknown level '{level_id}'. Use one of {', '.join(LEVELS)}")
    if calibration_mode not in level.modes:
        raise ValueError(f"Level '{level_id}' only supports calibration_mode in {level.modes}")
    ideal = _ideal_distribution(level)
    result = _run(level.qubits, level.per_qubit_errors, level.crosstalk_pairs, ideal, calibration_mode,
                  shots or level.shots, seed if seed is not None else level.seed)

    if level.metric == "distribution":
        score = result["corrected_total_variation"]
    else:
        parity_corrected = _parity(calibration.counts_to_vector(result["corrected_distribution"], level.qubits),
                                   level.qubits)
        score = abs(parity_corrected - 1.0)
        result["parity_ideal"] = 1.0
        result["parity_raw"] = round(_parity(calibration.counts_to_vector(result["raw_distribution"], level.qubits),
                                             level.qubits), 6)
        result["parity_corrected"] = round(parity_corrected, 6)

    passed = bool(score <= level.target)
    return dict(result, level=level.id, label=level.label, metric=level.metric, target=level.target,
               score=round(score, 6), passed=passed, stars=_stars(level.target, score, passed))


def explore(qubits: int = 3, per_qubit_errors: list[tuple[float, float]] | None = None,
           crosstalk_pairs: list[tuple[int, int, float]] | None = None, target_kind: str = "ghz",
           target_bias: float = 0.5, calibration_mode: str = "tensored", shots: int = 4096,
           seed: int = 7) -> dict:
    """Free-form sandbox: any qubit count/error rates/crosstalk/calibration mode."""
    if not 1 <= qubits <= MAX_SANDBOX_QUBITS:
        raise ValueError(f"qubits must be between 1 and {MAX_SANDBOX_QUBITS}")
    per_qubit_errors = per_qubit_errors or [(0.1, 0.05)] * qubits
    if len(per_qubit_errors) != qubits:
        raise ValueError("per_qubit_errors must have one (p01, p10) pair per qubit")
    if any(not (0 <= p01 <= 1 and 0 <= p10 <= 1) for p01, p10 in per_qubit_errors):
        raise ValueError("per_qubit_errors rates must be between 0 and 1")
    crosstalk_pairs = crosstalk_pairs or []
    for left, right, strength in crosstalk_pairs:
        if not (0 <= left < qubits and 0 <= right < qubits and left != right):
            raise ValueError("crosstalk pair qubit indices must be distinct and within range")
        if not 0 <= strength <= 1:
            raise ValueError("crosstalk strength must be between 0 and 1")
    ideal = (np.array([1 - target_bias, target_bias]) if target_kind == "bias" and qubits == 1
            else circuits.ideal_probabilities(circuits.ghz_circuit(qubits, measure=False)))
    result = _run(qubits, per_qubit_errors, crosstalk_pairs, ideal, calibration_mode, shots, seed)
    return dict(result, qubits=qubits, target_kind=target_kind)


if __name__ == "__main__":
    # run from the project root:  python -m src.game
    bias = play("bias")
    print(f"bias: corrected TV {bias['corrected_total_variation']:.4f} (target {bias['target']}), "
          f"passed={bias['passed']} stars={bias['stars']}")
    assert bias["passed"] and bias["stars"] >= 1

    crowd = play("crowd")
    print(f"crowd: corrected TV {crowd['corrected_total_variation']:.4f}, passed={crowd['passed']}")
    assert crowd["passed"]

    tensored = play("crosstalk", calibration_mode="tensored")
    correlated = play("crosstalk", calibration_mode="correlated")
    print(f"crosstalk tensored TV {tensored['corrected_total_variation']:.4f} (passed={tensored['passed']}), "
          f"correlated TV {correlated['corrected_total_variation']:.4f} (passed={correlated['passed']})")
    assert not tensored["passed"], "the cheap calibration should not fix a correlated error"
    assert correlated["passed"], "the full calibration should fix it"
    assert correlated["calibration_circuits_used"] == 2 ** LEVELS["crosstalk"].qubits
    assert tensored["calibration_circuits_used"] == 2

    ghz = play("ghz", calibration_mode="correlated")
    print(f"ghz: parity raw {ghz['parity_raw']:+.4f}, corrected {ghz['parity_corrected']:+.4f} "
          f"(ideal +1), inverted negative mass {ghz['inverted_negative_mass']:.4f}, passed={ghz['passed']}")
    assert ghz["inverted_negative_mass"] > 0, "expect naive inversion to be visibly unphysical here"
    assert abs(ghz["parity_corrected"] - 1.0) < abs(ghz["parity_raw"] - 1.0)

    assert play("bias", seed=1) == play("bias", seed=1)

    sandbox = explore(qubits=3, per_qubit_errors=[(0.1, 0.05)] * 3, crosstalk_pairs=[(0, 1, 0.1)])
    print(f"sandbox: corrected TV {sandbox['corrected_total_variation']:.4f}")
    assert sandbox["qubits"] == 3
    print("game.py OK")
