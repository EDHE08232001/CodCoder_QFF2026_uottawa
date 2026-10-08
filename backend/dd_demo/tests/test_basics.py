"""Fast unit tests for the DD demo. Run `pytest` or `python -m unittest discover -s tests` here."""
import math
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402
from qiskit.quantum_info import Statevector  # noqa: E402

from src import analysis, fastsim, game  # noqa: E402
from src.circuits import noisy_idle_circuit, ramsey_circuit  # noqa: E402
from src.noise import colored_noise  # noqa: E402
from src.sequences import build_sequence  # noqa: E402
from src.theory import coherence_curve, switching_function  # noqa: E402

DT = 0.1e-6


class SequenceTests(unittest.TestCase):
    def test_positions_are_sorted_and_inside_the_window(self):
        for name in ("hahn", "cpmg", "xy4", "udd"):
            seq = build_sequence(name, 8)
            self.assertEqual(len(seq.positions), seq.n_pulses)
            self.assertTrue(np.all((seq.positions > 0) & (seq.positions < 1)))
            self.assertTrue(np.all(np.diff(seq.positions) > 0))

    def test_xy4_alternates_axes(self):
        self.assertEqual("".join(build_sequence("xy4", 8).axes), "xyxyxyxy")

    def test_unknown_sequence(self):
        with self.assertRaises(ValueError):
            build_sequence("magic")


class NoiseAndTheoryTests(unittest.TestCase):
    def test_noise_has_requested_rms(self):
        for kind in ("1/f", "lorentzian", "white", "static"):
            x = colored_noise(50, 400, DT, 2.0, kind=kind, rng=np.random.default_rng(0))
            self.assertEqual(x.shape, (50, 400))
            self.assertAlmostEqual(x.std(), 2.0, places=9)

    def test_hahn_switching_function(self):
        s = switching_function(build_sequence("hahn"), 10e-6, (np.arange(100) + 0.5) * DT)
        self.assertTrue(np.all(s[:50] == 1) and np.all(s[50:] == -1))

    def test_echo_cancels_static_detuning(self):
        static = np.full((1, 500), 2 * np.pi * 10e3)
        self.assertAlmostEqual(coherence_curve(build_sequence("hahn"), np.array([50e-6]), static, DT)[0], 1.0)

    def test_more_pulses_help_against_slow_noise(self):
        noise = colored_noise(500, 1000, DT, 2 * np.pi * 15e3, rng=np.random.default_rng(0))
        T = np.array([100e-6])
        free, hahn, cpmg = (coherence_curve(build_sequence(n, 8), T, noise, DT)[0] for n in ("free", "hahn", "cpmg"))
        self.assertGreater(cpmg, hahn)
        self.assertGreater(cpmg, free)


class CircuitTests(unittest.TestCase):
    def test_fastsim_equals_qiskit(self):
        noise = colored_noise(4, 300, DT, 2 * np.pi * 20e3, rng=np.random.default_rng(1))
        for name in ("hahn", "cpmg", "xy4"):
            seq = build_sequence(name, 3)
            fast = fastsim.survival_probability(seq, 30e-6, noise, DT, "y", 0.03)
            exact = [Statevector(noisy_idle_circuit(seq, 30e-6, row, DT, "y", 0.03)).probabilities()[0] for row in noise]
            np.testing.assert_allclose(fast, exact, atol=1e-10)

    def test_xy4_is_robust_to_pulse_errors(self):
        zero = np.zeros((1, 400))
        cpmg = fastsim.mean_survival(build_sequence("cpmg", 16), 40e-6, zero, DT, "y", 0.03)
        xy4 = fastsim.mean_survival(build_sequence("xy4", 16), 40e-6, zero, DT, "y", 0.03)
        self.assertGreater(xy4, cpmg)

    def test_ramsey_circuit_is_ideal_without_noise(self):
        qc = ramsey_circuit(160, "y").remove_final_measurements(inplace=False)
        self.assertAlmostEqual(Statevector(qc).probabilities()[0], 1.0)


class AnalysisTests(unittest.TestCase):
    def test_p0_and_standard_error(self):
        self.assertEqual(analysis.p0({"0": 750, "1": 250}), 0.75)
        self.assertTrue(math.isnan(analysis.p0({})))
        self.assertAlmostEqual(analysis.standard_error({"0": 50, "1": 50}), 0.05)

    def test_saved_hardware_round_trip(self):
        with tempfile.TemporaryDirectory() as d:
            name = "hardware_fake_torino_20260101-000000"
            analysis.save_json(Path(d) / f"{name}.json", {
                "backend": "fake_torino", "qubit": 0, "init": "x", "delays_us": np.array([1.0, 2.0]),
                "p0": {"none": np.array([0.9, 0.8])}, "counts": {"none": [{"0": 9, "1": 1}, {"0": 8, "1": 2}]}})
            self.assertEqual([x["id"] for x in analysis.list_hardware(d)], [name])
            self.assertEqual(analysis.load_hardware(d, name)["series"][0]["p0"], [0.9, 0.8])
            with self.assertRaises(FileNotFoundError):
                analysis.load_hardware(d, "../outside")


class GameTests(unittest.TestCase):
    def test_echo_level(self):
        self.assertTrue(game.play("echo", [(0.5, "x")])["passed"])
        self.assertFalse(game.play("echo", [(0.2, "x")])["passed"])

    def test_invalid_pulses(self):
        for pulses in ([(0.0, "x")], [(0.5, "z")], [(0.4, "x"), (0.4, "x")]):
            with self.assertRaises(ValueError):
                game.make_sequence(pulses)
        with self.assertRaises(ValueError):
            game.play("echo", [(0.3, "x"), (0.6, "x")])


if __name__ == "__main__":
    unittest.main()
