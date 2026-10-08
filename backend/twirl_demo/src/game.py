"""Teaching scenarios behind the CODFISH "Shuffle the Error" web game.

Every scenario runs the same transverse-field Ising quench; only the noise the
gates pick up changes. That is the whole lesson: twirling cannot be judged from
the circuit, only from the kind of error the hardware makes.

  coherent   residual ZZ crosstalk, a unitary that repeats every shot -> twirling helps
  stochastic two-qubit depolarizing noise, already a Pauli channel     -> twirling does nothing
  mixed      both at once                                             -> only the coherent part goes
  clean      no noise at all                                          -> nothing to twirl
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
from qiskit.quantum_info import Statevector

from . import noise, simulate, twirl
from .problems import MAX_QUBITS, MAX_STEPS, MIN_QUBITS, describe, exact, ideal, quench_circuit, witness_describe

DEFAULTS = {"qubits": 4, "steps": 4, "field": 0.6, "randomizations": 16, "shots": 512}
LIMITS = {"qubits": [MIN_QUBITS, MAX_QUBITS], "steps": [1, MAX_STEPS], "field": [0.0, 2.0],
          "randomizations": [1, 64], "shots": [32, 4096], "coherent_angle": [0.0, 0.2],
          "depolarizing": [0.0, 0.1]}


@dataclass(frozen=True)
class Scenario:
    id: str
    label: str
    coherent_angle: float      # radians of extra ZZ rotation after every two-qubit gate
    depolarizing: float        # two-qubit depolarizing probability per gate
    twirl_helps: bool
    target: float | None = None  # magnetisation error the twirled run must beat to pass


SCENARIOS: dict[str, Scenario] = {
    scenario.id: scenario
    for scenario in [
        Scenario("coherent", "Coherent ZZ crosstalk", 0.08, 0.0, True, target=0.04),
        Scenario("stochastic", "Depolarizing (already random)", 0.0, 0.02, False),
        Scenario("mixed", "Both kinds at once", 0.08, 0.02, True),
        Scenario("clean", "No noise at all", 0.0, 0.0, False),
    ]
}


def describe_scenarios() -> dict:
    return {"scenarios": [asdict(scenario) for scenario in SCENARIOS.values()],
            "defaults": DEFAULTS, "limits": LIMITS, "aer_available": noise.aer_available(),
            "ibm_preset": witness_describe()}


def _stars(target: float | None, error: float, passed: bool) -> int:
    if not passed or target is None:
        return 0
    if error <= target / 3:
        return 3
    return 2 if error <= 2 * target / 3 else 1


def play(scenario_id: str, qubits: int = 4, steps: int = 4, field: float = 0.6,
         randomizations: int = 16, shots: int = 512, seed: int = 7,
         coherent_angle: float | None = None, depolarizing: float | None = None) -> dict:
    """Run one scenario on Aer and score it. The noise knobs can be overridden."""
    scenario = SCENARIOS.get(scenario_id)
    if scenario is None:
        raise ValueError(f"Unknown scenario '{scenario_id}'. Use one of {', '.join(SCENARIOS)}")
    angle = scenario.coherent_angle if coherent_angle is None else coherent_angle
    depolarize = scenario.depolarizing if depolarizing is None else depolarizing
    result = simulate.run(qubits, steps, field, randomizations, shots, angle, depolarize, seed)
    passed = bool(scenario.target is not None
                  and result["twirled"]["error"] <= scenario.target
                  and result["comparison"]["improved"])
    return dict(result, scenario=scenario.id, scenario_label=scenario.label,
                twirl_helps=scenario.twirl_helps, target=scenario.target, passed=passed,
                stars=_stars(scenario.target, result["twirled"]["error"], passed))


def circuit_preview(qubits: int = 4, steps: int = 4, field: float = 0.6, seed: int = 7) -> dict:
    """The circuit before and after one randomisation, drawn and counted.

    ``ideal_match`` is checked here rather than asserted: it is the claim the
    player is asked to believe, so the backend proves it on every request.
    """
    bare = quench_circuit(qubits, steps, field, measure=False)
    twirled, frames = twirl.twirl(bare, np.random.default_rng(seed))
    reference = Statevector(bare).probabilities()
    shifted = Statevector(twirled).probabilities()

    def drawn(circuit, measured=True):
        shown = circuit.copy()
        if measured:
            shown.measure_all()
        return {"text": str(shown.draw(output="text", fold=-1)),
                "depth": shown.depth(), "gates": sum(shown.count_ops().values()),
                "ops": dict(sorted(shown.count_ops().items())),
                "two_qubit_gates": twirl.two_qubit_gates(shown)}

    return dict(describe(qubits, steps, field), seed=seed,
                bare=drawn(bare), twirled=drawn(twirled), frames=frames,
                frame_count=len(frames),
                ideal_match=bool(np.allclose(reference, shifted, atol=1e-9)),
                largest_difference=round(float(np.max(np.abs(reference - shifted))), 12),
                ideal=ideal(qubits, steps, field), exact=exact(qubits, steps, field))


if __name__ == "__main__":
    # run from the project root:  python -m src.game
    import time

    if not noise.aer_available():
        raise SystemExit("Qiskit Aer is not installed; install backend/requirements.txt first")

    start = time.time()
    preview = circuit_preview(3, 2)
    print(preview["twirled"]["text"])
    print(f"bare: {preview['bare']['gates']} gates, depth {preview['bare']['depth']}; "
          f"twirled: {preview['twirled']['gates']} gates, depth {preview['twirled']['depth']}; "
          f"frames {preview['frame_count']}; ideal unchanged: {preview['ideal_match']}")
    assert preview["ideal_match"] and preview["frame_count"] == 8

    for scenario in SCENARIOS:
        result = play(scenario, **DEFAULTS)
        print(f"{scenario:11s} raw error {result['unmitigated']['error']:.4f} -> "
              f"twirled {result['twirled']['error']:.4f}  shift {result['comparison']['shift']:+.4f} "
              f"+-{result['comparison']['uncertainty']:.4f}  passed={result['passed']} stars={result['stars']}")
        if SCENARIOS[scenario].twirl_helps:
            assert result["comparison"]["improved"], f"{scenario}: twirling should have helped"
        else:
            assert result["comparison"]["unchanged"], f"{scenario}: twirling should have changed nothing"
    assert play("coherent", **DEFAULTS)["passed"]

    # One Pauli frame is a lottery ticket, not a twirl: the answer it gives depends on
    # which frame was drawn, so the error scatters far more than with a full set.
    def errors(randomizations):
        return [play("coherent", **{**DEFAULTS, "randomizations": randomizations}, seed=seed)
                ["twirled"]["error"] for seed in range(1, 9)]

    single, many = errors(1), errors(DEFAULTS["randomizations"])
    print(f"twirled error over 8 seeds: 1 frame {min(single):.3f}-{max(single):.3f}, "
          f"{DEFAULTS['randomizations']} frames {min(many):.3f}-{max(many):.3f}")
    assert max(single) - min(single) > 3 * (max(many) - min(many))
    print(f"({time.time() - start:.1f}s)")
    print("game.py OK")
