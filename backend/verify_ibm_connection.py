"""Standalone check for the PINQ2/IBM Quantum credentials in backend/.env.

Usage (from the repo root, with the project venv active):
    python backend/verify_ibm_connection.py

Lists the backends your token can see. Pick one and paste its name into
IBM_BACKEND in backend/.env before running the game against real hardware.
Does not touch IBM_ENABLE or IBM_BACKEND; only needs the token (and, if the
organizers gave you one, the instance CRN).
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / '.env')

token = os.getenv('IBM_QUANTUM_TOKEN')
instance = os.getenv('IBM_QUANTUM_INSTANCE') or None

if not token or token == 'PASTE_PINQ2_TOKEN_HERE':
    sys.exit('Set IBM_QUANTUM_TOKEN in backend/.env to the PINQ2 token first.')

from qiskit_ibm_runtime import QiskitRuntimeService

service = QiskitRuntimeService(channel='ibm_quantum_platform', token=token, instance=instance)
backends = service.backends()

if not backends:
    sys.exit('Connected, but no backends were visible. Ask an organizer about your instance/allocation.')

print(f'Connected. {len(backends)} backend(s) visible:')
for backend in backends:
    print(f'  - {backend.name}')
print('\nPaste one of these names into IBM_BACKEND in backend/.env, then set IBM_ENABLE=true.')
