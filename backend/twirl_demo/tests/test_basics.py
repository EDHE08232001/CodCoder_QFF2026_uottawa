"""Fast unit tests for the twirling demo. Run `pytest` or `python -m unittest discover -s tests` here."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402
from qiskit.circuit.library import RZZGate  # noqa: E402
from qiskit.quantum_info import Operator, Pauli, Statevector  # noqa: E402

from src import analysis, game, noise, problems, twirl  # noqa: E402


class ProblemTests(unittest.TestCase):
    def test_gate_count_and_depth_grow_with_the_quench(self):
        for qubits in (3, 4, 5):
            for steps in (1, 3):
                circuit = problems.quench_circuit(qubits, steps, 0.6)
                self.assertEqual(circuit.count_ops()["cx"], 2 * (qubits - 1) * steps)
                self.assertEqual(problems.describe(qubits, steps, 0.6)["two_qubit_gates"],
                                 2 * (qubits - 1) * steps)

    def test_rejects_sizes_it_cannot_simulate(self):
        for qubits, steps in ((1, 1), (7, 1), (4, 0), (4, 9)):
            with self.assertRaises(ValueError):
                problems.quench_circuit(qubits, steps, 0.6)

    def test_zero_field_leaves_the_chain_aligned(self):
        self.assertAlmostEqual(problems.ideal(4, 4, 0.0)["magnetization"], 1.0, places=9)
        self.assertEqual(problems.ideal(4, 4, 0.0)["distribution"]["0000"], 1.0)

    def test_trotter_approaches_the_continuous_answer_for_one_step(self):
        trotter = problems.ideal(4, 1, 0.6)["magnetization"]
        self.assertAlmostEqual(trotter, problems.exact(4, 1, 0.6)["magnetization"], delta=0.02)

    def test_bonds_cover_the_chain_in_two_layers(self):
        self.assertEqual(problems.bonds(5), [(0, 1), (2, 3), (1, 2), (3, 4)])
        self.assertEqual(sorted(problems.bonds(5)), [(0, 1), (1, 2), (2, 3), (3, 4)])


class TwirlTests(unittest.TestCase):
    def test_every_frame_leaves_each_gate_unchanged(self):
        for name, gate in twirl.TWIRLED_GATES.items():
            matrix = Operator(gate).data
            table = twirl.frame_table(name)
            self.assertEqual(len(table), 16)
            self.assertEqual(len({after for _, after in table}), 16)
            for before, after in table:
                framed = Pauli(after).to_matrix() @ matrix @ Pauli(before).to_matrix()
                phase = np.trace(matrix.conj().T @ framed) / 4
                self.assertAlmostEqual(abs(phase), 1.0, places=9)
                np.testing.assert_allclose(framed, phase * matrix, atol=1e-9)

    def test_unknown_gate(self):
        with self.assertRaises(ValueError):
            twirl.frame_table("iswap")

    def test_randomizations_keep_the_ideal_outcome(self):
        bare = problems.quench_circuit(4, 3, 0.6, measure=False)
        reference = Statevector(bare).probabilities()
        circuits, frames = twirl.randomizations(bare, 12, np.random.default_rng(0))
        self.assertEqual(len(circuits), 12)
        self.assertTrue(all(len(frame) == twirl.two_qubit_gates(bare) == 18 for frame in frames))
        for circuit in circuits:
            np.testing.assert_allclose(Statevector(circuit).probabilities(), reference, atol=1e-12)

    def test_frames_differ_between_randomizations(self):
        bare = problems.quench_circuit(3, 2, 0.6, measure=False)
        _, frames = twirl.randomizations(bare, 8, np.random.default_rng(1))
        chosen = {tuple(frame["before"] for frame in single) for single in frames}
        self.assertGreater(len(chosen), 1)

    def test_basis_gate_frames_stay_in_the_hardware_basis(self):
        bare = problems.quench_circuit(3, 2, 0.6, measure=False)
        twirled, _ = twirl.twirl(bare, np.random.default_rng(2), basis_gates=True)
        self.assertNotIn("y", twirled.count_ops())
        self.assertNotIn("z", twirled.count_ops())
        np.testing.assert_allclose(Statevector(twirled).probabilities(),
                                   Statevector(bare).probabilities(), atol=1e-12)

    def test_measurements_and_barriers_survive(self):
        bare = problems.quench_circuit(3, 2, 0.6)
        twirled, _ = twirl.twirl(bare, np.random.default_rng(3))
        self.assertEqual(twirled.count_ops()["measure"], 3)
        self.assertEqual(twirled.num_clbits, bare.num_clbits)


class NoiseTests(unittest.TestCase):
    def test_zz_rotation_is_an_rzz_gate(self):
        for angle in (0.05, 0.4):
            np.testing.assert_allclose(noise.zz_rotation(angle), Operator(RZZGate(angle)).data, atol=1e-12)

    def test_a_coherent_kick_twirls_into_a_tiny_flip(self):
        self.assertAlmostEqual(noise.twirled_zz_probability(0.0), 0.0)
        self.assertLess(noise.twirled_zz_probability(0.08), 0.002)

    def test_no_model_without_noise(self):
        self.assertIsNone(noise.noise_model())
        self.assertIsNone(noise.noise_model(0.0, 0.0))


class AnalysisTests(unittest.TestCase):
    def test_magnetization_from_counts(self):
        self.assertEqual(analysis.magnetization({"0000": 10})[0], 1.0)
        self.assertEqual(analysis.magnetization({"1111": 10})[0], -1.0)
        self.assertEqual(analysis.magnetization({"0011": 10})[0], 0.0)
        self.assertEqual(analysis.per_qubit({"0001": 10}), [-1.0, 1.0, 1.0, 1.0])

    def test_standard_error_shrinks_with_shots(self):
        few = analysis.magnetization({"00": 50, "11": 50})[1]
        many = analysis.magnetization({"00": 5000, "11": 5000})[1]
        self.assertAlmostEqual(few / many, 10.0, places=6)

    def test_distribution_lists_every_bitstring(self):
        spread = analysis.distribution({"01": 3, "10": 1}, 2)
        self.assertEqual(sorted(spread), ["00", "01", "10", "11"])
        self.assertEqual(spread["01"], 0.75)
        self.assertEqual(spread["00"], 0.0)

    def test_total_variation_bounds(self):
        self.assertEqual(analysis.total_variation({"0": 1.0}, {"0": 1.0}), 0.0)
        self.assertEqual(analysis.total_variation({"0": 1.0}, {"1": 1.0}), 1.0)

    def test_summary_pools_randomizations(self):
        reference = {"magnetization": 1.0, "distribution": {"00": 1.0}}
        summary = analysis.summarize([{"00": 90, "11": 10}, {"00": 80, "11": 20}], 2, reference)
        self.assertEqual(summary["shots"], 200)
        self.assertEqual(summary["circuits"], 2)
        self.assertAlmostEqual(summary["magnetization"], 0.7)
        self.assertAlmostEqual(summary["error"], 0.3)
        self.assertAlmostEqual(summary["total_variation"], 0.15)
        self.assertEqual(summary["values"], [0.8, 0.6])

    def test_compare_needs_more_than_noise(self):
        reference = {"magnetization": 1.0, "distribution": {"00": 1.0}}
        same = analysis.summarize([{"00": 90, "11": 10}] * 4, 2, reference)
        far = analysis.summarize([{"11": 90, "00": 10}] * 4, 2, reference)
        self.assertTrue(analysis.compare(same, same)["unchanged"])
        self.assertTrue(analysis.compare(far, same)["improved"])
        self.assertFalse(analysis.compare(same, far)["improved"])

    def test_saved_dataset_round_trip(self):
        with tempfile.TemporaryDirectory() as folder:
            name = "twirl_aer_20260101-000000"
            analysis.save_json(Path(folder) / f"{name}.json",
                               {"backend": "aer", "qubits": 2, "steps": 1,
                                "unmitigated": {"magnetization": 0.5}})
            listing = analysis.list_datasets(folder)
            self.assertEqual([item["id"] for item in listing], [name])
            self.assertTrue(listing[0]["simulated"])
            self.assertEqual(analysis.load_dataset(folder, name)["unmitigated"]["magnetization"], 0.5)
            with self.assertRaises(FileNotFoundError):
                analysis.load_dataset(folder, "../outside")


@unittest.skipUnless(noise.aer_available(), "qiskit-aer is not installed")
class ScenarioTests(unittest.TestCase):
    SETTINGS = dict(qubits=4, steps=4, field=0.6, randomizations=16, shots=512)

    def test_twirling_beats_a_coherent_error(self):
        result = game.play("coherent", **self.SETTINGS)
        self.assertTrue(result["comparison"]["improved"])
        self.assertLess(result["twirled"]["error"], result["unmitigated"]["error"] / 3)
        self.assertTrue(result["passed"])
        self.assertGreater(result["stars"], 0)

    def test_twirling_a_pauli_channel_changes_nothing(self):
        result = game.play("stochastic", **self.SETTINGS)
        self.assertTrue(result["comparison"]["unchanged"])
        self.assertGreater(result["unmitigated"]["error"], 0.05)  # there is a real error ...
        self.assertFalse(result["comparison"]["improved"])        # ... twirling just cannot touch it

    def test_twirling_removes_only_the_coherent_half_of_mixed_noise(self):
        mixed = game.play("mixed", **self.SETTINGS)
        stochastic = game.play("stochastic", **self.SETTINGS)
        self.assertTrue(mixed["comparison"]["improved"])
        self.assertAlmostEqual(mixed["twirled"]["error"], stochastic["twirled"]["error"], delta=0.03)

    def test_a_noiseless_run_is_unaffected(self):
        result = game.play("clean", **self.SETTINGS)
        self.assertTrue(result["comparison"]["unchanged"])
        self.assertLess(result["unmitigated"]["error"], 0.02)

    def test_results_are_reproducible(self):
        first = game.play("coherent", **self.SETTINGS, seed=5)
        second = game.play("coherent", **self.SETTINGS, seed=5)
        self.assertEqual(first["twirled"]["values"], second["twirled"]["values"])

    def test_unknown_scenario(self):
        with self.assertRaises(ValueError):
            game.play("magic", **self.SETTINGS)


class PreviewTests(unittest.TestCase):
    def test_preview_proves_the_twirl_is_invisible(self):
        preview = game.circuit_preview(3, 2, 0.6, seed=4)
        self.assertTrue(preview["ideal_match"])
        self.assertLess(preview["largest_difference"], 1e-9)
        self.assertEqual(preview["frame_count"], 8)
        self.assertEqual(preview["bare"]["two_qubit_gates"], 8)
        self.assertEqual(preview["twirled"]["two_qubit_gates"], 8)
        self.assertGreater(preview["twirled"]["gates"], preview["bare"]["gates"])
        self.assertIn("Rz", preview["bare"]["text"])
        self.assertIn("meas", preview["bare"]["text"])


if __name__ == "__main__":
    unittest.main()
