"""Turn raw counts into survival probabilities and save results."""
from __future__ import annotations

import json
import math
import re
from datetime import datetime
from pathlib import Path

import numpy as np

RESULT_NAME = re.compile(r"^hardware_(?P<backend>[A-Za-z0-9_-]+?)_(?P<stamp>\d{8}-\d{6})$")


def p0(counts: dict[str, int]) -> float:
    total = sum(counts.values())
    return counts.get("0", 0) / total if total else float("nan")


def p0_curve(all_counts: list[dict[str, int]]) -> np.ndarray:
    return np.array([p0(c) for c in all_counts])


def save_json(path: str | Path, payload: dict) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, default=lambda o: o.tolist())


def standard_error(counts: dict[str, int]) -> float:
    """Binomial standard error of P(0) for one circuit."""
    total = sum(counts.values())
    if not total:
        return float("nan")
    p = counts.get("0", 0) / total
    return math.sqrt(p * (1 - p) / total)


def summarize_hardware(dataset_id: str, payload: dict) -> dict:
    """Browser-friendly view of a saved hardware run: P(0), shots and error bars per mode."""
    match = RESULT_NAME.match(dataset_id)
    created = datetime.strptime(match["stamp"], "%Y%m%d-%H%M%S").isoformat() if match else None
    counts = payload.get("counts", {})
    series = []
    for mode, values in payload["p0"].items():
        mode_counts = counts.get(mode) or []
        series.append({
            "mode": mode,
            "p0": [float(v) for v in values],
            "shots": [sum(c.values()) for c in mode_counts],
            "standard_error": [standard_error(c) for c in mode_counts],
        })
    backend = str(payload.get("backend", match["backend"] if match else "unknown"))
    return {
        "id": dataset_id,
        "backend": backend,
        "simulated": backend.startswith("fake"),
        "qubit": payload.get("qubit"),
        "init": payload.get("init"),
        "created": created,
        "delays_us": [float(v) for v in payload["delays_us"]],
        "series": series,
    }


def list_hardware(results_dir: str | Path) -> list[dict]:
    """Every readable hardware_<backend>_<stamp>.json in results_dir, newest first."""
    out = []
    for path in Path(results_dir).glob("hardware_*.json"):
        if not RESULT_NAME.match(path.stem):
            continue
        try:
            summary = summarize_hardware(path.stem, json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            continue  # skip partial or hand-edited files
        out.append({k: summary[k] for k in ("id", "backend", "simulated", "qubit", "init", "created")}
                   | {"modes": [s["mode"] for s in summary["series"]], "points": len(summary["delays_us"])})
    return sorted(out, key=lambda d: (d["created"] or "", d["id"]), reverse=True)


def load_hardware(results_dir: str | Path, dataset_id: str) -> dict:
    if not RESULT_NAME.match(dataset_id):
        raise FileNotFoundError(dataset_id)
    path = Path(results_dir) / f"{dataset_id}.json"
    return summarize_hardware(dataset_id, json.loads(path.read_text(encoding="utf-8")))


if __name__ == "__main__":
    # run from the project root:  python -m src.analysis
    import os
    import tempfile

    assert p0({"0": 750, "1": 250}) == 0.75
    assert p0({"1": 100}) == 0.0
    assert np.isnan(p0({}))

    curve = p0_curve([{"0": 900, "1": 100}, {"0": 600, "1": 400}, {"0": 510, "1": 490}])
    print("P(0) curve:", curve)
    assert np.allclose(curve, [0.9, 0.6, 0.51])

    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "sub", "out.json")  # parent folder is created for you
        save_json(path, {"delays_us": np.array([10.0, 20.0]), "p0": {"none": curve}})
        with open(path, encoding="utf-8") as f:
            back = json.load(f)
        print("round trip:", back)
        assert back["delays_us"] == [10.0, 20.0]
        assert np.allclose(back["p0"]["none"], curve)

        name = "hardware_fake_torino_20260101-120000"
        save_json(os.path.join(d, name + ".json"),
                  {"backend": "fake_torino", "qubit": 0, "init": "x", "delays_us": [10.0],
                   "p0": {"none": [0.9]}, "counts": {"none": [{"0": 900, "1": 100}]}})
        listing = list_hardware(d)
        print("listing:", listing)
        assert [x["id"] for x in listing] == [name] and listing[0]["simulated"]
        data = load_hardware(d, name)
        assert data["series"][0]["shots"] == [1000]
        assert abs(data["series"][0]["standard_error"][0] - 0.3 / math.sqrt(1000)) < 1e-12
        try:
            load_hardware(d, "../secret")
            raise AssertionError("path traversal was not rejected")
        except FileNotFoundError:
            pass
    print("analysis.py OK")