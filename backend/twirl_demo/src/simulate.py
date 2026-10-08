"""Run the quench on Qiskit Aer, unmitigated and with Pauli twirling.

Both treatments get the same budget: ``randomizations`` circuits of ``shots``
shots each. The unmitigated side repeats the identical bare circuit, so its
scatter shows pure shot noise around a possibly wrong answer; the twirled side
runs a different Pauli frame every time.
"""
from __future__ import annotations

import numpy as np

from . import analysis, noise, twirl
from .problems import describe, exact, ideal, quench_circuit


def simulator(model=None, seed: int = 0):
    try:
        from qiskit_aer import AerSimulator
    except ImportError as error:
        raise RuntimeError(noise.AER_HINT) from error
    return AerSimulator(noise_model=model, seed_simulator=seed)


def sample(circuits, shots: int, model=None, seed: int = 0) -> list[dict[str, int]]:
    """Counts for each circuit, every one with its own seed.

    Aer derives the seed of an experiment from its position in the job, which
    correlates circuits that are submitted together. Seeding each circuit
    explicitly keeps the randomisations independent and reproducible.
    """
    backend = simulator(model, seed)
    return [backend.run(circuit, shots=shots, seed_simulator=seed + 1 + index).result().get_counts()
            for index, circuit in enumerate(circuits)]


def run(qubits: int, steps: int, field: float, randomizations: int, shots: int,
        coherent_angle: float = 0.0, depolarizing: float = 0.0, seed: int = 7) -> dict:
    """Unmitigated and twirled estimates of the quench magnetisation, plus references."""
    bare = quench_circuit(qubits, steps, field)
    rng = np.random.default_rng(seed)
    twirled, frames = twirl.randomizations(bare, randomizations, rng)
    model = noise.noise_model(coherent_angle, depolarizing)
    counts = sample([bare] * randomizations + twirled, shots, model, seed)
    reference = ideal(qubits, steps, field)
    unmitigated = analysis.summarize(counts[:randomizations], qubits, reference)
    mitigated = analysis.summarize(counts[randomizations:], qubits, reference)
    return dict(describe(qubits, steps, field),
                backend="aer", randomizations=randomizations, shots=shots,
                total_shots=randomizations * shots, coherent_angle=coherent_angle,
                depolarizing=depolarizing, seed=seed,
                twirled_zz_probability=round(noise.twirled_zz_probability(coherent_angle), 6),
                frames_per_circuit=len(frames[0]) if frames else 0,
                ideal=reference, exact=exact(qubits, steps, field),
                unmitigated=unmitigated, twirled=mitigated,
                comparison=analysis.compare(unmitigated, mitigated))


if __name__ == "__main__":
    # run from the project root:  python -m src.simulate
    import time

    if not noise.aer_available():
        raise SystemExit("Qiskit Aer is not installed; install backend/requirements.txt first")

    start = time.time()
    settings = dict(qubits=4, steps=4, field=0.6, randomizations=16, shots=512)

    clean = run(**settings)
    print(f"clean       ideal {clean['ideal']['magnetization']:+.4f}  "
          f"raw {clean['unmitigated']['magnetization']:+.4f}  twirled {clean['twirled']['magnetization']:+.4f}")
    assert clean["comparison"]["unchanged"], "with no noise the two treatments must agree"

    coherent = run(**settings, coherent_angle=0.08)
    print(f"coherent    ideal {coherent['ideal']['magnetization']:+.4f}  "
          f"raw {coherent['unmitigated']['magnetization']:+.4f} (error {coherent['unmitigated']['error']:.4f})  "
          f"twirled {coherent['twirled']['magnetization']:+.4f} (error {coherent['twirled']['error']:.4f})")
    assert coherent["comparison"]["improved"], "twirling should beat a coherent error"

    stochastic = run(**settings, depolarizing=0.02)
    print(f"depolarizing ideal {stochastic['ideal']['magnetization']:+.4f}  "
          f"raw {stochastic['unmitigated']['magnetization']:+.4f} (error {stochastic['unmitigated']['error']:.4f})  "
          f"twirled {stochastic['twirled']['magnetization']:+.4f} (error {stochastic['twirled']['error']:.4f})")
    assert stochastic["comparison"]["unchanged"], "twirling a Pauli channel must change nothing"

    mixed = run(**settings, coherent_angle=0.08, depolarizing=0.02)
    print(f"mixed       raw error {mixed['unmitigated']['error']:.4f}  "
          f"twirled error {mixed['twirled']['error']:.4f}  "
          f"TVD {mixed['unmitigated']['total_variation']:.4f} -> {mixed['twirled']['total_variation']:.4f}")
    print(f"({time.time() - start:.1f}s)")
    print("simulate.py OK")
