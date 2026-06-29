$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$relayRoot = Split-Path -Parent $scriptDir
$projectRoot = Split-Path -Parent $relayRoot
$pythonScript = Join-Path $scriptDir 'cursor_session_mirror.py'
$outputDir = Join-Path $projectRoot 'agent-relay\transcripts\cursor-live'
$pidPath = Join-Path $outputDir 'mirror.pid'

function Test-IsCursorMirrorProcess {
  param([int]$ProcessId)

  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $processInfo) {
    return $false
  }

  $commandLine = ([string]$processInfo.CommandLine).Replace('\', '/').ToLowerInvariant()
  $scriptMarker = $pythonScript.Replace('\', '/').ToLowerInvariant()
  $outputMarker = $outputDir.Replace('\', '/').ToLowerInvariant()
  return (
    $commandLine.Contains($scriptMarker) -and
    $commandLine.Contains($outputMarker) -and
    $commandLine.Contains('--watch')
  )
}

if (-not (Test-Path $pidPath)) {
  Write-Output "Cursor transcript mirror is not running: no PID file found."
  exit 0
}

$rawPid = (Get-Content $pidPath -Raw).Trim()
if (-not $rawPid) {
  Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
  Write-Output "Cursor transcript mirror is not running: empty PID file removed."
  exit 0
}

try {
  $pidValue = [int]$rawPid
} catch {
  Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
  Write-Output "Cursor transcript mirror is not running: invalid PID file removed."
  exit 0
}

if (-not (Test-IsCursorMirrorProcess -ProcessId $pidValue)) {
  Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
  Write-Output "Cursor transcript mirror is not running: stale PID file removed."
  exit 0
}

Stop-Process -Id $pidValue -ErrorAction Stop
Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
Write-Output "Stopped Cursor transcript mirror (PID $pidValue)."
