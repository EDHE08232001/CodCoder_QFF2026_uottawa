"""The *true* classical readout-noise channel for the simulated teaching levels.

Readout error is a classical Markov channel acting on already-collapsed
measurement bits, so simulating it needs no quantum circuit simulator at all
-- a qiskit_aer.noise.ReadoutError round-trip was tried first, but Aer 0.17.2
silently drops a multi-qubit (correlated) ReadoutError added via
``NoiseModel.add_readout_error(error, [q0, q1])``: circuits compile each
qubit's ``measure`` into a separate single-qubit instruction, and Aer only
ever matches 1-qubit entries of ``_local_readout_errors`` against those, so
a 2-qubit entry is stored but never applied (confirmed empirically: a
circuit prepared in a fixed basis state came back unperturbed no matter what
the registered 2-qubit matrix said). This module instead samples the channel
directly, which is simpler, faster and fully under our control.

Convention: qubit 0 is the least-significant (rightmost) bit everywhere, the
same as calibration.py and the bitstrings qiskit prints.
"""
from __future__ import annotations

import numpy as np


def sample_true_bits(ideal_probabilities: np.ndarray, shots: int, rng: np.random.Generator) -> np.ndarray:
    """``shots`` collapsed outcomes drawn from a circuit's ideal (noiseless) distribution.

    Returns a boolean array of shape (shots, n); column k is qubit k's bit.
    """
    n = int(round(np.log2(len(ideal_probabilities))))
    outcomes = rng.choice(len(ideal_probabilities), size=shots, p=ideal_probabilities)
    return ((outcomes[:, None] >> np.arange(n)) & 1).astype(bool)


def apply_readout_noise(true_bits: np.ndarray, per_qubit_errors: list[tuple[float, float]],
                        crosstalk_pairs: list[tuple[int, int, float]], rng: np.random.Generator) -> np.ndarray:
    """Flip bits of ``true_bits`` (shape shots x n) according to the readout error model.

    Every qubit flips independently with its own (p01, p10) rate; then, for
    each crosstalk pair (left, right, strength), with probability
    ``strength`` *that shot* those two qubits are overridden to read the
    opposite of their true bit *together* (replacing whatever the
    independent draw gave them) -- a mixture of two valid channels, so it
    stays physical for any strength in [0, 1]. Pairs are applied in the
    order given; a qubit shared by two pairs takes the later pair's outcome.
    """
    shots, n = true_bits.shape
    if len(per_qubit_errors) != n:
        raise ValueError("need one (p01, p10) pair per qubit")
    p01 = np.array([rate[0] for rate in per_qubit_errors])
    p10 = np.array([rate[1] for rate in per_qubit_errors])
    flip_probability = np.where(true_bits, p10, p01)
    measured = true_bits ^ (rng.random((shots, n)) < flip_probability)
    for left, right, strength in crosstalk_pairs:
        if not 0 <= strength <= 1:
            raise ValueError("crosstalk strength must be between 0 and 1")
        event = rng.random(shots) < strength
        measured[event, left] = ~true_bits[event, left]
        measured[event, right] = ~true_bits[event, right]
    return measured


def bits_to_counts(bits: np.ndarray) -> dict[str, int]:
    """Boolean (shots, n) array to a qiskit-style counts dict (qubit 0 = rightmost char)."""
    n = bits.shape[1]
    values = (bits.astype(np.int64) * (1 << np.arange(n))).sum(axis=1)
    unique, frequency = np.unique(values, return_counts=True)
    return {format(int(value), f"0{n}b"): int(count) for value, count in zip(unique, frequency)}


def calibration_counts(n: int, basis_state: int, shots: int, per_qubit_errors, crosstalk_pairs,
                       rng: np.random.Generator) -> dict[str, int]:
    """Noisy counts from preparing computational basis state ``basis_state`` and measuring."""
    bits = np.array([(basis_state >> qubit) & 1 for qubit in range(n)], dtype=bool)
    true_bits = np.tile(bits, (shots, 1))
    return bits_to_counts(apply_readout_noise(true_bits, per_qubit_errors, crosstalk_pairs, rng))


def target_counts(ideal_probabilities: np.ndarray, shots: int, per_qubit_errors, crosstalk_pairs,
                  rng: np.random.Generator) -> dict[str, int]:
    """Noisy counts from measuring a circuit whose noiseless distribution is ``ideal_probabilities``."""
    true_bits = sample_true_bits(ideal_probabilities, shots, rng)
    return bits_to_counts(apply_readout_noise(true_bits, per_qubit_errors, crosstalk_pairs, rng))


if __name__ == "__main__":
    # run from the project root:  python -m src.noise
    rng = np.random.default_rng(0)

    # No crosstalk: each qubit's marginal flip rate should match its own (p01, p10).
    counts = calibration_counts(2, 0b00, 20000, [(0.3, 0.1), (0.1, 0.4)], [], rng)
    ones_q0 = sum(v for k, v in counts.items() if k[-1] == "1")
    ones_q1 = sum(v for k, v in counts.items() if k[-2] == "1")
    total = sum(counts.values())
    print(f"independent flip rates from |00>: q0 {ones_q0/total:.3f} (expect 0.30), "
          f"q1 {ones_q1/total:.3f} (expect 0.10)")
    assert abs(ones_q0 / total - 0.3) < 0.02 and abs(ones_q1 / total - 0.1) < 0.02

    # Full crosstalk (strength=1) between a pair: every shot must read either "unflipped"
    # or "both flipped" for that pair -- never exactly one of the two.
    counts = calibration_counts(2, 0b00, 2000, [(0.3, 0.3), (0.3, 0.3)], [(0, 1, 1.0)], rng)
    assert set(counts) <= {"00", "11"}, counts
    print("full crosstalk on |00> only ever gives 00 or 11:", counts)

    # Zero crosstalk must reduce exactly to the independent channel (statistically).
    zero_cross = calibration_counts(2, 0b00, 20000, [(0.2, 0.2), (0.2, 0.2)], [(0, 1, 0.0)], rng)
    joint_flip_rate = zero_cross.get("11", 0) / sum(zero_cross.values())
    print(f"zero-crosstalk joint flip rate: {joint_flip_rate:.4f} (expect ~0.04 = 0.2*0.2)")
    assert abs(joint_flip_rate - 0.04) < 0.01

    # target_counts samples the ideal distribution first: a GHZ-like 50/50 superposition
    # with no readout error must come back close to a clean 50/50 split.
    ideal = np.array([0.5, 0.0, 0.0, 0.5])
    clean = target_counts(ideal, 5000, [(0.0, 0.0), (0.0, 0.0)], [], rng)
    assert set(clean) <= {"00", "11"}
    print("noiseless GHZ(2) sampling:", clean)
    print("noise.py OK")
