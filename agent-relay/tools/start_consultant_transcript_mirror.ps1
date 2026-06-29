$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$relayRoot = Split-Path -Parent $scriptDir
$projectRoot = Split-Path -Parent $relayRoot
$pythonScript = Join-Path $scriptDir 'consultant\transcripts\cursor_session_mirror.py'
$outputDir = Join-Path $projectRoot 'agent-relay\roles\consultant\transcripts\live'
$stdoutLogPath = Join-Path $outputDir 'mirror.out.log'
$stderrLogPath = Join-Path $outputDir 'mirror.err.log'
$pidPath = Join-Path $outputDir 'mirror.pid'

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCommand) {
  $pythonCommand = Get-Command py -ErrorAction SilentlyContinue
}
if (-not $pythonCommand) {
  throw "Could not find python or py on PATH."
}

function Test-IsConsultantMirrorProcess {
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

$existingPid = $null
if (Test-Path $pidPath) {
  $rawPid = (Get-Content $pidPath -Raw).Trim()
  if ($rawPid) {
    try {
      $pidValue = [int]$rawPid
      $existingPid = Get-Process -Id $pidValue -ErrorAction Stop
      Start-Sleep -Milliseconds 750
      $existingPid = Get-Process -Id $pidValue -ErrorAction Stop
      if (-not (Test-IsConsultantMirrorProcess -ProcessId $pidValue)) {
        $existingPid = $null
        Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
      }
    } catch {
      $existingPid = $null
    }
  }
}

if ($existingPid) {
  Write-Output "Consultant transcript mirror already running (PID $($existingPid.Id))."
  exit 0
}

$matchingProcess = Get-CimInstance Win32_Process |
  Where-Object {
    $commandLine = ([string]$_.CommandLine).Replace('\', '/').ToLowerInvariant()
    $scriptMarker = $pythonScript.Replace('\', '/').ToLowerInvariant()
    $outputMarker = $outputDir.Replace('\', '/').ToLowerInvariant()
    $commandLine.Contains($scriptMarker) -and
      $commandLine.Contains($outputMarker) -and
      $commandLine.Contains('--watch')
  } |
  Select-Object -First 1

if ($matchingProcess) {
  $matchingProcess.ProcessId | Set-Content -Path $pidPath -Encoding ascii
  Write-Output "Consultant transcript mirror already running (PID $($matchingProcess.ProcessId))."
  exit 0
}

$arguments = @(
  '-u',
  $pythonScript,
  '--workspace',
  $projectRoot,
  '--output',
  $outputDir,
  '--watch',
  '--interval',
  '30'
)

$process = Start-Process -FilePath $pythonCommand.Source -ArgumentList $arguments -WorkingDirectory $projectRoot -RedirectStandardOutput $stdoutLogPath -RedirectStandardError $stderrLogPath -WindowStyle Hidden -PassThru
$process.Id | Set-Content -Path $pidPath -Encoding ascii

Write-Output "Started Consultant transcript mirror (PID $($process.Id))."
Write-Output "Output: $outputDir"
Write-Output "Stdout Log: $stdoutLogPath"
Write-Output "Stderr Log: $stderrLogPath"
