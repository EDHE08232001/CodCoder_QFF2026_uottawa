"""Dynamical decoupling API: teaching game, sequence explorer and IBM hardware runs.

Physics lives in backend/dd_demo/src; this module only validates requests,
stores IBM job state and converts results to JSON. IBM execution is opt-in
(IBM_ENABLE=true) exactly like the ZNE experiment, and nothing touches the
network on import.
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

from .dd_demo.src import analysis, game

router = APIRouter(prefix='/api/dd', tags=['dynamical decoupling'])
RESULTS = Path(__file__).resolve().parent / 'dd_demo' / 'results'
DATA = Path(__file__).resolve().parent / 'data' / 'dd_runs'
LOCK = threading.RLock()
POOL = ThreadPoolExecutor(max_workers=1)
HardwareMode = Literal['none', 'runtime-XX', 'runtime-XpXm', 'runtime-XY4', 'manual-XX']
SequenceName = Literal['free', 'hahn', 'cpmg', 'udd', 'xy4']


class Pulse(BaseModel):
    position: float = Field(gt=0, lt=1, allow_inf_nan=False, description='Fraction of the idle window')
    axis: Literal['x', 'y'] = 'x'


class PlayRequest(BaseModel):
    level: Literal['echo', 'drift', 'wobble', 'fast']
    pulses: list[Pulse] = Field(default_factory=list, max_length=32)


class ExploreRequest(BaseModel):
    engine: Literal['theory', 'circuit'] = 'theory'
    noise: Literal['1/f', 'lorentzian', 'white', 'static'] = '1/f'
    sigma_khz: float = Field(default=15, ge=1, le=60, allow_inf_nan=False)
    pulses: int = Field(default=8, ge=1, le=32)
    max_time_us: float = Field(default=100, ge=10, le=200, allow_inf_nan=False)
    points: int = Field(default=20, ge=4, le=40)
    init: Literal['x', 'y'] = 'x'
    pulse_error: float = Field(default=0, ge=0, le=0.2, allow_inf_nan=False)
    sequences: list[SequenceName] = Field(default_factory=lambda: ['free', 'hahn', 'cpmg', 'udd', 'xy4'],
                                          min_length=1, max_length=5)
    seed: int = Field(default=7, ge=0, le=2**31-1)


class HardwareRequest(BaseModel):
    qubit: int = Field(default=0, ge=0, le=1000)
    init: Literal['x', 'y'] = 'y'
    points: int = Field(default=6, ge=2, le=12)
    max_delay_us: float = Field(default=100, ge=5, le=300, allow_inf_nan=False)
    shots: int = Field(default=1000, ge=100, le=10000)
    modes: list[HardwareMode] = Field(default_factory=lambda: ['none', 'runtime-XX', 'runtime-XY4'],
                                      min_length=1, max_length=5)


def ibm_enabled():
    return os.getenv('IBM_ENABLE', '').lower() == 'true'


@router.get('/levels')
def levels():
    return {'levels': game.describe_levels()}


@router.post('/play')
def play(request: PlayRequest):
    try:
        return game.play(request.level, [(p.position, p.axis) for p in request.pulses])
    except ValueError as error:
        raise HTTPException(422, str(error))


@router.post('/explore')
def explore(request: ExploreRequest):
    return game.explore(**request.model_dump(exclude={'sequences'}), sequences=tuple(request.sequences))


@router.get('/hardware')
def hardware_list():
    return {'datasets': analysis.list_hardware(RESULTS), 'ibm_enabled': ibm_enabled()}


@router.get('/hardware/{dataset_id}')
def hardware_dataset(dataset_id: str):
    try:
        return analysis.load_hardware(RESULTS, dataset_id)
    except (FileNotFoundError, ValueError, KeyError, TypeError, AttributeError):
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
    import numpy as np
    from . import ibm_adapter
    from .dd_demo.src import runner
    run = read_run(run_id)
    try:
        backend = ibm_adapter.service().backend(os.environ['IBM_BACKEND'])
        if run['qubit'] >= backend.num_qubits:
            raise ValueError(f"{backend.name} has no qubit {run['qubit']}")
        delays_s = np.linspace(run['max_delay_us']/run['points'], run['max_delay_us'], run['points']) * 1e-6
        delays_dt = runner.delays_in_dt(backend, delays_s)
        circuits = runner.build_isa_circuits(backend, run['qubit'], delays_dt, run['init'])
        jobs = {mode: runner.submit_sweep(backend, circuits, mode, run['shots']).job_id() for mode in run['modes']}
        run.update(status='queued', backend=backend.name, job_ids=jobs,
                   delays_us=[float(d * backend.dt * 1e6) for d in delays_dt])
    except Exception:
        logging.exception('IBM DD submission failed for %s', run_id)
        run.update(status='failed', error='IBM submission failed; check backend logs, credentials and qubit index.')
    save_run(run)


def collect_ibm(run):
    """Poll every job of a run; when all are done, save a hardware_*.json dataset."""
    from . import ibm_adapter
    from .dd_demo.src import runner
    svc = ibm_adapter.service()
    statuses = {mode: (job_id, str(svc.job(job_id).status()).upper()) for mode, job_id in run['job_ids'].items()}
    failed = [mode for mode, (_, status) in statuses.items() if status in ('ERROR', 'CANCELLED')]
    if failed:
        return {'status': 'failed', 'error': 'IBM job failed for mode(s): '+', '.join(failed)}
    if not all(status == 'DONE' for _, status in statuses.values()):
        waiting = any(status in ('QUEUED', 'INITIALIZING', 'VALIDATING') for _, status in statuses.values())
        return {'status': 'queued' if waiting else 'running'}
    counts = {mode: runner.counts_from_result(svc.job(job_id).result()) for mode, (job_id, _) in statuses.items()}
    if any(len(values) != len(run['delays_us']) for values in counts.values()):
        raise ValueError('IBM returned an unexpected number of circuit results')
    dataset_id = f"hardware_{run['backend']}_{time.strftime('%Y%m%d-%H%M%S')}"
    analysis.save_json(RESULTS / (dataset_id+'.json'), {
        'backend': run['backend'], 'qubit': run['qubit'], 'init': run['init'], 'delays_us': run['delays_us'],
        'p0': {mode: analysis.p0_curve(values) for mode, values in counts.items()}, 'counts': counts,
        'shots': run['shots'], 'job_ids': run['job_ids'], 'source': 'CODFISH web app'})
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
            raise HTTPException(409, 'An IBM DD experiment is already active')
        run = dict(id=str(uuid.uuid4()), **request.model_dump(), status='submitting', source='IBM QPU')
        run['modes'] = list(dict.fromkeys(run['modes']))
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
                logging.exception('IBM DD polling failed')
                run['poll_error'] = 'Could not refresh IBM jobs; try again.'
    return run
