"""CLI entry point.

  python main.py theory                 # all 4 levels, both calibration modes where offered (instant)
  python main.py hardware --fake        # dry run of the hardware path, no token
  python main.py hardware               # real IBM device (needs token in .env)

Works from any folder (results always land in trex_demo/results/), on macOS,
Windows and Linux.
"""
from __future__ import annotations

import argparse
import time
from pathlib import Path

from src import analysis, game, runner

RESULTS = Path(__file__).resolve().parent / "results"


def cmd_theory(args):
    # Each level is seeded for a specific, reliable teaching outcome; it is not
    # overridden here (that is what the sandbox / `explore` is for).
    for level_id, level in game.LEVELS.items():
        for mode in level.modes:
            result = game.play(level_id, calibration_mode=mode)
            extra = (f", parity raw {result['parity_raw']:+.3f} -> corrected {result['parity_corrected']:+.3f}"
                    if level.metric == "parity" else "")
            print(f"{level_id:10s} [{mode:10s}] score={result['score']:.4f} target={level.target} "
                  f"passed={result['passed']} stars={result['stars']} "
                  f"({result['calibration_circuits_used']} calibration circuits){extra}")


def cmd_hardware(args):
    from src import ibm

    backend = ibm.fake_backend() if args.fake else ibm.pick_backend(ibm.get_service(), args.backend)
    print(f"Backend: {backend.name}, {args.qubits} qubits, calibration={args.mode}")

    built = runner.build_circuits(backend, args.qubits, args.mode, seed=args.seed)
    job = runner.submit(backend, built["calibration"], built["target"], args.shots)
    print(f"Submitted job {job.job_id()}; waiting for results...")
    counts = runner.counts_from_result(job.result())
    calibration_counts, target_counts = counts[:-1], counts[-1]

    dataset = analysis.build_dataset(backend.name, args.qubits, args.mode, args.shots, args.seed,
                                     job.job_id(), built["layout"], calibration_counts, target_counts)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    path = RESULTS / f"trex_{backend.name}_{stamp}.json"
    analysis.save_json(path, dataset)
    print(f"raw TV {dataset['raw_total_variation']:.4f} -> corrected TV {dataset['corrected_total_variation']:.4f}")
    print(f"Saved {path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    theory = sub.add_parser("theory")
    theory.set_defaults(fn=cmd_theory)

    hardware = sub.add_parser("hardware")
    hardware.add_argument("--fake", action="store_true", help="offline FakeTorino dry run")
    hardware.add_argument("--backend", default=None, help="e.g. ibm_torino (default: least busy)")
    hardware.add_argument("--qubits", type=int, default=4)
    hardware.add_argument("--mode", default="tensored", choices=["tensored", "correlated"])
    hardware.add_argument("--shots", type=int, default=2000)
    hardware.add_argument("--seed", type=int, default=7)
    hardware.set_defaults(fn=cmd_hardware)

    args = parser.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
