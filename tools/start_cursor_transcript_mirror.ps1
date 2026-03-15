$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$pythonScript = Join-Path $scriptDir 'cursor_transcript_mirror.py'
$outputDir = Join-Path $projectRoot 'offline-cursor-transcripts-live'
$stdoutLogPath = Join-Path $outputDir 'mirror.out.log'
$stderrLogPath = Join-Path $outputDir 'mirror.err.log'
$pidPath = Join-Path $outputDir 'mirror.pid'

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$existingPid = $null
if (Test-Path $pidPath) {
  $rawPid = (Get-Content $pidPath -Raw).Trim()
  if ($rawPid) {
    try {
      $existingPid = Get-Process -Id ([int]$rawPid) -ErrorAction Stop
      Start-Sleep -Milliseconds 750
      $existingPid = Get-Process -Id ([int]$rawPid) -ErrorAction Stop
    } catch {
      $existingPid = $null
    }
  }
}

if ($existingPid) {
  Write-Output "Cursor transcript mirror already running (PID $($existingPid.Id))."
  exit 0
}

$arguments = @(
  '-u',
  $pythonScript,
  '--watch',
  '--workspace',
  $projectRoot,
  '--output',
  $outputDir
)

$process = Start-Process -FilePath 'python' -ArgumentList $arguments -WorkingDirectory $projectRoot -RedirectStandardOutput $stdoutLogPath -RedirectStandardError $stderrLogPath -WindowStyle Hidden -PassThru
$process.Id | Set-Content -Path $pidPath -Encoding ascii

Write-Output "Started Cursor transcript mirror (PID $($process.Id))."
Write-Output "Output: $outputDir"
Write-Output "Stdout Log: $stdoutLogPath"
Write-Output "Stderr Log: $stderrLogPath"
