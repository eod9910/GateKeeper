$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repoRoot

function Get-Count($lines) {
  if (-not $lines) { return 0 }
  return @($lines).Count
}

$statusLines = git status --short
$trackedModified = @($statusLines | Where-Object { $_ -match '^( M|M |MM|A |AM| D|D )' })
$untracked = @($statusLines | Where-Object { $_ -match '^\?\?' })
$backendData = @($statusLines | Where-Object { $_ -match 'backend/data/' })
$planning = @($statusLines | Where-Object { $_ -match '\.planning/' })
$workspace = @($statusLines | Where-Object { $_ -match '^.. workspace/' })

$localHiddenTargets = @(
  'backend/data/execution-bridge-config.json',
  'backend/data/execution-settings.json',
  'backend/data/strategies/macd_divergence_crypto_14R_v2_sweep_winner_v1773644039686.json',
  'backend/data/strategies/pullback_uptrend_entry_composite_v1_sweep_winner_v1771733344106_sweep_winner_v1771734925018_sweep_winner_v1771745210926.json'
)

$skipWorktree = @()
foreach ($target in $localHiddenTargets) {
  $entry = git ls-files -v -- $target
  if ($entry -and @($entry).Count -gt 0) {
    $skipWorktree += $entry
  }
}

$score = 'GREEN'
if ((Get-Count $statusLines) -gt 40 -or (Get-Count $backendData) -gt 20) {
  $score = 'RED'
} elseif ((Get-Count $statusLines) -gt 15 -or (Get-Count $backendData) -gt 10) {
  $score = 'YELLOW'
}

Write-Host ''
Write-Host 'Pattern Detector Repo State' -ForegroundColor Cyan
Write-Host '===========================' -ForegroundColor Cyan
Write-Host ("Status score: {0}" -f $score)
Write-Host ("Changed files: {0}" -f (Get-Count $statusLines))
Write-Host ("Tracked modified/add/delete: {0}" -f (Get-Count $trackedModified))
Write-Host ("Untracked files: {0}" -f (Get-Count $untracked))
Write-Host ("backend/data entries in status: {0}" -f (Get-Count $backendData))
Write-Host ("Planning docs in status: {0}" -f (Get-Count $planning))
Write-Host ("Workspace files in status: {0}" -f (Get-Count $workspace))
Write-Host ("Local skip-worktree files: {0}" -f (Get-Count $skipWorktree))

Write-Host ''
Write-Host 'Guardrails' -ForegroundColor Cyan
Write-Host '----------' -ForegroundColor Cyan
Write-Host '1. Runtime state must write to ignored/local files, not tracked backend/data JSON.'
Write-Host '2. Generated artifacts should live in ignored dirs or be explicitly treated as source.'
Write-Host '3. Stop and checkpoint when one initiative becomes two unrelated initiatives.'
Write-Host '4. Run this script before ending a session or starting a risky refactor.'

Write-Host ''
Write-Host 'Action threshold' -ForegroundColor Cyan
Write-Host '----------------' -ForegroundColor Cyan
switch ($score) {
  'GREEN' {
    Write-Host 'Worktree is focused. Safe to continue on the current slice.'
  }
  'YELLOW' {
    Write-Host 'Worktree is widening. Finish the current slice, then create a checkpoint soon.' -ForegroundColor Yellow
  }
  'RED' {
    Write-Host 'Worktree is too broad. Make an intentional checkpoint before starting another initiative.' -ForegroundColor Red
  }
}

if ((Get-Count $backendData) -gt 0) {
  Write-Host ''
  Write-Host 'backend/data items still visible in git status:' -ForegroundColor Cyan
  $backendData | Select-Object -First 25 | ForEach-Object { Write-Host ("  {0}" -f $_) }
  if ((Get-Count $backendData) -gt 25) {
    Write-Host ("  ... and {0} more" -f ((Get-Count $backendData) - 25))
  }
}

if ((Get-Count $skipWorktree) -gt 0) {
  Write-Host ''
  Write-Host 'Local-only hidden/generated files:' -ForegroundColor Cyan
  $skipWorktree | Select-Object -First 20 | ForEach-Object { Write-Host ("  {0}" -f $_) }
  if ((Get-Count $skipWorktree) -gt 20) {
    Write-Host ("  ... and {0} more" -f ((Get-Count $skipWorktree) - 20))
  }
}

Write-Host ''
Write-Host 'Recommended routine' -ForegroundColor Cyan
Write-Host '-------------------' -ForegroundColor Cyan
Write-Host '1. Run: git status --short'
Write-Host '2. Run: powershell -ExecutionPolicy Bypass -File backend/scripts/check_repo_state.ps1'
Write-Host '3. If score is RED, checkpoint before starting new work.'
Write-Host ''
