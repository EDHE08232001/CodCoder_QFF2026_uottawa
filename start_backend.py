"""Local launcher; also supports the task-local dependencies installed by Codex."""
import sys
import os
from pathlib import Path
ROOT = Path(__file__).resolve().parent
TASK_DEPS = ROOT.parent.parent / 'work' / 'pydeps'
if TASK_DEPS.exists():
    sys.path.insert(0, str(TASK_DEPS))
sys.path.insert(0, str(ROOT))
import uvicorn
if __name__ == '__main__':
    uvicorn.run('backend.app:app', host='127.0.0.1', port=int(os.getenv('ZNE_BACKEND_PORT', '8000')))
