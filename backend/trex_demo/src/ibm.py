"""IBM Quantum authentication and backend selection."""
from __future__ import annotations

import os

from dotenv import load_dotenv
from qiskit_ibm_runtime import QiskitRuntimeService


def get_service() -> QiskitRuntimeService:
    """Use IBM_QUANTUM_TOKEN from .env, else fall back to a saved account."""
    load_dotenv()
    token = os.getenv("IBM_QUANTUM_TOKEN")
    instance = os.getenv("IBM_QUANTUM_INSTANCE") or None
    if token and token != "paste_your_api_key_here":
        return QiskitRuntimeService(channel="ibm_quantum_platform", token=token, instance=instance)
    return QiskitRuntimeService()  # needs QiskitRuntimeService.save_account() earlier


def pick_backend(service: QiskitRuntimeService, name: str | None = None, min_qubits: int = 5):
    if name:
        return service.backend(name)
    return service.least_busy(operational=True, simulator=False, min_num_qubits=min_qubits)


def fake_backend():
    """Offline stand-in for a Heron device (dry runs, no token needed)."""
    from qiskit_ibm_runtime.fake_provider import FakeTorino

    return FakeTorino()


if __name__ == "__main__":
    # run from the project root:  python -m src.ibm
    fake = fake_backend()
    print(f"fake backend: {fake.name}, {fake.num_qubits} qubits")

    load_dotenv()
    token = os.getenv("IBM_QUANTUM_TOKEN")
    if token and token != "paste_your_api_key_here":
        service = get_service()
        best = pick_backend(service)
        print(f"least busy: {best.name} ({best.num_qubits} qubits)")
    else:
        print("No token in .env -> skipped the live IBM connection test")
    print("ibm.py OK")
