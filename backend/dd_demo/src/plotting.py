"""Matplotlib helpers."""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


def plot_curves(x, curves: dict, xlabel: str, ylabel: str, title: str, path, hline=None):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(7, 4.2))
    for label, y in curves.items():
        ax.plot(x, y, marker="o", ms=4, lw=1.6, label=label)
    if hline is not None:
        ax.axhline(hline, color="gray", ls=":", lw=1)
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    ax.set_title(title)
    ax.grid(alpha=0.3)
    ax.legend()
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


if __name__ == "__main__":
    # run from the project root:  python -m src.plotting
    import os

    import numpy as np

    x = np.linspace(10, 100, 10)
    curves = {"none": 0.5 + 0.5 * np.exp(-x / 40), "runtime-XX": 0.5 + 0.5 * np.exp(-x / 90)}
    out = "results/_plotting_demo.png"
    plot_curves(x, curves, "idle time (us)", "P(0)", "plotting demo", out, hline=0.5)
    print("wrote", out, os.path.getsize(out), "bytes")
    assert os.path.getsize(out) > 5000
    print("plotting.py OK")