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
        return QiskitRuntimeService(
            channel="ibm_quantum_platform", token=token, instance=instance
        )
    return QiskitRuntimeService()  # needs QiskitRuntimeService.save_account() earlier


def pick_backend(service: QiskitRuntimeService, name: str | None = None, min_qubits: int = 5):
    if name:
        return service.backend(name)
    return service.least_busy(operational=True, simulator=False, min_num_qubits=min_qubits)


def fake_backend():
    """Offline stand-in for a Heron device (dry runs, no token needed)."""
    from qiskit_ibm_runtime.fake_provider import FakeTorino

    class PatchedFakeTorino(FakeTorino):
        # A few snapshot qubits report T2 > 2*T1, which Aer's noise model rejects.
        # Clamp them where the calibration dict is loaded.
        def _set_props_dict_from_json(self):
            super()._set_props_dict_from_json()
            for qubit in self._props_dict["qubits"]:
                vals = {n["name"]: n for n in qubit}
                t1, t2 = vals.get("T1"), vals.get("T2")
                if t1 and t2 and t2["value"] > 2 * t1["value"]:
                    t2["value"] = 2 * t1["value"]

    return PatchedFakeTorino()


if __name__ == "__main__":
    # run from the project root:  python -m src.ibm
    fake = fake_backend()
    print(f"fake backend: {fake.name}, {fake.num_qubits} qubits, "
          f"dt={fake.dt * 1e9:.2f} ns, delay granularity={fake.target.granularity} dt")

    # the T2 <= 2*T1 clamp must be in effect
    bad = []
    for i, q in enumerate(fake.properties().qubits):
        v = {n.name: n.value for n in q}
        if v.get("T1") and v.get("T2") and v["T2"] > 2 * v["T1"]:
            bad.append(i)
    assert not bad, f"unclamped T2>2*T1 on qubits {bad}"

    # live test only if a real token is configured
    load_dotenv()
    token = os.getenv("IBM_QUANTUM_TOKEN")
    if token and token != "paste_your_api_key_here":
        service = get_service()
        names = [b.name for b in service.backends(operational=True, simulator=False)]
        print("operational backends:", names)
        best = pick_backend(service)
        print(f"least busy: {best.name} ({best.num_qubits} qubits, "
              f"dt={best.dt * 1e9:.2f} ns, granularity={best.target.granularity} dt)")
    else:
        print("No token in .env -> skipped the live IBM connection test")
    print("ibm.py OK")