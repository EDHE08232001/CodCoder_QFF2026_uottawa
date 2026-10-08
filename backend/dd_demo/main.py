"""CLI entry point.

  python main.py theory                 # NumPy filter-function style demo (instant)
  python main.py local                  # Qiskit circuits + explicit noise, exact statevector
  python main.py hardware --fake        # dry run of the hardware path, no token
  python main.py hardware               # real IBM device (needs token in .env)

Works from any folder (results always land in dd_demo/results/), on macOS,
Windows and Linux.
"""
from __future__ import annotations

import argparse
import time
from pathlib import Path

import numpy as np
from qiskit.quantum_info import Statevector

from src import analysis, circuits, fastsim, plotting, runner
from src.noise import colored_noise
from src.sequences import build_sequence
from src.theory import coherence_curve

RESULTS = Path(__file__).resolve().parent / "results"


def cmd_theory(args):
    dt, n_steps = 0.1e-6, 2000  # 0.1 us steps, 200 us window
    rng = np.random.default_rng(args.seed)
    noise = colored_noise(args.realizations, n_steps, dt, sigma=2 * np.pi * args.sigma_khz * 1e3,
                          kind=args.noise, rng=rng)
    times = np.linspace(4e-6, 100e-6, 25)
    curves = {}
    for name in ["free", "hahn", "cpmg", "udd", "xy4"]:
        seq = build_sequence(name, args.pulses)
        curves[seq.name] = coherence_curve(seq, times, noise, dt)
        print(f"{seq.name:10s} coherence @ {times[-1]*1e6:.0f} us = {curves[seq.name][-1]:.3f}")
    plotting.plot_curves(times * 1e6, curves, "idle time (us)", "coherence <cos phi>",
                         f"Dephasing under {args.noise} noise", RESULTS / "theory.png", hline=0)


def cmd_local(args):
    dt, n_steps = 0.1e-6, 1000
    rng = np.random.default_rng(args.seed)
    noise = colored_noise(args.realizations, n_steps, dt, sigma=2 * np.pi * args.sigma_khz * 1e3,
                          kind=args.noise, rng=rng)
    times = np.linspace(4e-6, 80e-6, 14)
    curves = {}
    t0 = time.time()
    for name in ["free", "hahn", "cpmg", "xy4"]:
        seq = build_sequence(name, args.pulses)
        if args.engine == "numpy":  # same physics, all realizations at once (see src/fastsim.py)
            y = fastsim.survival_curve(seq, times, noise, dt, init=args.init, pulse_error=args.pulse_error)
        else:
            y = []
            for T in times:
                probs = [
                    Statevector(circuits.noisy_idle_circuit(
                        seq, T, noise[r], dt, init=args.init, pulse_error=args.pulse_error
                    )).probabilities()[0]
                    for r in range(args.realizations)
                ]
                y.append(np.mean(probs))
        curves[seq.name] = np.array(y)
        print(f"{seq.name:10s} P(0) @ {times[-1]*1e6:.0f} us = {y[-1]:.3f}")
    print(f"({time.time() - t0:.0f}s)")
    plotting.plot_curves(
        times * 1e6, curves, "idle time (us)", "P(0)",
        f"Local sim, init={args.init}, pulse error={args.pulse_error:.0%}",
        RESULTS / "local.png", hline=0.5)


def cmd_hardware(args):
    from src import ibm

    if args.fake:
        backend = ibm.fake_backend()
    else:
        backend = ibm.pick_backend(ibm.get_service(), args.backend)
    print(f"Backend: {backend.name}, qubit {args.qubit}")

    delays_s = np.linspace(args.max_delay_us / args.points, args.max_delay_us, args.points) * 1e-6
    delays_dt = runner.delays_in_dt(backend, delays_s)
    actual_us = np.array(delays_dt) * backend.dt * 1e6
    isa = runner.build_isa_circuits(backend, args.qubit, delays_dt, args.init)

    curves = {}
    raw = {}
    for mode in args.modes.split(","):
        counts = runner.run_sweep(backend, isa, mode, args.shots)
        curves[mode] = analysis.p0_curve(counts)
        raw[mode] = counts

    stamp = time.strftime("%Y%m%d-%H%M%S")
    analysis.save_json(RESULTS / f"hardware_{backend.name}_{stamp}.json",
                       {"backend": backend.name, "qubit": args.qubit, "init": args.init,
                        "delays_us": actual_us, "p0": curves, "counts": raw})
    plotting.plot_curves(actual_us, curves, "idle time (us)", "P(0)",
                         f"{backend.name} qubit {args.qubit}, init={args.init}",
                         RESULTS / f"hardware_{backend.name}_{stamp}.png", hline=0.5)
    print(f"Saved results in {RESULTS}")

def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp):
        sp.add_argument("--seed", type=int, default=7)
        sp.add_argument("--noise", default="1/f", choices=["1/f", "lorentzian", "white", "static"])
        sp.add_argument("--sigma-khz", type=float, default=15.0, help="noise rms, kHz")
        sp.add_argument("--pulses", type=int, default=8)

    t = sub.add_parser("theory"); common(t)
    t.add_argument("--realizations", type=int, default=2000); t.set_defaults(fn=cmd_theory)

    l = sub.add_parser("local"); common(l)
    l.add_argument("--realizations", type=int, default=60)
    l.add_argument("--init", default="y", choices=["x", "y"])
    l.add_argument("--pulse-error", type=float, default=0.03, help="fractional over-rotation")
    l.add_argument("--engine", default="qiskit", choices=["qiskit", "numpy"],
                   help="qiskit: one Statevector per circuit; numpy: identical vectorised simulator")
    l.set_defaults(fn=cmd_local)

    h = sub.add_parser("hardware")
    h.add_argument("--fake", action="store_true", help="offline FakeTorino dry run")
    h.add_argument("--backend", default=None, help="e.g. ibm_torino (default: least busy)")
    h.add_argument("--qubit", type=int, default=0)
    h.add_argument("--shots", type=int, default=2000)
    h.add_argument("--points", type=int, default=10)
    h.add_argument("--max-delay-us", type=float, default=100.0)
    h.add_argument("--init", default="x", choices=["x", "y"])
    h.add_argument("--modes", default="none,runtime-XX,runtime-XY4",
                   help="comma list: " + ", ".join(runner.MODES))
    h.set_defaults(fn=cmd_hardware)

    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()