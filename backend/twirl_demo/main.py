"""CLI entry point.

  python main.py circuit                # draw the quench with and without Pauli frames
  python main.py aer                    # run every scenario on Qiskit Aer (instant)
  python main.py hardware --dry         # transpile + twirl for an offline fake Heron device
  python main.py hardware               # real IBM device (needs a token in .env)

Works from any folder (results always land in twirl_demo/results/), on macOS,
Windows and Linux.
"""
from __future__ import annotations

import argparse
import time
from pathlib import Path

from src import analysis, game, hardware, problems

RESULTS = Path(__file__).resolve().parent / "results"


def cmd_circuit(args):
    preview = game.circuit_preview(args.qubits, args.steps, args.field, args.seed)
    print(f"Transverse-field Ising quench: {args.qubits} qubits, {args.steps} Trotter steps, "
          f"h = {args.field}, t = {preview['total_time']}/J\n")
    print("Without Pauli twirling:")
    print(preview["bare"]["text"])
    print(f"\n{preview['bare']['gates']} gates, depth {preview['bare']['depth']}, "
          f"{preview['bare']['two_qubit_gates']} two-qubit gates\n")
    print(f"With Pauli twirling (seed {args.seed}):")
    print(preview["twirled"]["text"])
    print(f"\n{preview['twirled']['gates']} gates, depth {preview['twirled']['depth']}, "
          f"{preview['twirled']['two_qubit_gates']} two-qubit gates, "
          f"{preview['frame_count']} Pauli frames")
    print("\nFrames (before -> after each two-qubit gate):")
    for index, frame in enumerate(preview["frames"], start=1):
        print(f"  {index:3d}. {frame['gate']} on {frame['qubits']}: "
              f"{frame['before']} -> {frame['after']}")
    print(f"\nIdeal outcome unchanged: {preview['ideal_match']} "
          f"(largest probability difference {preview['largest_difference']:.1e})")
    print(f"Ideal magnetisation {preview['ideal']['magnetization']:+.4f}, "
          f"continuous-time answer {preview['exact']['magnetization']:+.4f}")


def cmd_aer(args):
    names = [args.scenario] if args.scenario else list(game.SCENARIOS)
    print(f"{args.qubits} qubits, {args.steps} steps, h = {args.field}, "
          f"{args.randomizations} randomisations x {args.shots} shots per treatment")
    for name in names:
        start = time.time()
        result = game.play(name, qubits=args.qubits, steps=args.steps, field=args.field,
                           randomizations=args.randomizations, shots=args.shots, seed=args.seed)
        verdict = ("twirling improved the result" if result["comparison"]["improved"]
                   else "twirling changed nothing" if result["comparison"]["unchanged"]
                   else "twirling moved the result away from ideal")
        print(f"\n{name}: {result['scenario_label']}")
        print(f"  ideal         {result['ideal']['magnetization']:+.4f}")
        print(f"  unmitigated   {result['unmitigated']['magnetization']:+.4f} "
              f"+-{result['unmitigated']['standard_error']:.4f}   error {result['unmitigated']['error']:.4f}"
              f"   TVD {result['unmitigated']['total_variation']:.4f}")
        print(f"  twirled       {result['twirled']['magnetization']:+.4f} "
              f"+-{result['twirled']['standard_error']:.4f}   error {result['twirled']['error']:.4f}"
              f"   TVD {result['twirled']['total_variation']:.4f}")
        print(f"  shift {result['comparison']['shift']:+.4f} "
              f"(3 sigma = {result['comparison']['uncertainty']:.4f}) -> {verdict} ({time.time() - start:.1f}s)")
        if args.save:
            stamp = time.strftime("%Y%m%d-%H%M%S")
            path = RESULTS / f"twirl_aer_{stamp}.json"
            analysis.save_json(path, dict(result, source="twirl_demo CLI"))
            print(f"  saved {path}")


def cmd_hardware(args):
    if args.dry:
        from qiskit_ibm_runtime.fake_provider import FakeTorino
        backend = FakeTorino()
    else:
        from dotenv import load_dotenv
        from qiskit_ibm_runtime import QiskitRuntimeService
        import os
        load_dotenv()
        service = QiskitRuntimeService(channel="ibm_quantum_platform",
                                       token=os.getenv("IBM_QUANTUM_TOKEN"),
                                       instance=os.getenv("IBM_QUANTUM_INSTANCE") or None)
        backend = (service.backend(args.backend) if args.backend
                   else service.least_busy(operational=True, simulator=False,
                                           min_num_qubits=args.qubits))
    print(f"Backend: {backend.name}")

    built = hardware.build_circuits(backend, args.qubits, args.steps, args.field,
                                    args.randomizations, args.seed)
    print(f"Physical qubits: {built['layout']}")
    print(f"ISA bare:    depth {built['bare'].depth()}, "
          f"{built['two_qubit_gates']} two-qubit gates, ops {dict(sorted(built['bare'].count_ops().items()))}")
    print(f"ISA twirled: depth {built['twirled'][0].depth()}, "
          f"ops {dict(sorted(built['twirled'][0].count_ops().items()))}")
    print(f"{args.randomizations} randomisations x {args.shots} shots per treatment "
          f"({2 * args.randomizations} circuits, {2 * args.randomizations * args.shots} shots total)")
    if args.dry:
        print("\nDry run: nothing was submitted. Drop --dry to run on a real device, "
              "or use 'python main.py aer' for a noisy simulation.")
        return

    circuits = [built["bare"]] * args.randomizations + built["twirled"]
    job = hardware.submit(backend, circuits, args.shots)
    print(f"Job id: {job.job_id()} - waiting for the result")
    counts = hardware.counts_from_result(job.result())
    reference = problems.ideal(args.qubits, args.steps, args.field)
    unmitigated = analysis.summarize(counts[:args.randomizations], args.qubits, reference)
    twirled = analysis.summarize(counts[args.randomizations:], args.qubits, reference)
    comparison = analysis.compare(unmitigated, twirled)
    print(f"  ideal        {reference['magnetization']:+.4f}")
    print(f"  unmitigated  {unmitigated['magnetization']:+.4f} +-{unmitigated['standard_error']:.4f}"
          f"   error {unmitigated['error']:.4f}")
    print(f"  twirled      {twirled['magnetization']:+.4f} +-{twirled['standard_error']:.4f}"
          f"   error {twirled['error']:.4f}")
    print(f"  shift {comparison['shift']:+.4f} (3 sigma = {comparison['uncertainty']:.4f})")

    stamp = time.strftime("%Y%m%d-%H%M%S")
    path = RESULTS / f"twirl_{backend.name}_{stamp}.json"
    analysis.save_json(path, dict(
        problems.describe(args.qubits, args.steps, args.field),
        backend=backend.name, scenario="hardware", scenario_label=f"IBM {backend.name}",
        randomizations=args.randomizations, shots=args.shots,
        total_shots=args.randomizations * args.shots, seed=args.seed,
        layout=built["layout"], job_id=job.job_id(), two_qubit_gates=built["two_qubit_gates"],
        frames_per_circuit=built["frames_per_circuit"], ideal=reference,
        exact=problems.exact(args.qubits, args.steps, args.field),
        unmitigated=unmitigated, twirled=twirled, comparison=comparison,
        counts={"unmitigated": counts[:args.randomizations], "twirled": counts[args.randomizations:]},
        source="twirl_demo CLI"))
    print(f"Saved {path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    def common(subparser):
        subparser.add_argument("--qubits", type=int, default=4)
        subparser.add_argument("--steps", type=int, default=4, help="Trotter steps")
        subparser.add_argument("--field", type=float, default=0.6, help="transverse field h, in units of J")
        subparser.add_argument("--seed", type=int, default=7)

    drawing = sub.add_parser("circuit")
    common(drawing)
    drawing.set_defaults(fn=cmd_circuit)

    aer = sub.add_parser("aer")
    common(aer)
    aer.add_argument("--scenario", choices=list(game.SCENARIOS), default=None,
                     help="default: run all of them")
    aer.add_argument("--randomizations", type=int, default=16)
    aer.add_argument("--shots", type=int, default=512)
    aer.add_argument("--save", action="store_true", help="write a JSON the web lab can list")
    aer.set_defaults(fn=cmd_aer)

    device = sub.add_parser("hardware")
    common(device)
    device.add_argument("--dry", action="store_true",
                        help="transpile and twirl for an offline fake device, submit nothing")
    device.add_argument("--backend", default=None, help="e.g. ibm_torino (default: least busy)")
    device.add_argument("--randomizations", type=int, default=8)
    device.add_argument("--shots", type=int, default=512)
    device.set_defaults(fn=cmd_hardware)

    args = parser.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
