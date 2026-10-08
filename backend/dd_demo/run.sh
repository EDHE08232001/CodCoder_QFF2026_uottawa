#!/usr/bin/env bash
# Real-hardware example (macOS/Linux). Needs IBM_QUANTUM_TOKEN in .env. Windows: run.ps1
cd "$(dirname "$0")"
python3 main.py hardware --backend ibm_quebec --qubit 5 --init y --points 8 --max-delay-us 200 --shots 2000 --modes none,runtime-XX,runtime-XY4,manual-XX
