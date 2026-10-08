"""Fast unit tests for the readout-mitigation demo. Run `pytest` or `python -m unittest discover -s tests` here."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402
from qiskit.quantum_info import Statevector  # noqa: E402

from src import analysis, calibration, circuits, game, noise  # noqa: E402


class CalibrationTests(unittest.TestCase):
    def test_hand_computed_inversion(self):
        a = calibration.assignment_matrix_1q(p01=0.2, p10=0.1)
        true = np.array([0.3, 0.7])
        np.testing.assert_allclose(calibration.invert_correct(a, a @ true), true, atol=1e-9)

    def test_tensoring_matches_the_correlated_matrix_for_independent_noise(self):
        mats = [calibration.assignment_matrix_1q(0.05, 0.02), calibration.assignment_matrix_1q(0.1, 0.03)]
        tensored = calibration.tensor_assignment_matrix(mats)
        basis_counts = []
        for state in range(4):
            bits = [(state >> k) & 1 for k in range(2)]
            from functools import reduce
            column = reduce(np.kron, [mats[k][:, bits[k]] for k in reversed(range(2))])
            basis_counts.append(calibration.vector_to_counts(column, 2))
        np.testing.assert_allclose(tensored, calibration.correlated_assignment_matrix(basis_counts), atol=1e-9)

    def test_nnls_stays_physical_where_inversion_does_not(self):
        matrix = np.array([[0.9, 0.85], [0.1, 0.15]])
        measured = np.array([0.5, 0.5])
        self.assertLess(calibration.invert_correct(matrix, measured).min(), 0)
        fixed = calibration.nnls_correct(matrix, measured)
        self.assertGreaterEqual(fixed.min(), -1e-9)
        self.assertAlmostEqual(fixed.sum(), 1.0, places=9)

    def test_total_variation_bounds(self):
        self.assertEqual(calibration.total_variation(np.array([1.0, 0.0]), np.array([0.0, 1.0])), 1.0)
        self.assertEqual(calibration.total_variation(np.array([0.3, 0.7]), np.array([0.3, 0.7])), 0.0)


class NoiseTests(unittest.TestCase):
    def test_independent_flip_rates_match_requested_marginals(self):
        rng = np.random.default_rng(0)
        counts = noise.calibration_counts(2, 0b00, 20000, [(0.3, 0.1), (0.1, 0.4)], [], rng)
        total = sum(counts.values())
        q0_ones = sum(v for k, v in counts.items() if k[-1] == "1")
        self.assertAlmostEqual(q0_ones / total, 0.3, delta=0.02)

    def test_full_crosstalk_only_ever_flips_the_pair_together(self):
        rng = np.random.default_rng(0)
        counts = noise.calibration_counts(2, 0b00, 2000, [(0.3, 0.3), (0.3, 0.3)], [(0, 1, 1.0)], rng)
        self.assertLessEqual(set(counts), {"00", "11"})

    def test_target_counts_samples_the_ideal_distribution(self):
        rng = np.random.default_rng(0)
        counts = noise.target_counts(np.array([0.5, 0.0, 0.0, 0.5]), 4000, [(0.0, 0.0)] * 2, [], rng)
        self.assertLessEqual(set(counts), {"00", "11"})


class CircuitTests(unittest.TestCase):
    def test_calibration_circuit_counts(self):
        zeros, ones = circuits.calibration_circuits(3)
        self.assertEqual(ones.count_ops()["x"], 3)
        self.assertNotIn("x", zeros.count_ops())

    def test_full_basis_circuit_count_and_shape(self):
        basis = circuits.full_basis_circuits(2)
        self.assertEqual(len(basis), 4)
        self.assertEqual(basis[3].count_ops()["x"], 2)

    def test_ghz_ideal_distribution(self):
        probabilities = circuits.ideal_probabilities(circuits.ghz_circuit(3, measure=False))
        np.testing.assert_allclose(probabilities, [0.5, 0, 0, 0, 0, 0, 0, 0.5], atol=1e-9)

    def test_marginal_calibration_matches_statevector_free_case(self):
        """With no readout error, the marginal calibration must recover the identity matrix."""
        rng = np.random.default_rng(0)
        counts0 = noise.calibration_counts(2, 0b00, 5000, [(0.0, 0.0)] * 2, [], rng)
        counts1 = noise.calibration_counts(2, 0b11, 5000, [(0.0, 0.0)] * 2, [], rng)
        matrix = calibration.calibrate_1q_from_global_counts(counts0, counts1, 0, 2)
        np.testing.assert_allclose(matrix, np.eye(2), atol=1e-9)
        ideal = circuits.ideal_probabilities(circuits.ghz_circuit(2, measure=False))
        self.assertAlmostEqual(float(Statevector.from_instruction(circuits.ghz_circuit(2, measure=False))
                                     .probabilities()[0]), ideal[0])


class GameTests(unittest.TestCase):
    def test_bias_and_crowd_levels_pass(self):
        self.assertTrue(game.play("bias")["passed"])
        self.assertTrue(game.play("crowd")["passed"])

    def test_crosstalk_level_needs_the_correlated_calibration(self):
        tensored = game.play("crosstalk", calibration_mode="tensored")
        correlated = game.play("crosstalk", calibration_mode="correlated")
        self.assertFalse(tensored["passed"])
        self.assertTrue(correlated["passed"])
        self.assertEqual(tensored["calibration_circuits_used"], 2)
        self.assertEqual(correlated["calibration_circuits_used"], 16)

    def test_ghz_level_shows_inversion_is_unphysical_and_nnls_fixes_it(self):
        result = game.play("ghz", calibration_mode="correlated")
        self.assertGreater(result["inverted_negative_mass"], 0)
        self.assertLess(abs(result["parity_corrected"] - 1.0), abs(result["parity_raw"] - 1.0))

    def test_play_is_deterministic(self):
        self.assertEqual(game.play("bias"), game.play("bias"))

    def test_unknown_level_and_mode_are_rejected(self):
        with self.assertRaises(ValueError):
            game.play("nope")
        with self.assertRaises(ValueError):
            game.play("bias", calibration_mode="correlated")

    def test_explore_validates_inputs(self):
        with self.assertRaises(ValueError):
            game.explore(qubits=0)
        with self.assertRaises(ValueError):
            game.explore(qubits=2, per_qubit_errors=[(0.1, 0.1)])


class AnalysisTests(unittest.TestCase):
    def test_build_dataset_and_round_trip(self):
        dataset = analysis.build_dataset("fake_torino", 2, "tensored", shots=1000, seed=0, job_id="job-1",
                                         layout=[0, 1], calibration_counts=[{"00": 1000}, {"11": 800, "10": 200}],
                                         target_counts={"00": 500, "11": 400, "01": 100})
        self.assertEqual(dataset["calibration_circuits_used"], 2)
        self.assertAlmostEqual(sum(dataset["corrected_distribution"].values()), 1.0, places=9)
        with tempfile.TemporaryDirectory() as folder:
            name = "trex_fake_torino_20260101-120000"
            analysis.save_json(Path(folder) / f"{name}.json", dataset)
            self.assertEqual([d["id"] for d in analysis.list_datasets(folder)], [name])
            self.assertEqual(analysis.load_dataset(folder, name)["qubits"], 2)
            with self.assertRaises(FileNotFoundError):
                analysis.load_dataset(folder, "../secret")


if __name__ == "__main__":
    unittest.main()
