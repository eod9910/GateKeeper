$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$outputDir = Join-Path $projectRoot 'offline-codex-transcripts-live'
$pidPath = Join-Path $outputDir 'mirror.pid'

if (-not (Test-Path $pidPath)) {
  Write-Output "Codex transcript mirror is not running (no PID file)."
  exit 0
}

$rawPid = (Get-Content $pidPath -Raw).Trim()
if (-not $rawPid) {
  Remove-Item -Path $pidPath -Force
  Write-Output "Removed empty Codex transcript mirror PID file."
  exit 0
}

$process = Get-Process -Id ([int]$rawPid) -ErrorAction SilentlyContinue
if (-not $process) {
  Remove-Item -Path $pidPath -Force
  Write-Output "Removed stale Codex transcript mirror PID file for PID $rawPid."
  exit 0
}

Stop-Process -Id $process.Id
Remove-Item -Path $pidPath -Force
Write-Output "Stopped Codex transcript mirror (PID $($process.Id))."
