"""Turn hardware calibration + target counts into a corrected result, and save/load results."""
from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path

import numpy as np

from . import calibration
from .circuits import ghz_circuit, ideal_probabilities

RESULT_NAME = re.compile(r"^trex_(?P<backend>[A-Za-z0-9_-]+?)_(?P<stamp>\d{8}-\d{6})$")


def assignment_from_counts(calibration_counts: list[dict[str, int]], calibration_mode: str,
                           qubits: int) -> np.ndarray:
    if calibration_mode == "tensored":
        if len(calibration_counts) != 2:
            raise ValueError("tensored calibration needs exactly 2 circuits (all-0, all-1)")
        counts0, counts1 = calibration_counts
        matrices = [calibration.calibrate_1q_from_global_counts(counts0, counts1, qubit, qubits)
                   for qubit in range(qubits)]
        return calibration.tensor_assignment_matrix(matrices)
    if calibration_mode == "correlated":
        if len(calibration_counts) != 2 ** qubits:
            raise ValueError(f"correlated calibration needs exactly {2 ** qubits} circuits")
        return calibration.correlated_assignment_matrix(calibration_counts)
    raise ValueError("calibration_mode must be 'tensored' or 'correlated'")


def build_dataset(backend: str, qubits: int, calibration_mode: str, shots: int, seed: int, job_id: str,
                  layout: list[int], calibration_counts: list[dict[str, int]],
                  target_counts: dict[str, int]) -> dict:
    assignment = assignment_from_counts(calibration_counts, calibration_mode, qubits)
    ideal = ideal_probabilities(ghz_circuit(qubits, measure=False))
    measured = calibration.counts_to_vector(target_counts, qubits)
    inverted = calibration.invert_correct(assignment, measured)
    corrected = calibration.nnls_correct(assignment, measured)
    return {
        "backend": backend, "qubits": qubits, "calibration_mode": calibration_mode, "shots": shots,
        "seed": seed, "job_id": job_id, "layout": layout,
        "calibration_circuits_used": len(calibration_counts),
        "calibration_counts": calibration_counts, "target_counts": target_counts,
        "assignment_matrix": assignment.tolist(),
        "assignment_condition_number": round(calibration.condition_number(assignment), 3),
        "raw_distribution": calibration.vector_to_counts(measured, qubits),
        "corrected_distribution": calibration.vector_to_counts(corrected, qubits),
        "inverted_distribution": calibration.vector_to_counts(inverted, qubits),
        "inverted_negative_mass": round(float(-inverted[inverted < 0].sum()), 6),
        "ideal_distribution": calibration.vector_to_counts(ideal, qubits),
        "raw_total_variation": round(calibration.total_variation(measured, ideal), 6),
        "corrected_total_variation": round(calibration.total_variation(corrected, ideal), 6),
        "source": "CODFISH web app",
    }


def save_json(path: str | Path, payload: dict) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, default=lambda value: value.tolist())


def summarize_dataset(dataset_id: str, payload: dict) -> dict:
    match = RESULT_NAME.match(dataset_id)
    created = datetime.strptime(match["stamp"], "%Y%m%d-%H%M%S").isoformat() if match else None
    backend = str(payload.get("backend", match["backend"] if match else "unknown"))
    return dict(payload, id=dataset_id, backend=backend, created=created,
                simulated=backend.startswith("fake"))


def list_datasets(results_dir: str | Path) -> list[dict]:
    """Every readable trex_<backend>_<stamp>.json in results_dir, newest first."""
    out = []
    for path in Path(results_dir).glob("trex_*.json"):
        if not RESULT_NAME.match(path.stem):
            continue
        try:
            data = summarize_dataset(path.stem, json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            continue  # skip partial or hand-edited files
        out.append({key: data.get(key) for key in
                    ("id", "backend", "simulated", "created", "qubits", "calibration_mode",
                     "shots", "corrected_total_variation")})
    return sorted(out, key=lambda item: (item["created"] or "", item["id"]), reverse=True)


def load_dataset(results_dir: str | Path, dataset_id: str) -> dict:
    if not RESULT_NAME.match(dataset_id):
        raise FileNotFoundError(dataset_id)
    path = Path(results_dir) / f"{dataset_id}.json"
    return summarize_dataset(dataset_id, json.loads(path.read_text(encoding="utf-8")))


if __name__ == "__main__":
    # run from the project root:  python -m src.analysis
    import tempfile

    # Build a dataset from hand-made counts: qubit 0 misreads 1 as 0 a fifth of the time.
    counts0 = {"00": 1000}
    counts1 = {"11": 800, "10": 200}
    dataset = build_dataset("fake_torino", 2, "tensored", shots=1000, seed=0, job_id="job-1",
                            layout=[0, 1], calibration_counts=[counts0, counts1],
                            target_counts={"00": 500, "11": 400, "01": 100})
    print("condition number:", dataset["assignment_condition_number"])
    assert dataset["calibration_circuits_used"] == 2
    assert abs(sum(dataset["corrected_distribution"].values()) - 1.0) < 1e-9

    with tempfile.TemporaryDirectory() as folder:
        name = "trex_fake_torino_20260101-120000"
        save_json(Path(folder) / f"{name}.json", dataset)
        listing = list_datasets(folder)
        print("listing:", listing)
        assert [item["id"] for item in listing] == [name] and listing[0]["simulated"]
        assert load_dataset(folder, name)["qubits"] == 2
        try:
            load_dataset(folder, "../secret")
            raise AssertionError("path traversal was not rejected")
        except FileNotFoundError:
            pass
    print("analysis.py OK")
