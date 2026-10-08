"""Classical colored-noise generators for the qubit detuning beta(t) [rad/s]."""
from __future__ import annotations

import numpy as np


def colored_noise(
    n_real: int,
    n_steps: int,
    dt: float,
    sigma: float,
    kind: str = "1/f",
    tau_c: float = 20e-6,
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    """Zero-mean Gaussian noise traces, shape (n_real, n_steps), std = sigma.

    kind: "1/f", "lorentzian" (correlation time tau_c), "white", or "static"
    (one constant detuning per realization: the textbook spin-echo case).
    """
    rng = rng or np.random.default_rng()
    if kind == "static":
        offsets = rng.standard_normal((n_real, 1))
        return np.repeat(offsets * (sigma / offsets.std()), n_steps, axis=1)
    white = rng.standard_normal((n_real, n_steps))
    spec = np.fft.rfft(white, axis=1)
    f = np.fft.rfftfreq(n_steps, dt)

    if kind == "1/f":
        shape = 1.0 / np.sqrt(np.maximum(f, f[1]))
    elif kind == "lorentzian":
        shape = 1.0 / np.sqrt(1.0 + (2 * np.pi * f * tau_c) ** 2)
    elif kind == "white":
        shape = np.ones_like(f)
    else:
        raise ValueError(f"Unknown noise kind '{kind}'")

    trace = np.fft.irfft(spec * shape, n=n_steps, axis=1)
    return trace * (sigma / trace.std())


if __name__ == "__main__":
    # run from the project root:  python -m src.noise
    dt, n_steps, sigma = 0.1e-6, 2000, 2 * np.pi * 15e3
    rng = np.random.default_rng(0)
    freqs = np.fft.rfftfreq(n_steps, dt)[1:]  # skip DC
    expected_slope = {"1/f": (-1.2, -0.8), "lorentzian": (-2.2, -1.6), "white": (-0.15, 0.15)}

    for kind, (lo, hi) in expected_slope.items():
        x = colored_noise(500, n_steps, dt, sigma, kind=kind, rng=rng)
        psd = (np.abs(np.fft.rfft(x, axis=1)) ** 2).mean(axis=0)[1:]
        slope = np.polyfit(np.log(freqs), np.log(psd), 1)[0]  # log-log slope of the spectrum
        print(f"{kind:10s} shape={x.shape} mean={x.mean():+.1e} "
              f"std/sigma={x.std() / sigma:.3f} PSD slope={slope:+.2f}")
        assert abs(x.std() / sigma - 1) < 1e-6
        assert lo < slope < hi
    static = colored_noise(500, n_steps, dt, sigma, kind="static", rng=rng)
    print(f"static     shape={static.shape} std/sigma={static.std() / sigma:.3f} constant per row="
          f"{bool(np.all(static == static[:, :1]))}")
    assert abs(static.std() / sigma - 1) < 1e-6 and np.all(static == static[:, :1])
    print("noise.py OK")