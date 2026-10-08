#!/usr/bin/env bash
# macOS / Linux launcher (works from zsh or bash): ./start-local.sh [--open]
# Uses .venv if present, otherwise python3 on PATH. Ctrl+C stops both servers.
set -euo pipefail
cd "$(dirname "$0")"
if [ -x .venv/bin/python ]; then
  PYTHON=.venv/bin/python
elif command -v python3 >/dev/null 2>&1; then
  PYTHON=python3
else
  echo "Python 3.12+ not found. Install it from https://www.python.org/ or with Homebrew (brew install python)." >&2
  exit 1
fi
exec "$PYTHON" start_local.py "$@"
