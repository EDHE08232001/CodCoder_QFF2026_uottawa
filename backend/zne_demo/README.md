# Zero-noise extrapolation

This package contains the ZNE experiment independently of the web application,
following the layout of `dd_demo` and `twirl_demo`.

- `src/analysis.py`: counts, uncertainty, synthetic teaching data and weighted fits.
- `src/hardware.py`: folded circuits, ideal reference, IBM submission and polling.
- `../zne_api.py`: request validation, stored runs and job lifecycle.
- `../../frontend/src/ZNEGame.jsx`: interactive ZNE lab.

Install `backend/requirements.txt` using the project environment. From the
repository root on Windows:

```cmd
.venv\Scripts\python.exe backend\zne_demo\main.py teaching --model linear
.venv\Scripts\python.exe backend\zne_demo\main.py teaching --model exponential --shots 10000
.venv\Scripts\python.exe backend\zne_demo\main.py circuit
.venv\Scripts\python.exe -m unittest backend.tests.test_zne_game -v
```

The CLI commands above do not submit IBM jobs. Teaching data are synthetic;
the circuit command checks the ideal circuit rather than noisy hardware.
Use the web lab for IBM runs, with the existing server-side IBM configuration.

The canonical API is `/api/zne/health`, `/api/zne/runs`,
`/api/zne/runs/{id}` and `/api/zne/runs/{id}/reveal`.
Historical `/api/health` and `/api/runs` routes still work and share the same
stored runs under `backend/data`. ZNE, DD and Pauli share the existing IBM service function in
`backend.ibm_adapter`; the shared adapter does not import ZNE.

This extraction preserves the existing circuit, folding factors, fitting
models and measurement behavior. It does not establish that ZNE improves real
hardware results, and no real IBM job is needed for the automated tests.

## Aer / IBM lab update

The web lab now offers exactly Aer and IBM execution. Aer uses real
AerSimulator density-matrix circuits with a specified two-qubit depolarizing
channel per CX (Low: 0.003; Moderate: 0.015), not an IBM calibration model.
Defaults: Moderate, 4,000 shots per factor, exponential fit. Linear remains
available for comparison. The graph supports signal zoom and approximate
two-standard-error sampling bands; these do not include model bias.

```cmd
.venv\Scripts\python.exe backend\zne_demo\main.py aer --model exponential --shots 4000
```

IBM uses the existing server configuration and QPU allocation. The base
circuit is transpiled once and folded in supported native gates at factors
1, 3, and 5. Saved runs and the legacy API routes remain readable.
No real IBM job was submitted to validate this update.

## Shared integration

Use the original `start_local.py` launcher. Configure IBM only in the local
`backend/.env` (`IBM_ENABLE`, `IBM_QUANTUM_TOKEN`, `IBM_BACKEND`, optional
`IBM_QUANTUM_INSTANCE`). ZNE reuses `backend.ibm_adapter.service()`; DD and
Pauli do not depend on the ZNE package. Shared `core.py` and `ibm_adapter.py`
are preserved from the downloaded version. ZNE styles are in `frontend/src/zne.css`.
ZNE tests are `backend.tests.test_zne_game` and `backend.tests.test_zne_precision`.
