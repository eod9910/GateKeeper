# install_cache_warmup_task.ps1
# Registers a Windows Task Scheduler job that runs warmup_cache.py every day at 4:00 AM.
# Uses schtasks.exe which works without Administrator elevation for current-user tasks.
#
# Usage:
#   cd C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector
#   powershell -ExecutionPolicy Bypass -File backend\scripts\install_cache_warmup_task.ps1

$taskName   = "PatternDetector-CacheWarmup"
$projectDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$pythonExe  = (Get-Command python -ErrorAction SilentlyContinue).Source
$scriptPath = Join-Path $projectDir "backend\scripts\warmup_cache.py"
$logPath    = Join-Path $projectDir "backend\data\warmup.log"

if (-not $pythonExe) {
    Write-Error "Python not found on PATH. Make sure your venv or Python install is on PATH."
    exit 1
}

Write-Host "Project dir : $projectDir"
Write-Host "Python      : $pythonExe"
Write-Host "Script      : $scriptPath"
Write-Host "Log         : $logPath"
Write-Host ""

# Delete existing task silently if it exists
schtasks /Delete /TN $taskName /F 2>$null | Out-Null

# Use the .bat launcher to avoid quoting issues with spaces in the project path.
$batPath = Join-Path $projectDir "backend\scripts\warmup_cache.bat"

$result = schtasks /Create `
    /TN $taskName `
    /TR $batPath `
    /SC DAILY `
    /ST 04:00 `
    /RL HIGHEST `
    /F 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "Task '$taskName' registered successfully." -ForegroundColor Green
    Write-Host "It will run every day at 4:00 AM."
    Write-Host ""
    Write-Host "To run it right now (test):"
    Write-Host "  schtasks /Run /TN `"$taskName`""
    Write-Host ""
    Write-Host "To check last run status:"
    Write-Host "  schtasks /Query /TN `"$taskName`" /FO LIST /V"
    Write-Host ""
    Write-Host "To view the log:"
    Write-Host "  Get-Content '$logPath' -Tail 50"
} else {
    Write-Host "ERROR: Failed to register task." -ForegroundColor Red
    Write-Host $result
    exit 1
}
