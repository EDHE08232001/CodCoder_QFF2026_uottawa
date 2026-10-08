# Real-hardware example (Windows PowerShell). Needs IBM_QUANTUM_TOKEN in .env. macOS/Linux: run.sh
Set-Location -LiteralPath $PSScriptRoot
python main.py hardware --backend ibm_quebec --qubit 5 --init y --points 8 --max-delay-us 200 --shots 2000 --modes none,runtime-XX,runtime-XY4,manual-XX
