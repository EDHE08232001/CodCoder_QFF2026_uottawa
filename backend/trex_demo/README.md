# Readout mitigation demo (Qiskit + IBM Quantum)

A small, modular project that shows how **readout mitigation** corrects a biased or
noisy detector: calibrate a known input against what the detector reports, then
invert that calibration to correct an unknown measurement.

> **Terminology.** This is sometimes called TREX (Twirled Readout Error
> eXtinction) in IBM's documentation; the "twirled" part (randomizing which
> physical bit each qubit's classical result lands on, shot to shot, so a
> systematic bias averages into plain shot noise) is not implemented here.
> This demo is the calibrate-then-invert half: build an *assignment matrix*
> from known inputs, then use it to correct an unknown measurement. It is a
> **mitigation** (post-processing many shots), not a suppression like
> dynamical decoupling, and it combines with both DD and twirling.

---

## The idea in one minute

A measurement is never perfect: a qubit truly in `|0>` is sometimes reported
as `1`, and vice versa, at some known-ish rate. Calibrate those rates by
preparing states you already know (`|0...0>`, `|1...1>`, or every
computational basis state) and recording what the detector reports. That
gives an **assignment matrix** `A`, where `A[i, j]` is the probability of
reading `i` when the true state was `j`. Invert it, and a noisy measured
distribution can be corrected back toward the truth: `true ≈ A⁻¹ @ measured`.

Two ways to build `A`:

| Calibration | Circuits needed | Assumes | Exact when |
|---|---|---|---|
| **Tensored** (cheap) | 2, regardless of qubit count (global `|0...0>` and `|1...1>`) | every qubit misreads independently | there is no readout crosstalk |
| **Correlated** (expensive) | `2**n`, one per basis state | nothing | always, at exponential cost |

The lesson this demo is built around: the cheap calibration is "free" and
correct *as long as qubits misread independently* — which most of the time
they do, and `mthree`-style calibration leans on exactly this trick. But
when two qubits' readout errors are **correlated** (crosstalk), the cheap
calibration systematically under-corrects no matter how many shots you give
it, and only the expensive, fully correlated calibration fixes it.

Direct matrix inversion can return negative "probabilities" — not a sign of
a bug, just a reminder that the inverse of a valid (column-stochastic)
matrix is not itself one. A non-negative least-squares fit (`scipy.optimize.nnls`)
stays physical, at the cost of being a biased estimator.

---

## What the demo contains

| Command | What it does | Needs a token? |
|---|---|---|
| `python main.py theory` | All four teaching levels (bias, crowd, crosstalk, ghz), both calibration modes where offered. Instant. | No |
| `python main.py hardware --fake` | The same calibrate-and-correct pipeline on an offline fake device. Checks the code path only. | No |
| `python main.py hardware` | Calibration + a GHZ target circuit on a real IBM device. | Yes |

Readout error here is a classical Markov channel on already-collapsed
measurement bits, so the simulated levels need no quantum circuit simulator
at all — `src/noise.py` samples the channel directly in NumPy (see its
module docstring for why `qiskit_aer.noise.ReadoutError` was tried first and
dropped: Aer 0.17.2 silently ignores a correlated multi-qubit `ReadoutError`
because circuits always compile `measure` into separate single-qubit
instructions).

### Sample output of `python main.py theory`

```
bias       [tensored  ] score=0.0099 target=0.02 passed=True  stars=2 (2 calibration circuits)
crowd      [tensored  ] score=0.0242 target=0.03 passed=True  stars=1 (2 calibration circuits)
crosstalk  [tensored  ] score=0.1097 target=0.04 passed=False stars=0 (2 calibration circuits)
crosstalk  [correlated] score=0.0337 target=0.04 passed=True  stars=1 (16 calibration circuits)
ghz        [tensored  ] score=0.0125 target=0.05 passed=True  stars=2 (2 calibration circuits), parity raw +0.592 -> corrected +0.987
ghz        [correlated] score=0.0142 target=0.05 passed=True  stars=2 (16 calibration circuits), parity raw +0.620 -> corrected +0.986
```

`crosstalk` is the key level: the same four qubits, calibrated the cheap way,
fail to recover the target GHZ state's distribution (`passed=False`) no
matter how many shots you throw at the cheap calibration — only the
16-circuit correlated calibration gets there.

---

## The hardware experiment

### The circuits

1. **Calibration**: either the 2 global circuits (`|0...0>`, `|1...1>`, tensored
   mode) or all `2**n` basis-state circuits (correlated mode, capped at 4
   qubits / 16 circuits for a hardware job).
2. **Target**: a GHZ state (`H` then a `CX` chain) — a genuinely entangled
   distribution to correct, not just a classical bias.

All circuits are submitted as one job (same device snapshot backs the
calibration and the thing it corrects), with IBM's own dynamical decoupling
and gate/measurement twirling switched off, exactly as the DD and Pauli
twirling labs do.

### Reading the result

- **raw / corrected total variation distance** to the ideal GHZ distribution
  — lower is better, 0 is perfect.
- **assignment matrix condition number** — how sensitive the correction is
  to calibration noise; a large value is a warning sign, not just a detail.
- **inverted vs. corrected (nnls) distribution** — the direct inverse can go
  negative; the nnls correction is the physical one actually used to score
  the level.

---

## Setup

macOS / Linux (zsh or bash):

```zsh
cd backend/trex_demo
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # then paste your IBM Quantum API key into .env
```

Windows (PowerShell):

```powershell
cd backend\trex_demo
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
.\.venv\Scripts\Activate.ps1
```

You can also reuse the repository's top-level `.venv`
(`pip install -r backend/trex_demo/requirements.txt` on top of
`backend/requirements.txt`). `IBM_QUANTUM_INSTANCE` is optional. `.env` is in
`.gitignore`; never commit it. If the token is blank, the code falls back to
an account saved earlier with `QiskitRuntimeService.save_account(...)`.

---

## Running the hardware experiment

```zsh
python main.py hardware --qubits 4 --mode tensored --shots 2000
python main.py hardware --qubits 4 --mode correlated --shots 2000   # 16 calibration circuits
python main.py hardware --fake --qubits 3                            # offline dry run
```

| Option | Default | Meaning |
|---|---|---|
| `--fake` | off | Use the offline FakeTorino instead of a real device |
| `--backend` | least busy | Device name, for example `ibm_quebec` |
| `--qubits` | 4 | Number of qubits (correlated mode capped at 4 -> 16 circuits) |
| `--mode` | `tensored` | `tensored` (2 circuits) or `correlated` (`2**qubits` circuits) |
| `--shots` | 2000 | Shots per circuit |

On Windows use `.\run.ps1` (or the same command with `python`); on
macOS/Linux `./run.sh` runs it. Output file in `results/`:
`trex_<backend>_<timestamp>.json` (assignment matrix, raw and corrected
distributions, raw counts).

---

## Project layout

```
trex_demo/
├── main.py              # CLI: theory | hardware
├── conftest.py          # lets plain `pytest` find src/
├── requirements.txt
├── .env.example
├── run.sh / run.ps1
├── src/
│   ├── calibration.py   # assignment-matrix math: build, tensor, invert, nnls-correct (pure NumPy/SciPy)
│   ├── noise.py         # the *true* classical readout-noise channel for the simulated levels (pure NumPy)
│   ├── circuits.py      # calibration + GHZ target circuits
│   ├── game.py          # seeded levels and sandbox for the web game
│   ├── ibm.py            # token loading, backend choice, offline fake backend
│   ├── runner.py         # ISA transpile, SamplerV2 submit (blocking run or submit-only)
│   └── analysis.py       # assemble a corrected result from raw counts, saved-result loading, JSON saving
├── tests/test_basics.py
└── results/              # hardware run JSON lands here
```

Data flow for a hardware run: `main.py` -> `ibm.py` (backend) -> `runner.py`
(transpile, submit) -> `analysis.py` (assignment matrix, correction, JSON).

---

## Testing

Every module has a self-test in its `__main__` block. Run them from the
project root with `-m`:

```zsh
python -m src.calibration
python -m src.noise
python -m src.circuits
python -m src.game
python -m src.runner
python -m src.analysis
pytest                     # or: python -m unittest discover -s tests
```

---

## In the CODFISH web app

The web game imports this package as `backend.trex_demo.src` (see
`backend/trex_api.py`); it needs only `backend/requirements.txt`.

| Endpoint | Uses |
|---|---|
| `GET /api/trex/levels` | `game.describe_levels()` |
| `POST /api/trex/play` | `game.play()`, scored for pass/fail/stars |
| `POST /api/trex/explore` | `game.explore()`, the free-form sandbox |
| `GET /api/trex/hardware[/<id>]` | every saved `results/trex_*.json` |
| `POST /api/trex/hardware/runs`, `GET /api/trex/hardware/runs/<id>` | `runner.submit` on a real IBM backend (needs `IBM_ENABLE=true`) |

## Limitations and known caveats

- **Readout noise is a hand-written channel, not Aer's.** See `src/noise.py`'s
  docstring: a correlated `qiskit_aer.noise.ReadoutError` on more than one
  qubit was tried and silently had no effect in this environment's
  qiskit-aer 0.17.2, so the simulated levels sample the channel directly.
- **Crosstalk here is a toy model.** A convex mixture of "independent" and
  "both flip together," not a physically derived crosstalk mechanism.
- **Correlated calibration is capped at 4 qubits on hardware** (16 circuits)
  to keep a job's circuit count bounded; the simulated sandbox allows up to 5.
- **GHZ depth grows with qubit count.** On real hardware, gate errors on the
  longer `CX` chain compete with the readout error being corrected; a bigger
  GHZ is not automatically a cleaner teaching example.

## Ideas for next steps

- **Measurement twirling**: randomize which physical outcome bit maps to
  which classical bit, shot to shot, turning a systematic single-qubit bias
  into plain shot noise — the other half of what IBM calls TREX.
  Combine with dynamical decoupling and Pauli twirling for a fuller
  mitigation stack.
