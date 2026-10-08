#!/usr/bin/env bash
# Real-hardware example (macOS/Linux). Needs IBM_QUANTUM_TOKEN in .env. Windows: run.ps1
cd "$(dirname "$0")"
python3 main.py hardware --qubits 4 --mode tensored --shots 2000
