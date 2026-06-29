$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$toolsDir = Split-Path -Parent (Split-Path -Parent $scriptDir)
$relayRoot = Split-Path -Parent $toolsDir
$projectRoot = Split-Path -Parent $relayRoot
$pidPath = Join-Path $projectRoot 'agent-relay\roles\consultant\transcripts\live\mirror.pid'

if (-not (Test-Path $pidPath)) {
  Write-Output 'Consultant transcript mirror is not running.'
  exit 0
}

$rawPid = (Get-Content $pidPath -Raw).Trim()
if (-not $rawPid) {
  Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
  Write-Output 'Consultant transcript mirror is not running.'
  exit 0
}

try {
  Stop-Process -Id ([int]$rawPid) -Force -ErrorAction Stop
  Wait-Process -Id ([int]$rawPid) -ErrorAction SilentlyContinue
  Write-Output "Stopped Consultant transcript mirror (PID $rawPid)."
} catch {
  Write-Output "Consultant transcript mirror process $rawPid was not running."
}

Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
