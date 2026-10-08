param(
    [int]$BackendPort = 0,
    [int]$FrontendPort = 0
)
$ErrorActionPreference = 'Stop'

function Test-FreePort([int]$portNumber) {
    $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $portNumber)
    try { $probe.Start(); return $true } catch { return $false } finally { $probe.Stop() }
}

function Select-FreePort([int]$requested, [int]$first) {
    if ($requested -ne 0) {
        if ($requested -lt 1024 -or $requested -gt 65535 -or -not (Test-FreePort $requested)) {
            throw "Requested port $requested is unavailable. No existing process was stopped."
        }
        return $requested
    }
    foreach ($candidate in $first..($first+99)) {
        if (Test-FreePort $candidate) { return $candidate }
    }
    throw "No available port found near $first."
}
$projectRoot = $PSScriptRoot
$backendScript = Join-Path $projectRoot 'start_backend.py'
$frontendRoot = Join-Path $projectRoot 'frontend'
$viteScript = Join-Path $frontendRoot 'node_modules/vite/bin/vite.js'
$logRoot = Join-Path $projectRoot '.local'
$venvPython = Join-Path $projectRoot '.venv/Scripts/python.exe'
$venvPythonPosix = Join-Path $projectRoot '.venv/bin/python'   # PowerShell 7 on macOS/Linux
$runtimePython = if ($env:USERPROFILE) { Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' } else { $null }
if (Test-Path -LiteralPath $venvPython) {
    $pythonExecutable = $venvPython
} elseif (Test-Path -LiteralPath $venvPythonPosix) {
    $pythonExecutable = $venvPythonPosix
} elseif ($runtimePython -and (Test-Path -LiteralPath $runtimePython)) {
    $pythonExecutable = $runtimePython
} else {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCommand) { $pythonCommand = Get-Command python3 -ErrorAction Stop }
    $pythonExecutable = $pythonCommand.Source
}
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath $viteScript)) {
    throw 'Frontend dependencies are missing. Run npm install in frontend first.'
}
$BackendPort = Select-FreePort $BackendPort 8000
$FrontendPort = Select-FreePort $FrontendPort 5173
if ($BackendPort -eq $FrontendPort) { throw 'Backend and frontend ports must differ.' }
$backendUrl = "http://127.0.0.1:$BackendPort"
$frontendUrl = "http://127.0.0.1:$FrontendPort"
Write-Host "Selected ports: backend=$BackendPort; frontend=$FrontendPort"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$previousBackendPort = $env:ZNE_BACKEND_PORT
$previousFrontendPort = $env:ZNE_FRONTEND_PORT
try {
    $env:ZNE_BACKEND_PORT = [string]$BackendPort
    $env:ZNE_FRONTEND_PORT = [string]$FrontendPort
    $backend = Start-Process -FilePath $pythonExecutable -ArgumentList @('-X','utf8',('"'+$backendScript+'"')) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot 'backend.log') -RedirectStandardError (Join-Path $logRoot 'backend-error.log')
    $frontend = Start-Process -FilePath $nodeExecutable -ArgumentList @(('"'+$viteScript+'"'),'--host','127.0.0.1','--port',([string]$FrontendPort)) -WorkingDirectory $frontendRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot 'frontend.log') -RedirectStandardError (Join-Path $logRoot 'frontend-error.log')
} finally {
    $env:ZNE_BACKEND_PORT = $previousBackendPort
    $env:ZNE_FRONTEND_PORT = $previousFrontendPort
}
$backendReady = $false
$frontendReady = $false
for ($attempt=0; $attempt -lt 20; $attempt++) {
    if ($backend.HasExited -or $frontend.HasExited) { break }
    try { $health = Invoke-RestMethod -Uri "$backendUrl/api/health" -TimeoutSec 1; $backendReady = $health.ok -eq $true } catch {}
    try { $response = Invoke-WebRequest -Uri "$frontendUrl/" -TimeoutSec 1 -UseBasicParsing; $frontendReady = $response.StatusCode -eq 200 } catch {}
    if ($backendReady -and $frontendReady) { break }
    Start-Sleep -Milliseconds 500
}
Write-Host "Backend PID: $($backend.Id); Frontend PID: $($frontend.Id)"
if ($backendReady -and $frontendReady) {
    Write-Host "Ready: $frontendUrl/"
    Write-Host "API docs: $backendUrl/docs"
} else {
    Write-Host "Startup check failed. Read logs in $logRoot"
    if (Test-Path (Join-Path $logRoot 'backend-error.log')) { Get-Content (Join-Path $logRoot 'backend-error.log') -Tail 12 }
    if (Test-Path (Join-Path $logRoot 'frontend-error.log')) { Get-Content (Join-Path $logRoot 'frontend-error.log') -Tail 12 }
    exit 1
}
Write-Host "To stop only these processes: Stop-Process -Id $($backend.Id),$($frontend.Id)"
