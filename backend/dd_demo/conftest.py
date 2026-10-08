"""Lets plain `pytest` (run from this folder or the repo root) import `src`."""
import sys
from pathlib import Path

ROOT = str(Path(__file__).resolve().parent)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
