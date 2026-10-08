"""Turn measured bitstrings into magnetisation estimates, and save results.

The observable is the average magnetisation m = (1/n) sum_i <Z_i>. Every shot
gives one value of m, so the shot noise follows from the counts alone. A twirled
estimate is the average over several randomisations, and its uncertainty is taken
from the spread between randomisations: that spread contains the shot noise and
the extra variance the randomisation itself adds.
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path

import numpy as np

RESULT_NAME = re.compile(r"^twirl_(?P<backend>[A-Za-z0-9_-]+?)_(?P<stamp>\d{8}-\d{6})$")


def _bits(counts: dict[str, int]) -> tuple[np.ndarray, np.ndarray]:
    """Shot counts as an array of +-1 spins per bitstring, qubit 0 first."""
    keys = list(counts)
    spins = np.array([[1 - 2 * int(bit) for bit in reversed(key.replace(" ", ""))] for key in keys], dtype=float)
    return spins, np.array([counts[key] for key in keys], dtype=float)


def per_qubit(counts: dict[str, int]) -> list[float]:
    spins, weights = _bits(counts)
    total = weights.sum()
    if not total:
        return []
    return [float(value) for value in spins.T @ weights / total]


def magnetization(counts: dict[str, int]) -> tuple[float, float]:
    """Average magnetisation and its binomial-style standard error from one circuit."""
    spins, weights = _bits(counts)
    total = weights.sum()
    if not total:
        return float("nan"), float("nan")
    values = spins.mean(axis=1)
    mean = float(values @ weights / total)
    variance = float(((values - mean) ** 2) @ weights / total)
    return mean, float(np.sqrt(variance / total))


def distribution(counts: dict[str, int], qubits: int) -> dict[str, float]:
    total = sum(counts.values())
    seen = {key.replace(" ", ""): value / total for key, value in counts.items()} if total else {}
    return {format(index, f"0{qubits}b"): round(seen.get(format(index, f"0{qubits}b"), 0.0), 6)
            for index in range(2 ** qubits)}


def total_variation(left: dict[str, float], right: dict[str, float]) -> float:
    keys = set(left) | set(right)
    return round(0.5 * sum(abs(left.get(key, 0.0) - right.get(key, 0.0)) for key in keys), 6)


def pooled(counts_list: list[dict[str, int]]) -> dict[str, int]:
    total: dict[str, int] = {}
    for counts in counts_list:
        for key, value in counts.items():
            total[key.replace(" ", "")] = total.get(key.replace(" ", ""), 0) + value
    return total


def summarize(counts_list: list[dict[str, int]], qubits: int, reference: dict) -> dict:
    """Combine the randomisations of one treatment into a single estimate."""
    everything = pooled(counts_list)
    values, errors = zip(*(magnetization(counts) for counts in counts_list))
    mean, shot_error = magnetization(everything)
    spread = float(np.std(values, ddof=1)) if len(values) > 1 else 0.0
    # The spread between randomisations already contains the shot noise, but it is
    # itself noisy for a handful of circuits, so keep whichever estimate is larger.
    standard_error = max(spread / np.sqrt(len(values)), shot_error) if len(values) > 1 else shot_error
    shared = distribution(everything, qubits)
    return {
        "magnetization": round(mean, 6),
        "standard_error": round(float(standard_error), 6),
        "shot_error": round(float(shot_error), 6),
        "spread": round(spread, 6),
        "error": round(abs(mean - reference["magnetization"]), 6),
        "values": [round(float(value) if np.isfinite(value) else 0.0, 6) for value in values],
        "value_errors": [round(float(error) if np.isfinite(error) else 0.0, 6) for error in errors],
        "per_qubit": [round(value, 6) for value in per_qubit(everything)],
        "distribution": shared,
        "total_variation": total_variation(shared, reference["distribution"]),
        "shots": int(sum(everything.values())),
        "circuits": len(counts_list),
    }


BAND = 3  # standard errors a shift must clear before we call it real


def compare(unmitigated: dict, twirled: dict) -> dict:
    """Did twirling move the answer by more than the two uncertainties allow?"""
    shift = twirled["magnetization"] - unmitigated["magnetization"]
    uncertainty = BAND * float(np.hypot(unmitigated["standard_error"], twirled["standard_error"]))
    return {"shift": round(shift, 6),
            "error_change": round(unmitigated["error"] - twirled["error"], 6),
            "uncertainty": round(uncertainty, 6),
            "significant": bool(abs(shift) > uncertainty),
            "improved": bool(abs(shift) > uncertainty and twirled["error"] < unmitigated["error"]),
            "unchanged": bool(abs(shift) <= uncertainty)}


def save_json(path: str | Path, payload: dict) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, default=lambda value: value.tolist())


def summarize_dataset(dataset_id: str, payload: dict) -> dict:
    match = RESULT_NAME.match(dataset_id)
    created = datetime.strptime(match["stamp"], "%Y%m%d-%H%M%S").isoformat() if match else None
    backend = str(payload.get("backend", match["backend"] if match else "unknown"))
    return dict(payload, id=dataset_id, backend=backend, created=created,
                simulated=backend.startswith("fake") or backend == "aer")


def list_datasets(results_dir: str | Path) -> list[dict]:
    """Every readable twirl_<backend>_<stamp>.json in results_dir, newest first."""
    out = []
    for path in Path(results_dir).glob("twirl_*.json"):
        if not RESULT_NAME.match(path.stem):
            continue
        try:
            data = summarize_dataset(path.stem, json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            continue  # skip partial or hand-edited files
        out.append({key: data.get(key) for key in
                    ("id", "backend", "simulated", "created", "qubits", "steps", "field",
                     "randomizations", "shots", "scenario", "job_id", "layout", "experiment")})
    return sorted(out, key=lambda item: (item["created"] or "", item["id"]), reverse=True)


def load_dataset(results_dir: str | Path, dataset_id: str) -> dict:
    if not RESULT_NAME.match(dataset_id):
        raise FileNotFoundError(dataset_id)
    path = Path(results_dir) / f"{dataset_id}.json"
    return summarize_dataset(dataset_id, json.loads(path.read_text(encoding="utf-8")))


if __name__ == "__main__":
    # run from the project root:  python -m src.analysis
    import tempfile

    assert per_qubit({"00": 10}) == [1.0, 1.0]
    assert per_qubit({"01": 10}) == [-1.0, 1.0]   # qubit 0 is the rightmost bit
    mean, error = magnetization({"00": 50, "11": 50})
    print("half up, half down:", mean, round(error, 4))
    assert mean == 0.0 and abs(error - 0.1) < 1e-9

    mean, error = magnetization({"0000": 1000})
    assert mean == 1.0 and error == 0.0
    print("distribution of a 2-qubit run:", distribution({"01": 3, "10": 1}, 2))
    assert total_variation({"00": 1.0}, {"11": 1.0}) == 1.0

    reference = {"magnetization": 1.0, "distribution": {"00": 1.0}}
    summary = summarize([{"00": 90, "11": 10}, {"00": 80, "11": 20}], 2, reference)
    print("summary:", {key: summary[key] for key in ("magnetization", "error", "spread", "shots", "values")})
    assert summary["shots"] == 200 and summary["circuits"] == 2
    assert abs(summary["magnetization"] - 0.7) < 1e-9
    assert abs(summary["total_variation"] - 0.15) < 1e-9

    biased = summarize([{"11": 100}], 2, reference)
    print("compare:", compare(biased, summary))
    assert compare(biased, summary)["improved"]
    assert compare(summary, summary)["unchanged"]

    with tempfile.TemporaryDirectory() as folder:
        name = "twirl_aer_20260101-120000"
        save_json(Path(folder) / f"{name}.json", {"backend": "aer", "qubits": 2, "steps": 1,
                                                  "ideal": reference, "unmitigated": summary})
        listing = list_datasets(folder)
        print("listing:", listing)
        assert [item["id"] for item in listing] == [name] and listing[0]["simulated"]
        assert load_dataset(folder, name)["unmitigated"]["shots"] == 200
        try:
            load_dataset(folder, "../secret")
            raise AssertionError("path traversal was not rejected")
        except FileNotFoundError:
            pass
    print("analysis.py OK")
