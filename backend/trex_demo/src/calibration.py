"""Assignment-matrix math behind readout mitigation (pure NumPy/SciPy, no qiskit).

Convention: the assignment matrix A has A[i, j] = P(measured i | prepared j),
so a noisy distribution is ``measured = A @ true`` (A is column-stochastic:
every column sums to 1). This is the transpose of qiskit_aer's own
``ReadoutError`` convention, where ``probabilities[i][j] = P(measured j |
prepared i)`` is row-stochastic (row i = the prepared state). Keep that in
mind when a matrix crosses from noise.py (rows) into this module (columns).

Two ways to build A:
* tensored/local: calibrate each qubit's own 2x2 matrix independently (cheap:
  2 global calibration circuits, |0...0> and |1...1>, regardless of qubit
  count) and Kronecker-multiply them together. Exact when qubits really are
  independent; wrong under readout crosstalk.
* correlated: calibrate every one of the 2**n computational basis states
  (expensive) and read off the full matrix directly, column by column.
  Exact either way, but the circuit count grows exponentially with n.

Correcting a noisy distribution then means inverting A. Direct inversion can
return negative "probabilities" (not a crime against physics, just a sign the
inverse of a column-stochastic matrix is not itself one) — a non-negative
least-squares fit stays physical at the cost of being a biased estimator.
"""
from __future__ import annotations

from functools import reduce

import numpy as np
from scipy.optimize import nnls


def counts_to_vector(counts: dict[str, int], n: int) -> np.ndarray:
    """Bitstrings (qubit 0 = rightmost character, as qiskit prints them) to a probability vector."""
    vector = np.zeros(2 ** n)
    for key, value in counts.items():
        vector[int(key.replace(" ", ""), 2)] += value
    total = vector.sum()
    if total <= 0:
        raise ValueError("counts must contain at least one shot")
    return vector / total


def vector_to_counts(vector: np.ndarray, n: int) -> dict[str, float]:
    return {format(index, f"0{n}b"): float(value) for index, value in enumerate(vector)}


def assignment_matrix_1q(p01: float, p10: float) -> np.ndarray:
    """2x2 single-qubit assignment matrix from the two bit-flip rates.

    p01 = P(measure 1 | prepared 0), p10 = P(measure 0 | prepared 1).
    """
    if not (0 <= p01 <= 1 and 0 <= p10 <= 1):
        raise ValueError("p01 and p10 must be probabilities")
    return np.array([[1 - p01, p10], [p01, 1 - p10]])


def tensor_assignment_matrix(matrices_1q: list[np.ndarray]) -> np.ndarray:
    """Kronecker product of per-qubit assignment matrices: the independent/local model.

    ``matrices_1q`` is ordered qubit 0 first (the natural listing order); since
    qubit 0 is the least-significant bit in our bitstring convention, the
    product is built most-significant-qubit-first, i.e. with the list reversed.
    """
    if not matrices_1q:
        raise ValueError("need at least one 1-qubit matrix")
    return reduce(np.kron, reversed(matrices_1q))


def calibrate_1q_from_global_counts(counts_all0: dict[str, int], counts_all1: dict[str, int],
                                    qubit: int, n: int) -> np.ndarray:
    """One qubit's 2x2 matrix, marginalised out of the two global calibration circuits.

    ``counts_all0``/``counts_all1`` are the results of preparing every qubit
    in |0> / |1> at once and measuring all of them; this reads off just one
    qubit's column from each, assuming no qubit's error depends on the
    others (the assumption the 'crosstalk' level breaks).
    """
    def flip_fraction(counts: dict[str, int], want_bit: str) -> float:
        total = sum(counts.values())
        if total <= 0:
            raise ValueError("counts must contain at least one shot")
        flipped = sum(value for key, value in counts.items()
                      if key.replace(" ", "")[n - 1 - qubit] == want_bit)
        return flipped / total

    p01 = flip_fraction(counts_all0, "1")   # prepared 0, measured 1
    p10 = flip_fraction(counts_all1, "0")   # prepared 1, measured 0
    return assignment_matrix_1q(p01, p10)


def correlated_assignment_matrix(basis_counts: list[dict[str, int]]) -> np.ndarray:
    """Full 2**n x 2**n matrix: column j is the measured distribution from preparing basis state j."""
    n = int(round(np.log2(len(basis_counts))))
    if 2 ** n != len(basis_counts):
        raise ValueError("need exactly 2**n calibration circuits, one per basis state")
    return np.column_stack([counts_to_vector(counts, n) for counts in basis_counts])


def invert_correct(assignment: np.ndarray, measured: np.ndarray) -> np.ndarray:
    """Direct inversion. Exact for a perfectly-known assignment matrix; can return negative entries."""
    solution, *_ = np.linalg.lstsq(assignment, measured, rcond=None)
    return solution


def nnls_correct(assignment: np.ndarray, measured: np.ndarray) -> np.ndarray:
    """Non-negative least squares: stays physical (all entries >= 0, renormalised to sum to 1)."""
    solution, _ = nnls(assignment, measured)
    total = solution.sum()
    return solution / total if total > 0 else solution


def total_variation(p: np.ndarray, q: np.ndarray) -> float:
    return float(0.5 * np.sum(np.abs(np.asarray(p) - np.asarray(q))))


def condition_number(assignment: np.ndarray) -> float:
    return float(np.linalg.cond(assignment))


if __name__ == "__main__":
    # run from the project root:  python -m src.calibration

    # Hand-computed 2x2 example: A = [[0.8,0.1],[0.2,0.9]], true = [0.3,0.7].
    # det(A) = 0.72 - 0.02 = 0.7; A^-1 = (1/0.7)*[[0.9,-0.1],[-0.2,0.8]].
    # measured = A @ true = [0.31, 0.69]; A^-1 @ measured = [0.3, 0.7] exactly.
    a = assignment_matrix_1q(p01=0.2, p10=0.1)
    true = np.array([0.3, 0.7])
    measured = a @ true
    np.testing.assert_allclose(measured, [0.31, 0.69], atol=1e-12)
    recovered = invert_correct(a, measured)
    np.testing.assert_allclose(recovered, true, atol=1e-9)
    print("1q hand example recovered:", recovered)

    # Kron-tensoring 3 independent qubits must equal the correlated matrix built
    # by calibrating all 8 basis states, when the per-qubit errors really are
    # independent (construct the "measured" basis-state distributions directly
    # from the product of per-qubit matrices, i.e. without ever touching qiskit).
    mats = [assignment_matrix_1q(0.05, 0.02), assignment_matrix_1q(0.1, 0.03), assignment_matrix_1q(0.02, 0.08)]
    tensored = tensor_assignment_matrix(mats)
    basis_counts = []
    for state in range(8):
        bits = [(state >> k) & 1 for k in range(3)]
        column = reduce(np.kron, [mats[k][:, bits[k]] for k in reversed(range(3))])
        basis_counts.append(vector_to_counts(column, 3))
    correlated = correlated_assignment_matrix(basis_counts)
    np.testing.assert_allclose(tensored, correlated, atol=1e-9)
    print("tensored == correlated for independent noise: OK")

    # Pathological case: inversion goes negative, nnls stays physical.
    near_singular = np.array([[0.9, 0.85], [0.1, 0.15]])
    bad_measured = np.array([0.5, 0.5])
    inverted = invert_correct(near_singular, bad_measured)
    assert inverted.min() < 0, "expected this example to demonstrate an unphysical inversion"
    fixed = nnls_correct(near_singular, bad_measured)
    assert fixed.min() >= -1e-9 and abs(fixed.sum() - 1) < 1e-9
    print(f"inversion goes negative ({inverted}), nnls stays physical ({fixed})")

    # Sanity checks on the metrics.
    assert total_variation(np.array([1.0, 0.0]), np.array([0.0, 1.0])) == 1.0
    assert total_variation(true, true) == 0.0
    assert condition_number(np.eye(4)) == 1.0
    print("calibration.py OK")
