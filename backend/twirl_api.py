"""Pauli twirling API: circuit preview, Aer scenarios and IBM hardware runs.

Physics lives in backend/twirl_demo/src; this module only validates requests,
stores IBM job state and converts results to JSON. IBM execution is opt-in
(IBM_ENABLE=true) exactly like the ZNE and DD experiments, and nothing touches
the network on import.
"""
import json
import logging
import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .twirl_demo.src import analysis, game, noise, problems
from .twirl_demo.src.problems import (WITNESS_RANDOMIZATIONS, WITNESS_SHOTS,
                                      witness_describe, witness_ideal)

router = APIRouter(prefix='/api/twirl', tags=['pauli twirling'])
RESULTS = Path(__file__).resolve().parent / 'twirl_demo' / 'results'
DATA = Path(__file__).resolve().parent / 'data' / 'twirl_runs'
LOCK = threading.RLock()
POOL = ThreadPoolExecutor(max_workers=1)
ScenarioName = Literal['coherent', 'stochastic', 'mixed', 'clean']


class CircuitRequest(BaseModel):
    qubits: int = Field(default=4, ge=problems.MIN_QUBITS, le=problems.MAX_QUBITS)
    steps: int = Field(default=4, ge=1, le=problems.MAX_STEPS)
    field: float = Field(default=0.6, ge=0, le=2, allow_inf_nan=False)
    seed: int = Field(default=7, ge=0, le=2**31-1)


class PlayRequest(CircuitRequest):
    scenario: ScenarioName = 'coherent'
    randomizations: int = Field(default=16, ge=1, le=64)
    shots: int = Field(default=512, ge=32, le=4096)
    # Left unset, each scenario supplies its own noise; the lab can override both knobs.
    coherent_angle: float | None = Field(default=None, ge=0, le=0.2, allow_inf_nan=False)
    depolarizing: float | None = Field(default=None, ge=0, le=0.1, allow_inf_nan=False)


class HardwareRequest(BaseModel):
    """IBM web submissions ignore quench knobs and always send the coherent-witness preset."""
    randomizations: int = Field(default=WITNESS_RANDOMIZATIONS, ge=1, le=32)
    shots: int = Field(default=WITNESS_SHOTS, ge=32, le=4096)
    seed: int = Field(default=7, ge=0, le=2**31-1)


def ibm_enabled():
    return os.getenv('IBM_ENABLE', '').lower() == 'true'


@router.get('/scenarios')
def scenarios():
    return dict(game.describe_scenarios(), ibm_enabled=ibm_enabled())


@router.post('/circuit')
def circuit(request: CircuitRequest):
    try:
        return game.circuit_preview(**request.model_dump())
    except ValueError as error:
        raise HTTPException(422, str(error))


@router.post('/play')
def play(request: PlayRequest):
    if not noise.aer_available():
        raise HTTPException(503, noise.AER_HINT)
    try:
        return game.play(request.scenario, **request.model_dump(exclude={'scenario'}))
    except ValueError as error:
        raise HTTPException(422, str(error))


@router.get('/hardware')
def hardware_list():
    return {'datasets': analysis.list_datasets(RESULTS), 'ibm_enabled': ibm_enabled()}


@router.get('/hardware/{dataset_id}')
def hardware_dataset(dataset_id: str):
    try:
        return analysis.load_dataset(RESULTS, dataset_id)
    except (FileNotFoundError, OSError, ValueError, KeyError, TypeError, AttributeError):
        raise HTTPException(404, 'Dataset not found')


# ---------------------------------------------------------------- IBM runs

def run_path(run_id):
    try:
        canonical = str(uuid.UUID(run_id))
    except ValueError:
        raise HTTPException(404, 'Run not found')
    return DATA / (canonical+'.json')


def save_run(run):
    with LOCK:
        DATA.mkdir(parents=True, exist_ok=True)
        path = run_path(run['id'])
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(run, allow_nan=False), encoding='utf-8')
        temporary.replace(path)


def read_run(run_id):
    with LOCK:
        path = run_path(run_id)
        if not path.exists():
            raise HTTPException(404, 'Run not found')
        return json.loads(path.read_text(encoding='utf-8'))


def submit_ibm(run_id):
    from . import ibm_adapter
    from .twirl_demo.src import hardware
    run = read_run(run_id)
    try:
        backend = ibm_adapter.service().backend(os.environ['IBM_BACKEND'])
        built = hardware.build_circuits(backend, run['qubits'], run['steps'], run['field'],
                                        run['randomizations'], run['seed'],
                                        experiment=run.get('experiment', 'witness'))
        # The unmitigated side repeats the bare circuit so both treatments spend the same shots.
        circuits = [built['bare']] * run['randomizations'] + built['twirled']
        job = hardware.submit(backend, circuits, run['shots'])
        run.update(status='queued', backend=backend.name, job_id=job.job_id(),
                   layout=built['layout'], two_qubit_gates=built['two_qubit_gates'],
                   frames_per_circuit=built['frames_per_circuit'],
                   experiment=built.get('experiment', 'witness'),
                   inject_z=built.get('inject_z', 0.0))
    except Exception:
        logging.exception('IBM twirling submission failed for %s', run_id)
        run.update(status='failed', error='IBM submission failed; check backend logs, '
                                          'credentials and the qubit count.')
    save_run(run)


def collect_ibm(run):
    """Poll the job; when it finishes, save a twirl_*.json dataset and summarise it."""
    from . import ibm_adapter
    from .twirl_demo.src import hardware
    job = ibm_adapter.service().job(run['job_id'])
    status = str(job.status()).upper()
    if status in ('ERROR', 'CANCELLED'):
        return {'status': 'failed', 'error': 'IBM job '+status}
    if status != 'DONE':
        return {'status': 'queued' if status in ('QUEUED', 'INITIALIZING', 'VALIDATING') else 'running'}
    counts = hardware.counts_from_result(job.result())
    half = run['randomizations']
    if len(counts) != 2 * half:
        raise ValueError('IBM returned an unexpected number of circuit results')
    if run.get('experiment') == 'witness':
        reference = witness_ideal()
        header = witness_describe()
        exact = dict(magnetization=1.0, per_qubit=[1.0, 1.0])
        scenario_label = f"IBM {run['backend']} coherent witness"
    else:
        reference = problems.ideal(run['qubits'], run['steps'], run['field'])
        header = problems.describe(run['qubits'], run['steps'], run['field'])
        exact = problems.exact(run['qubits'], run['steps'], run['field'])
        scenario_label = f"IBM {run['backend']}"
    unmitigated = analysis.summarize(counts[:half], run['qubits'], reference)
    twirled = analysis.summarize(counts[half:], run['qubits'], reference)
    dataset_id = f"twirl_{run['backend']}_{time.strftime('%Y%m%d-%H%M%S')}"
    analysis.save_json(RESULTS / (dataset_id+'.json'), dict(
        header,
        backend=run['backend'], scenario='hardware', scenario_label=scenario_label,
        randomizations=half, shots=run['shots'], total_shots=half * run['shots'],
        seed=run['seed'], layout=run['layout'], job_id=run['job_id'],
        two_qubit_gates=run['two_qubit_gates'], frames_per_circuit=run['frames_per_circuit'],
        experiment=run.get('experiment', 'quench'), inject_z=run.get('inject_z', 0.0),
        ideal=reference, exact=exact,
        unmitigated=unmitigated, twirled=twirled,
        comparison=analysis.compare(unmitigated, twirled),
        counts={'unmitigated': counts[:half], 'twirled': counts[half:]},
        source='CODFISH web app'))
    return {'status': 'completed', 'dataset_id': dataset_id}


@router.post('/hardware/runs', status_code=202)
def create_hardware_run(request: HardwareRequest):
    if not ibm_enabled():
        raise HTTPException(403, 'IBM execution is disabled on this server')
    if not all(os.getenv(name) for name in ('IBM_QUANTUM_TOKEN', 'IBM_BACKEND')):
        raise HTTPException(503, 'IBM server configuration is incomplete')
    with LOCK:
        active = [json.loads(p.read_text(encoding='utf-8')) for p in DATA.glob('*.json')]
        if any(r.get('status') not in ('completed', 'failed') for r in active):
            raise HTTPException(409, 'An IBM twirling experiment is already active')
        preset = witness_describe()
        run = dict(id=str(uuid.uuid4()), experiment='witness',
                   qubits=preset['qubits'], steps=preset['pairs'], field=0.0,
                   randomizations=request.randomizations, shots=request.shots, seed=request.seed,
                   inject_z=preset['coherent_angle'], status='submitting', source='IBM QPU')
        save_run(run)
    POOL.submit(submit_ibm, run['id'])
    return run


@router.get('/hardware/runs/{run_id}')
def get_hardware_run(run_id: str):
    with LOCK:
        run = read_run(run_id)
        if run['status'] in ('queued', 'running'):
            try:
                run.update(collect_ibm(run))
                run.pop('poll_error', None)
                save_run(run)
            except Exception:
                logging.exception('IBM twirling polling failed')
                run['poll_error'] = 'Could not refresh the IBM job; try again.'
    return run
