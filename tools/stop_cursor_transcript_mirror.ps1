$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$pidPath = Join-Path $projectRoot 'offline-cursor-transcripts-live\mirror.pid'

if (-not (Test-Path $pidPath)) {
  Write-Output 'Cursor transcript mirror is not running.'
  exit 0
}

$rawPid = (Get-Content $pidPath -Raw).Trim()
if (-not $rawPid) {
  Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
  Write-Output 'Cursor transcript mirror is not running.'
  exit 0
}

try {
  Stop-Process -Id ([int]$rawPid) -Force -ErrorAction Stop
  Wait-Process -Id ([int]$rawPid) -ErrorAction SilentlyContinue
  Write-Output "Stopped Cursor transcript mirror (PID $rawPid)."
} catch {
  Write-Output "Cursor transcript mirror process $rawPid was not running."
}

Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
