"""Standalone ZNE demo: teaching measurements or ideal folded circuits.

Run from any directory with the project's Python environment. No IBM job is
submitted by these commands; IBM submission remains available through the lab.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.zne_demo.src.analysis import fit, simulate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['aer', 'teaching', 'circuit'])
    parser.add_argument('--model', choices=['linear', 'exponential'], default='exponential')
    parser.add_argument('--shots', type=int, default=4000)
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()
    if args.shots < 2:
        parser.error('--shots must be at least 2')
    if args.command == 'circuit':
        from backend.zne_demo.src.hardware import build_circuit, reference_value
        for factor in (1, 3, 5):
            circuit = build_circuit(factor)
            print(f'{factor}x: {circuit.count_ops()["cx"]} CX gates')
            print(circuit.draw(output='text'))
        print(f'Ideal reference: {reference_value():.6f}')
    elif args.command == 'aer':
        from backend.zne_demo.src.simulator import simulate as aer_simulate
        run = aer_simulate(args.model, args.shots, args.seed)
        print(json.dumps(dict(**run, fit=fit(run['points'], args.model)), indent=2))
    else:
        points = simulate(args.model, args.shots, args.seed)
        print(json.dumps(dict(source='Synthetic teaching model (not IBM hardware)',
            reference=0.9, points=points, fit=fit(points, args.model)), indent=2))


if __name__ == '__main__':
    main()
