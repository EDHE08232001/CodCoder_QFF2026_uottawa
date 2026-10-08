import json
import logging
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .zne_demo.src.analysis import fit
from .zne_demo.src.simulator import simulate
from .zne_demo.src import hardware as ibm_adapter

router = APIRouter(tags=['zero-noise extrapolation'])
DATA = Path(__file__).resolve().parent / 'data'
LOCK = threading.RLock()
POOL = ThreadPoolExecutor(max_workers=1)

class RunRequest(BaseModel):
    mode: Literal['aer','ibm'] = 'aer'
    level: Literal['linear','exponential'] = 'exponential'
    shots: int = Field(default=4000, ge=100, le=10000)
    seed: int = Field(default=42, ge=0, le=2**32-1)

class Guess(BaseModel):
    model: Literal['linear','exponential']
    guess: float = Field(ge=-1, le=1, allow_inf_nan=False)

def path_for(run_id):
    try:
        canonical = str(uuid.UUID(run_id))
    except ValueError:
        raise HTTPException(404, 'Run not found')
    return DATA / (canonical+'.json')

def save(run):
    with LOCK:
        DATA.mkdir(parents=True, exist_ok=True)
        path = path_for(run['id'])
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(run, allow_nan=False), encoding='utf-8')
        temporary.replace(path)

def read(run_id):
    with LOCK:
        path = path_for(run_id)
        if not path.exists():
            raise HTTPException(404, 'Run not found')
        return json.loads(path.read_text(encoding='utf-8'))

def public(run):
    return {key:value for key,value in run.items() if key != 'reference'}

def submit_ibm(run_id):
    run = read(run_id)
    try:
        details = ibm_adapter.submit(run['shots'])
        run.update(details, status='queued')
    except Exception:
        logging.exception('IBM submission failed for %s', run_id)
        run.update(status='failed', error='IBM submission failed; check backend logs and credentials.')
    save(run)

@router.get('/health')
def health():
    return {'ok':True, 'ibm_enabled':os.getenv('IBM_ENABLE','').lower()=='true'}

@router.post('/runs', status_code=202)
def create_run(request: RunRequest):
    if request.mode == 'ibm':
        if os.getenv('IBM_ENABLE','').lower() != 'true':
            raise HTTPException(403, 'IBM execution is disabled on this server')
        if not all(os.getenv(name) for name in ('IBM_QUANTUM_TOKEN','IBM_BACKEND')):
            raise HTTPException(503, 'IBM server configuration is incomplete')
        with LOCK:
            active = [json.loads(p.read_text(encoding='utf-8')) for p in DATA.glob('*.json')]
            if any(r.get('mode')=='ibm' and r.get('status') not in ('completed','failed') for r in active):
                raise HTTPException(409, 'An IBM experiment is already active')
            run = dict(id=str(uuid.uuid4()), **request.model_dump(), status='submitting', source='IBM QPU')
            save(run)
        POOL.submit(submit_ibm, run['id'])
    else:
        run = dict(id=str(uuid.uuid4()), **request.model_dump(), status='completed',
            **simulate(request.level, request.shots, request.seed))
        save(run)
    return public(run)

@router.get('/runs/active')
def active_run():
    # Return the existing job so a refreshed page can resume polling.
    # A completed remote job is returned once, with its refreshed measurements.
    with LOCK:
        candidates = [json.loads(p.read_text(encoding='utf-8')) for p in DATA.glob('*.json')]
        active = next((r for r in candidates if r.get('mode')=='ibm'
                       and r.get('status') not in ('completed','failed')), None)
    return get_run(active['id']) if active else None

@router.get('/runs/{run_id}')
def get_run(run_id: str):
    with LOCK:
        run = read(run_id)
        if run['mode']=='ibm' and run['status'] in ('queued','running'):
            try:
                run.update(ibm_adapter.poll(run['job_id']))
                run.pop('poll_error', None)
                save(run)
            except Exception:
                logging.exception('IBM polling failed')
                run['poll_error'] = 'Could not refresh IBM job; try again.'
    return public(run)

@router.post('/runs/{run_id}/reveal')
def reveal(run_id: str, request: Guess):
    run = read(run_id)
    if run['status'] != 'completed':
        raise HTTPException(409, 'Measurements are not complete')
    try:
        fitted = fit(run['points'], request.model)
    except (ValueError, RuntimeError):
        raise HTTPException(422, 'Model fitting failed; try another model or experiment')
    ref = run['reference']
    return dict(**fitted, reference=ref, guess=request.guess,
        player_error=abs(request.guess-ref), fitted_error=abs(fitted['estimate']-ref),
        raw_error=abs(run['points'][0]['mean']-ref))

