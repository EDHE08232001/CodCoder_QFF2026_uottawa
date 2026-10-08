"""Readout mitigation API: teaching levels, sandbox and IBM hardware runs.

Physics lives in backend/trex_demo/src; this module only validates requests,
stores IBM job state and converts results to JSON. IBM execution is opt-in
(IBM_ENABLE=true) exactly like the ZNE, DD and twirling experiments, and
nothing touches the network on import. Unlike those two, the simulated
levels need no Aer noise model (readout error is sampled directly in NumPy;
see trex_demo/src/noise.py), so there is no Aer-availability gate here.
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

from .trex_demo.src import analysis, game, runner

router = APIRouter(prefix='/api/trex', tags=['readout mitigation'])
RESULTS = Path(__file__).resolve().parent / 'trex_demo' / 'results'
DATA = Path(__file__).resolve().parent / 'data' / 'trex_runs'
LOCK = threading.RLock()
POOL = ThreadPoolExecutor(max_workers=1)
LevelName = Literal['bias', 'crowd', 'crosstalk', 'ghz']
CalibrationMode = Literal['tensored', 'correlated']


class PlayRequest(BaseModel):
    level: LevelName
    calibration_mode: CalibrationMode = 'tensored'


class ExploreRequest(BaseModel):
    qubits: int = Field(default=3, ge=1, le=game.MAX_SANDBOX_QUBITS)
    per_qubit_errors: list[tuple[float, float]] | None = Field(default=None, max_length=game.MAX_SANDBOX_QUBITS)
    crosstalk_pairs: list[tuple[int, int, float]] = Field(default_factory=list, max_length=10)
    target_kind: Literal['bias', 'ghz'] = 'ghz'
    target_bias: float = Field(default=0.5, ge=0, le=1)
    calibration_mode: CalibrationMode = 'tensored'
    shots: int = Field(default=4096, ge=256, le=20000)
    seed: int = Field(default=7, ge=0, le=2 ** 31 - 1)


class HardwareRequest(BaseModel):
    qubits: int = Field(default=4, ge=1, le=runner.MAX_CORRELATED_QUBITS)
    calibration_mode: CalibrationMode = 'tensored'
    shots: int = Field(default=2000, ge=100, le=10000)
    seed: int = Field(default=7, ge=0, le=2 ** 31 - 1)


def ibm_enabled():
    return os.getenv('IBM_ENABLE', '').lower() == 'true'


@router.get('/levels')
def levels():
    return {'levels': game.describe_levels(), 'ibm_enabled': ibm_enabled()}


@router.post('/play')
def play(request: PlayRequest):
    try:
        return game.play(request.level, calibration_mode=request.calibration_mode)
    except ValueError as error:
        raise HTTPException(422, str(error))


@router.post('/explore')
def explore(request: ExploreRequest):
    try:
        return game.explore(**request.model_dump())
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
    return DATA / (canonical + '.json')


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
    run = read_run(run_id)
    try:
        backend = ibm_adapter.service().backend(os.environ['IBM_BACKEND'])
        if run['qubits'] > backend.num_qubits:
            raise ValueError(f"{backend.name} has fewer than {run['qubits']} qubits")
        built = runner.build_circuits(backend, run['qubits'], run['calibration_mode'], run['seed'])
        job = runner.submit(backend, built['calibration'], built['target'], run['shots'])
        run.update(status='queued', backend=backend.name, job_id=job.job_id(), layout=built['layout'],
                   calibration_circuits_used=built['calibration_circuits_used'])
    except Exception:
        logging.exception('IBM readout-mitigation submission failed for %s', run_id)
        run.update(status='failed', error='IBM submission failed; check backend logs, '
                                          'credentials and the qubit count.')
    save_run(run)


def collect_ibm(run):
    """Poll the job; when it finishes, save a trex_*.json dataset."""
    from . import ibm_adapter
    job = ibm_adapter.service().job(run['job_id'])
    status = str(job.status()).upper()
    if status in ('ERROR', 'CANCELLED'):
        return {'status': 'failed', 'error': 'IBM job ' + status}
    if status != 'DONE':
        return {'status': 'queued' if status in ('QUEUED', 'INITIALIZING', 'VALIDATING') else 'running'}
    counts = runner.counts_from_result(job.result())
    expected = run['calibration_circuits_used'] + 1
    if len(counts) != expected:
        raise ValueError('IBM returned an unexpected number of circuit results')
    calibration_counts, target_counts = counts[:-1], counts[-1]
    dataset_id = f"trex_{run['backend']}_{time.strftime('%Y%m%d-%H%M%S')}"
    dataset = analysis.build_dataset(run['backend'], run['qubits'], run['calibration_mode'], run['shots'],
                                     run['seed'], run['job_id'], run['layout'], calibration_counts, target_counts)
    analysis.save_json(RESULTS / (dataset_id + '.json'), dataset)
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
            raise HTTPException(409, 'An IBM readout-mitigation experiment is already active')
        run = dict(id=str(uuid.uuid4()), **request.model_dump(), status='submitting', source='IBM QPU')
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
                logging.exception('IBM readout-mitigation polling failed')
                run['poll_error'] = 'Could not refresh the IBM job; try again.'
    return run
