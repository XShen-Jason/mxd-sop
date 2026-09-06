$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend-player'
$frontend = Join-Path $root 'frontend-player'
$playerEnvFile = Join-Path $backend '.env'

if (-not (Test-Path -LiteralPath $playerEnvFile)) {
  throw "Missing player configuration: $playerEnvFile"
}

Get-Content -LiteralPath $playerEnvFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith('#')) { return }
  $parts = $line.Split('=', 2)
  if ($parts.Count -ne 2) { return }
  $name = $parts[0].Trim()
  $value = $parts[1].Trim()
  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  [Environment]::SetEnvironmentVariable($name, $value, 'Process')
}

$env:HOST = '127.0.0.1'
$env:PORT = '26906'
$env:PLAYER_DATABASE_PATH = Join-Path $root '..\data\player-player.sqlite'
$env:PLAYER_CHAR_DATA_DIR = Join-Path $backend 'data\char-user-qq'
$env:PLAYER_CORS_ORIGIN = 'http://127.0.0.1:6173'
if ([string]::IsNullOrWhiteSpace($env:PLAYER_SERVICE_TOKEN) -or $env:PLAYER_SERVICE_TOKEN -like 'replace-with-*') {
  throw "Set PLAYER_SERVICE_TOKEN in $playerEnvFile before starting mxd-player"
}
Get-NetTCPConnection -LocalPort 26906 -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
  $playerProcessId = $_.OwningProcess
  if ($playerProcessId -and $playerProcessId -ne $PID) {
    Write-Host "Stopping previous mxd-player backend (PID $playerProcessId) ..." -ForegroundColor Yellow
    Stop-Process -Id $playerProcessId -Force -ErrorAction SilentlyContinue
  }
}
Write-Host 'Starting backend on http://127.0.0.1:26906 ...' -ForegroundColor Cyan
Start-Process -WorkingDirectory $backend -FilePath 'go' -ArgumentList 'run ./cmd/mxd-player' -WindowStyle Normal
Write-Host 'Starting frontend on http://127.0.0.1:6173 ...' -ForegroundColor Green
Set-Location $frontend
npm run dev -- --host 127.0.0.1
