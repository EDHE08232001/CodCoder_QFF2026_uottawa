"""Application setup; experiment implementations live in their own routers."""
import os
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / '.env')
load_dotenv(BACKEND_DIR.parent / '.env')

from .dd_api import router as dd_router
from .twirl_api import router as twirl_router
from .zne_api import router as zne_router
from .trex_api import router as trex_router

app = FastAPI(title='CODFISH Quantum Reef')
frontend_port = int(os.getenv('ZNE_FRONTEND_PORT', '5173'))
app.add_middleware(CORSMiddleware,
    allow_origins=[f'http://localhost:{frontend_port}', f'http://127.0.0.1:{frontend_port}'],
    allow_methods=['GET', 'POST'], allow_headers=['Content-Type'])
app.include_router(dd_router)
app.include_router(twirl_router)
app.include_router(zne_router, prefix='/api/zne')
# Preserve the existing health check, run links and saved-run location.
app.include_router(zne_router, prefix='/api', include_in_schema=False)
app.include_router(trex_router)
