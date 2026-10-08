"""Aer noise models for the twirling demo: one coherent knob, one stochastic knob.

* coherent_angle: an extra exp(-i a/2 Z Z) rotation after every two-qubit gate,
  the textbook model of residual ZZ crosstalk. It is a unitary, so it is
  reproduced identically in every shot and its effect on an observable grows
  with the number of gates. Pauli-twirling such a rotation turns it into the
  Pauli channel {I with cos^2(a/2), ZZ with sin^2(a/2)}, which is far weaker
  once many gates accumulate.
* depolarizing: a two-qubit depolarizing channel after every two-qubit gate.
  Depolarizing noise is already a Pauli channel, so it is its own twirl and
  twirling changes nothing about it.

Single-qubit gates (including the inserted Pauli frames) and the readout are
left noiseless so that the comparison isolates the two-qubit gate error.
"""
from __future__ import annotations

import numpy as np

AER_HINT = ("Qiskit Aer is not installed. Install it with "
            "'pip install -r backend/requirements.txt' and restart the backend.")


def aer_available() -> bool:
    try:
        import qiskit_aer  # noqa: F401
    except ImportError:
        return False
    return True


def zz_rotation(angle: float) -> np.ndarray:
    """Matrix of exp(-i angle/2 Z x Z), the coherent crosstalk unitary."""
    phases = np.exp(-1j * angle / 2 * np.array([1, -1, -1, 1]))
    return np.diag(phases)


def twirled_zz_probability(angle: float) -> float:
    """Chance of a ZZ flip once the coherent rotation has been twirled."""
    return float(np.sin(angle / 2) ** 2)


def noise_model(coherent_angle: float = 0.0, depolarizing: float = 0.0, gates=("cx",)):
    """Noise on the two-qubit gates only; ``None`` when both knobs are zero."""
    if coherent_angle <= 0 and depolarizing <= 0:
        return None
    try:
        from qiskit_aer.noise import NoiseModel, coherent_unitary_error, depolarizing_error
    except ImportError as error:
        raise RuntimeError(AER_HINT) from error
    errors = []
    if depolarizing > 0:
        errors.append(depolarizing_error(depolarizing, 2))
    if coherent_angle > 0:
        errors.append(coherent_unitary_error(zz_rotation(coherent_angle)))
    combined = errors[0]
    for error in errors[1:]:
        combined = combined.compose(error)
    model = NoiseModel()
    model.add_all_qubit_quantum_error(combined, list(gates))
    return model


if __name__ == "__main__":
    # run from the project root:  python -m src.noise
    from qiskit.quantum_info import Operator
    from qiskit.circuit.library import RZZGate

    for angle in (0.05, 0.4):
        np.testing.assert_allclose(zz_rotation(angle), Operator(RZZGate(angle)).data, atol=1e-12)
    print("zz_rotation matches RZZGate")

    print("coherent angle -> twirled ZZ flip probability:",
          {angle: round(twirled_zz_probability(angle), 5) for angle in (0.05, 0.1, 0.2)})
    assert twirled_zz_probability(0.1) < 0.003  # a 0.1 rad coherent kick twirls to a 0.25% flip

    assert noise_model() is None
    if aer_available():
        model = noise_model(0.1, 0.01)
        print("noise model:", model.noise_instructions, model.noise_qubits or "all qubits")
        assert "cx" in model.noise_instructions
        print("noise.py OK")
    else:
        print("Qiskit Aer missing -> skipped the noise model check")
