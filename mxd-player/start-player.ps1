$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend-player'
$frontend = Join-Path $root 'frontend-player'
$env:PLAYER_DATABASE_PATH = Join-Path $root '..\data\player-player.sqlite'
$env:PLAYER_CHAR_DATA_DIR = Join-Path $root 'backend-player\data\char-user-qq'
$env:PLAYER_CORS_ORIGIN = 'http://127.0.0.1:6173'
Get-NetTCPConnection -LocalPort 26906 -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
  $playerProcessId = $_.OwningProcess
  if ($playerProcessId -and $playerProcessId -ne $PID) {
    Write-Host "Stopping previous mxd-player backend (PID $playerProcessId) ..." -ForegroundColor Yellow
    Stop-Process -Id $playerProcessId -Force -ErrorAction SilentlyContinue
  }
}
Write-Host 'Starting backend on http://127.0.0.1:26906 ...' -ForegroundColor Cyan
Start-Process -WorkingDirectory $backend -FilePath 'go' -ArgumentList 'run .' -WindowStyle Normal
Write-Host 'Starting frontend on http://127.0.0.1:6173 ...' -ForegroundColor Green
Set-Location $frontend
npm run dev -- --host 127.0.0.1
