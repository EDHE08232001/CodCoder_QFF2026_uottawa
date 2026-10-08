"""Cross-platform launcher (macOS, Windows, Linux): starts the API and the web UI.

    python start_local.py                 # pick free ports near 8000 / 5173
    python start_local.py --open          # also open the browser
    python start_local.py --backend-port 8001 --frontend-port 5174

Run it with the Python that has backend/requirements.txt installed (for example
.venv/bin/python on macOS/Linux or .venv\\Scripts\\python.exe on Windows).
Press Ctrl+C to stop both processes. Logs are written to .local/.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / 'frontend'
VITE = FRONTEND / 'node_modules' / 'vite' / 'bin' / 'vite.js'
LOGS = ROOT / '.local'


def port_is_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as client:
        client.settimeout(0.3)
        if client.connect_ex(('127.0.0.1', port)) == 0:
            return False  # something is listening (also catches 0.0.0.0 listeners on macOS)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        if os.name != 'nt':
            # uvicorn and Vite bind with SO_REUSEADDR, so a port left in TIME_WAIT is usable.
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(('127.0.0.1', port))
        except OSError:
            return False
    return True


def select_port(requested: int, first: int, taken: set[int]) -> int:
    if requested:
        if not 1024 <= requested <= 65535 or requested in taken or not port_is_free(requested):
            sys.exit(f'Requested port {requested} is unavailable. No existing process was stopped.')
        return requested
    for candidate in range(first, first + 100):
        if candidate not in taken and port_is_free(candidate):
            return candidate
    sys.exit(f'No available port found near {first}.')


def fetch(url: str):
    with urllib.request.urlopen(url, timeout=1) as response:
        return response.status, response.read()


def check_prerequisites() -> str:
    try:
        import fastapi, numpy, qiskit, uvicorn  # noqa: F401,E401
    except ImportError as error:
        sys.exit(f'Python dependency missing ({error.name}). Run: {Path(sys.executable).name} -m pip install -r backend/requirements.txt')
    node = shutil.which('node')
    if not node:
        sys.exit('Node.js was not found on PATH. Install Node.js 22.12+ from https://nodejs.org/')
    if not VITE.exists():
        sys.exit('Frontend dependencies are missing. Run: npm --prefix frontend ci   (Windows PowerShell: npm.cmd --prefix frontend ci)')
    return node


def stop(processes):
    for process in processes:
        if process.poll() is None:
            process.terminate()
    for process in processes:
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


def _interrupt(signum, frame):
    raise KeyboardInterrupt


def main() -> int:
    # Ctrl+C, Ctrl+Break (Windows) and SIGTERM all stop both child servers.
    signal.signal(signal.SIGINT, signal.default_int_handler)
    signal.signal(signal.SIGTERM, _interrupt)
    if hasattr(signal, 'SIGBREAK'):
        signal.signal(signal.SIGBREAK, _interrupt)
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--backend-port', type=int, default=0)
    parser.add_argument('--frontend-port', type=int, default=0)
    parser.add_argument('--open', action='store_true', help='open the app in your browser when ready')
    parser.add_argument('--timeout', type=float, default=60, help='seconds to wait for both servers')
    args = parser.parse_args()

    node = check_prerequisites()
    backend_port = select_port(args.backend_port, 8000, set())
    frontend_port = select_port(args.frontend_port, 5173, {backend_port})
    print(f'Selected ports: backend={backend_port}; frontend={frontend_port}')
    LOGS.mkdir(exist_ok=True)
    env = dict(os.environ, ZNE_BACKEND_PORT=str(backend_port), ZNE_FRONTEND_PORT=str(frontend_port),
               PYTHONUTF8='1')
    backend_log = open(LOGS / 'backend.log', 'w', encoding='utf-8')
    frontend_log = open(LOGS / 'frontend.log', 'w', encoding='utf-8')
    processes = [
        subprocess.Popen([sys.executable, '-X', 'utf8', str(ROOT / 'start_backend.py')], cwd=ROOT, env=env,
                         stdout=backend_log, stderr=subprocess.STDOUT),
        subprocess.Popen([node, str(VITE), '--host', '127.0.0.1', '--port', str(frontend_port), '--strictPort'],
                         cwd=FRONTEND, env=env, stdout=frontend_log, stderr=subprocess.STDOUT),
    ]
    backend_url, frontend_url = f'http://127.0.0.1:{backend_port}', f'http://127.0.0.1:{frontend_port}'
    try:
        deadline = time.monotonic() + args.timeout
        ready = False
        while time.monotonic() < deadline and all(p.poll() is None for p in processes):
            try:
                backend_ok = json.loads(fetch(backend_url + '/api/health')[1]).get('ok') is True
                frontend_ok = fetch(frontend_url + '/')[0] == 200
                ready = backend_ok and frontend_ok
            except (OSError, ValueError):
                ready = False
            if ready:
                break
            time.sleep(0.5)
        print(f'Backend PID: {processes[0].pid}; Frontend PID: {processes[1].pid}')
        if not ready:
            print(f'Startup check failed. Read the logs in {LOGS}')
            for name in ('backend.log', 'frontend.log'):
                lines = (LOGS / name).read_text(encoding='utf-8', errors='replace').splitlines()[-12:]
                if lines:
                    print(f'--- {name}\n' + '\n'.join(lines))
            return 1
        print(f'Ready: {frontend_url}/')
        print(f'API docs: {backend_url}/docs')
        print('Press Ctrl+C to stop both servers.')
        if args.open:
            webbrowser.open(frontend_url + '/')
        while all(p.poll() is None for p in processes):
            time.sleep(0.5)
        print(f'A server exited unexpectedly. Read the logs in {LOGS}')
        return 1
    except KeyboardInterrupt:
        print('\nStopping…')
        return 0
    finally:
        stop(processes)
        backend_log.close()
        frontend_log.close()


if __name__ == '__main__':
    sys.exit(main())
