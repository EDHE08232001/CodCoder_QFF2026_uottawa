# Pauli twirling demo (Qiskit + Aer + IBM Quantum)

A small, modular project that shows what **Pauli twirling** does to a real problem: a transverse-field Ising quench, run with and without random Pauli frames, first on the Qiskit Aer simulator with noise you choose, then on a real IBM quantum computer.

> **Terminology.** Twirling on its own is not error mitigation and it is not error suppression. It is *noise tailoring*: it converts whatever error the gates make into a random Pauli error of the same strength. Sometimes that alone moves an observable much closer to the truth (when the original error was coherent). Sometimes it changes nothing at all (when the error was already a Pauli channel). Its other job is to make the noise match the assumption that ZNE and PEC are built on.

---

## The idea in one minute

Pick a random two-qubit Pauli `P` and put it just before a two-qubit Clifford gate `C`. Because `C` is a Clifford, `Q = C P C†` is also a Pauli, so

```
Q · C · P  =  C      (up to a global phase)
```

The circuit still computes exactly the same thing: the two Paulis cancel through the gate. A noiseless machine cannot tell the difference, and the demo proves that on every request by comparing the two statevectors.

The *noise* on the gate does notice. It is sandwiched between the two Paulis, so it comes out conjugated by a random Pauli. Average over many random frames and the channel becomes its own **Pauli twirl**: all off-diagonal (coherent) parts average to zero and only the Pauli error probabilities survive.

| Error on the gate | What twirling does to it | Effect on the answer |
|---|---|---|
| Coherent, e.g. a leftover `exp(-i ε ZZ/2)` crosstalk | Becomes the Pauli channel `{I: cos²(ε/2), ZZ: sin²(ε/2)}` | Big improvement. The same kick repeated N times adds up like N; with random signs it only grows like √N. |
| Stochastic, e.g. depolarizing | Nothing: a Pauli channel is its own twirl | No change at all, to within shot noise. |
| Both at once | Only the coherent half goes | Partial improvement, down to the stochastic floor. |
| Readout error, Trotter error | Nothing: they are not gate errors | No change. |

Twirling costs no extra qubits and no extra shots, but the shot budget has to be **split across randomizations**: one random frame is a lottery ticket, not a twirl.

---

## The problem being run

A 1D transverse-field Ising chain, quenched from the all-up product state:

```
H = -J Σ Z_i Z_{i+1}  -  h Σ X_i          |ψ(0)⟩ = |0 0 ... 0⟩
```

The time evolution is Trotterised with a fixed step of `0.4/J`. Each step applies `RZZ(-2 J dt)` on the even bonds, then the odd bonds, then `RX(-2 h dt)` on every qubit. `RZZ` is built as `CX · RZ · CX`, so each step has `2·(qubits-1)` two-qubit gates and that is where the frames go.

The observable is the **average magnetisation** `m = (1/n) Σ ⟨Z_i⟩`, which runs from `+1` (all spins up) to `-1` (all down). The code also reports per-qubit `⟨Z_i⟩` and the total variation distance between the measured and ideal bitstring distributions.

Two references are computed for every run:

- **ideal** — the noiseless statevector of the *Trotterised* circuit. This is what mitigation aims at.
- **exact** — `scipy.linalg.expm` on the full Hamiltonian, i.e. continuous time. The gap between the two is Trotter error, which no amount of twirling can touch.

---

## What the demo contains

Three commands, in increasing realism. All run from `main.py`.

| Command | What it does | Needs a token? |
|---|---|---|
| `python main.py circuit` | Draws the quench without and with Pauli frames, lists every frame, and checks that the noiseless outcome is unchanged. Instant. | No |
| `python main.py aer` | Runs every noise scenario on Qiskit Aer: unmitigated and twirled, same shot budget each. A couple of seconds. | No |
| `python main.py hardware --dry` | Transpiles and twirls at ISA level for an offline fake Heron device, submits nothing. | No |
| `python main.py hardware` | The same comparison on a real IBM device, in a single job. | Yes |

JSON results (`--save` for Aer, always for hardware) are written to `results/` next to `main.py`, whichever folder you run from. The web lab lists exactly those files.

### Sample output of `python main.py aer`

Default settings (4 qubits, 4 Trotter steps, `h = 0.6`, 16 randomizations × 512 shots per treatment, seed 7):

```
coherent: Coherent ZZ crosstalk
  ideal         +0.5259
  unmitigated   +0.4070 +-0.0065   error 0.1188   TVD 0.1230
  twirled       +0.5130 +-0.0100   error 0.0129   TVD 0.0178
  shift +0.1060 (3 sigma = 0.0357) -> twirling improved the result

stochastic: Depolarizing (already random)
  unmitigated   +0.3850 +-0.0066   error 0.1409
  twirled       +0.3887 +-0.0074   error 0.1372
  shift +0.0037 (3 sigma = 0.0298) -> twirling changed nothing

mixed: Both kinds at once
  unmitigated   +0.2981 +-0.0065   error 0.2278
  twirled       +0.3828 +-0.0092   error 0.1431
  shift +0.0847 (3 sigma = 0.0338) -> twirling improved the result

clean: No noise at all
  unmitigated   +0.5225 +-0.0063   error 0.0034
  twirled       +0.5252 +-0.0069   error 0.0007
  shift +0.0027 (3 sigma = 0.0279) -> twirling changed nothing
```

The three lessons are all in there. The coherent error nearly disappears. The depolarizing error does not move, and the twirled number is the *same wrong answer*. And `mixed` lands on `stochastic`'s twirled value (0.1431 against 0.1372), which is what "only the coherent half goes" looks like in numbers.

### The scenarios

| id | Coherent ZZ kick | Two-qubit depolarizing | Expected verdict |
|---|---|---|---|
| `coherent` | 0.08 rad after every gate | 0 | twirling helps a lot |
| `stochastic` | 0 | 2% per gate | twirling does nothing |
| `mixed` | 0.08 rad | 2% | twirling removes the coherent half |
| `clean` | 0 | 0 | nothing to twirl |

The coherent error is injected as a `coherent_unitary_error` equal to `RZZ(angle)`; the stochastic one as a two-qubit `depolarizing_error`. Both sit on `cx`.

---

## How twirling is implemented

`src/twirl.py` has two jobs.

**The frame table.** For each supported gate it enumerates all 16 two-qubit Paulis and conjugates them through the gate with Qiskit's `Pauli.evolve(Clifford(gate), frame='s')`, dropping the phase (a global phase is unobservable, and the measurement basis is unaffected). The table is cached. Supported gates: `cx`, `cz`, `ecr` — the latter two are what IBM hardware actually runs.

**The rewrite.** `twirl(circuit, rng)` walks the circuit and replaces every two-qubit gate with `before · gate · after`, drawing `before` uniformly from the 16 Paulis. It returns the new circuit and the list of frames, so the UI and the CLI can show them.

For hardware there is one extra constraint, handled by `src/hardware.py`: the frames must be added **after** transpilation, or the transpiler will simply cancel them. They are emitted using only `x` and `rz(π)`, which are in IBM's basis, so the circuit stays ISA-valid and nothing is optimised away. `build_circuits` refuses to continue if the twirled circuit does not have exactly the same number of entangling gates as the bare one.

`python main.py hardware --dry --qubits 4 --steps 2 --randomizations 4` shows the result on FakeTorino:

```
Backend: fake_torino
Physical qubits: [0, 1, 2, 3]
ISA bare:    depth 51, 12 two-qubit gates, ops {'barrier': 2, 'cz': 12, 'measure': 4, 'rz': 54, 'sx': 32}
ISA twirled: depth 67, ops {'barrier': 2, 'cz': 12, 'measure': 4, 'rz': 75, 'sx': 32, 'x': 22}
```

Same 12 `cz` gates; the frames show up only as extra `x` and `rz`.

---

## Reading the error bars

Each treatment is `R` circuits of `S` shots. The magnetisation estimate is the pooled average over all `R·S` shots, and the quoted standard error is

```
max( spread / sqrt(R),  shot_error )
```

the spread being the standard deviation of the per-circuit values. The first term dominates for the twirled runs, because each frame really does give a different answer, and that extra spread is the honest price of the better average. `compare()` calls a shift real only when it exceeds **three** combined standard errors; anything smaller is reported as "no change". That band is what keeps the `stochastic` scenario honest.

---

## The hardware experiment

Both treatments are submitted as **one job**: `R` copies of the bare ISA circuit followed by the `R` twirled ones. Submitting them together is the only way to make the comparison fair, since device noise drifts between jobs.

```zsh
python main.py hardware --backend ibm_torino --qubits 4 --steps 4 \
    --randomizations 8 --shots 512
```

| Option | Default | Meaning |
|---|---|---|
| `--dry` | off | Use the offline FakeTorino and submit nothing |
| `--backend` | least busy | Device name, e.g. `ibm_torino` |
| `--qubits` | 4 | Chain length; mapped onto a connected line of physical qubits |
| `--steps` | 4 | Trotter steps |
| `--field` | 0.6 | Transverse field `h`, in units of `J` |
| `--randomizations` | 8 | Randomizations *per treatment* |
| `--shots` | 512 | Shots per circuit |
| `--seed` | 7 | Frame and layout seed |

The job costs `2 · randomizations · shots` shots in total. Real QPU time is limited on most plans, so start small.

IBM's own Sampler can twirl for you (`options.twirling.enable_gates`). This demo turns that off, along with its automatic dynamical decoupling, so the only twirling in the data is the one you can read in `src/twirl.py`.

---

## Setup

macOS / Linux (zsh or bash):

```zsh
cd backend/twirl_demo
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

Windows (PowerShell):

```powershell
cd backend\twirl_demo
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\Activate.ps1   # afterwards `python main.py ...` works as below
```

You can also reuse the repository's top-level `.venv`, which already covers everything in this folder (`backend/requirements.txt` includes qiskit-aer).

For `python main.py hardware` (without `--dry`) the CLI reads a `.env` in the folder you run from:

```
IBM_QUANTUM_TOKEN=your_api_key_here
IBM_QUANTUM_INSTANCE=
```

`IBM_QUANTUM_INSTANCE` is optional: set it only if you have several. `.env` is in `.gitignore`; never commit it. If the token is blank, the code falls back to an account saved earlier with `QiskitRuntimeService.save_account(...)`. The web app uses `backend/.env` instead and needs `IBM_ENABLE=true` as well (see the top-level README).

Tested with qiskit 2.5.2, qiskit-aer 0.17.2, qiskit-ibm-runtime 0.47.0, numpy 2.x, scipy 1.x on Python 3.12.

---

## Project layout

```
twirl_demo/
├── main.py              # CLI: circuit | aer | hardware
├── conftest.py          # lets plain `pytest` find src/
├── requirements.txt
├── src/
│   ├── problems.py      # the TFIM quench circuit, ideal statevector, exact expm reference
│   ├── twirl.py         # Pauli frame tables for cx/cz/ecr and the circuit rewrite
│   ├── noise.py         # Aer noise models: coherent ZZ kick and two-qubit depolarizing
│   ├── simulate.py      # runs one comparison on Aer, seeding every circuit separately
│   ├── analysis.py      # counts -> magnetisation, error bars, the 3-sigma verdict, JSON
│   ├── game.py          # the four scenarios, scoring, and the circuit preview
│   └── hardware.py      # line layout, ISA-level twirling, SamplerV2 submission
├── tests/test_basics.py
└── results/             # JSON lands here
```

Data flow for a hardware run: `main.py` -> `hardware.py` (layout, transpile, twirl, submit) -> `analysis.py` (magnetisation, verdict, JSON).

---

## Testing

Every module has a self-test in its `__main__` block. Run them from the project root with `-m` (relative imports fail if you run the file path directly):

```zsh
python -m src.problems      # Trotter circuit against expm, distributions normalised
python -m src.twirl         # frame tables against explicit matrices, up to phase
python -m src.noise         # the injected unitary equals RZZ(angle)
python -m src.analysis      # estimators, error bars, dataset round-trip
python -m src.simulate      # twirling a Pauli channel changes nothing; a coherent one improves
python -m src.game          # all four scenario lessons hold, and one frame is not a twirl
python -m src.hardware      # ISA twirl on FakeTorino keeps the entangling gate count
pytest                      # unit tests (or: python -m pytest, or python -m unittest discover -s tests)
```

Quick smoke test of the whole CLI:

```zsh
python main.py --help
python main.py circuit --qubits 3 --steps 1
python main.py aer --scenario coherent --randomizations 8 --shots 256
python main.py hardware --dry --qubits 4 --steps 2 --randomizations 4
```

---

## In the CODFISH web app

The web game imports this package as `backend.twirl_demo.src` (see `backend/twirl_api.py`); it needs only `backend/requirements.txt`, not python-dotenv or pytest.

| Endpoint | Uses |
|---|---|
| `GET /api/twirl/scenarios` | `game.describe_scenarios()` — the four scenarios, defaults, limits, and whether Aer is installed |
| `POST /api/twirl/circuit` | `game.circuit_preview()` — both circuit drawings, the frame list, and the proof that the ideal outcome is unchanged |
| `POST /api/twirl/play` | `game.play()` — one Aer comparison, scored. `503` if qiskit-aer is missing |
| `GET /api/twirl/hardware[/<id>]` | every `results/twirl_*.json` |
| `POST /api/twirl/hardware/runs`, `GET /api/twirl/hardware/runs/<id>` | `hardware.submit` on a real IBM backend (needs `IBM_ENABLE=true` and the IBM variables), saved in the same JSON format as the CLI |

## Limitations and known caveats

- **`--dry` measures nothing.** FakeTorino is used only to check that the ISA-level twirl survives transpilation. For noise, use `main.py aer`.
- **Aer seeds experiments by position in the job.** Submitting the bare and twirled circuits in one `run()` call correlated them and produced a fake 4-sigma "improvement" on a channel that cannot be twirled. `src/simulate.py` therefore runs every circuit in its own job with an explicit seed. If you refactor that loop for speed, re-run `python -m src.simulate`.
- **Frames go in after transpilation, always.** A twirl added to a logical circuit will be cancelled by the optimiser. That is why the hardware path emits Paulis as `x` and `rz(π)` and checks the entangling gate count afterwards.
- **One frame is not a twirl.** With `--randomizations 1` the result is a single random draw, and its error scatters several times more widely across seeds than a 16-frame average. The game turns this into a level.
- **Twirling does not shrink stochastic error.** If your error is already a Pauli channel, the honest result of this demo is "no change". Reach for ZNE, PEC or better gates.
- **Readout and Trotter error are untouched.** The `clean` scenario still misses the continuous-time answer, by exactly the Trotter error.
- **Measurement twirling is not implemented.** Only gate twirling. IBM's Sampler has a separate `twirling.enable_measure` option, which this demo keeps off.

---

## Ideas for next steps

- **Noise learning:** fit the twirled Pauli error rates per gate, which is the measurement PEC actually needs.
- **Chain it with ZNE:** twirl first, then amplify the noise, and check that the extrapolation behaves better than on untwirled data.
- **Measurement twirling:** randomly flip bits before readout and correct classically, to symmetrise asymmetric readout error.
- **More observables:** domain-wall density or the two-point correlator `⟨Z_0 Z_n⟩`, which decay much faster and are more sensitive to coherent error.
- **Error bars from repeats:** run the same comparison several times on hardware over an hour and plot how the coherent fraction drifts.
