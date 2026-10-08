# Real-hardware example (Windows PowerShell). Needs IBM_QUANTUM_TOKEN in .env. macOS/Linux: run.sh
Set-Location -LiteralPath $PSScriptRoot
python main.py hardware --qubits 4 --mode tensored --shots 2000
