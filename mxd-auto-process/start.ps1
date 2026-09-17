$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend-auto-process'
$frontend = Join-Path $root 'frontend-auto-process'
$backendPort = 26909
$frontendPort = 6909

function Stop-PortOwner([int]$port) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    Where-Object { $_ -and $_ -ne $PID } |
    ForEach-Object {
      Write-Host "Stopping process $($_) using port $port ..." -ForegroundColor Yellow
      Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
    }
}

Stop-PortOwner $backendPort
Stop-PortOwner $frontendPort

if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
  throw 'Go is not installed or is not available on PATH.'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw 'Node.js/npm is required to build and serve the separated frontend.'
}

if (-not (Test-Path (Join-Path $frontend 'node_modules'))) {
  Write-Host 'Installing frontend dependencies ...' -ForegroundColor Cyan
  Push-Location $frontend
  try {
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }
  }
  finally { Pop-Location }
}

Write-Host 'Building frontend assets for the Go embedded handler ...' -ForegroundColor Cyan
Push-Location $frontend
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE" }
}
finally { Pop-Location }

$backendProcess = $null
try {
  Write-Host "Starting backend on http://127.0.0.1:$backendPort ..." -ForegroundColor Cyan
  $backendProcess = Start-Process -WorkingDirectory $backend -FilePath 'go' -ArgumentList @(
    'run', './cmd/mxd-auto-process',
    '--config', './config/servers.json',
    '--listen', "127.0.0.1:$backendPort"
  ) -PassThru

  Write-Host "Starting frontend on http://127.0.0.1:$frontendPort ..." -ForegroundColor Green
  Set-Location $frontend
  npm run dev -- --host 127.0.0.1
}
finally {
  if ($backendProcess -and -not $backendProcess.HasExited) {
    Write-Host 'Stopping backend ...' -ForegroundColor Yellow
    Stop-Process -Id $backendProcess.Id -Force -ErrorAction SilentlyContinue
  }
  Stop-PortOwner $backendPort
  Stop-PortOwner $frontendPort
}
