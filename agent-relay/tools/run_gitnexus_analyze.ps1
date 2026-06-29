$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$relayRoot = Split-Path -Parent $scriptDir
$projectRoot = Split-Path -Parent $relayRoot
$agentsPath = Join-Path $projectRoot 'AGENTS.md'
$claudePath = Join-Path $projectRoot 'CLAUDE.md'
$agentsBackup = $null
$claudeBackup = $null

if (Test-Path -LiteralPath $agentsPath -PathType Leaf) {
  $agentsBackup = Get-Content -LiteralPath $agentsPath -Raw
}
if (Test-Path -LiteralPath $claudePath -PathType Leaf) {
  $claudeBackup = Get-Content -LiteralPath $claudePath -Raw
}

try {
  Push-Location $projectRoot
  npx gitnexus analyze
} finally {
  Pop-Location
  if ($null -ne $agentsBackup) {
    Set-Content -LiteralPath $agentsPath -Value $agentsBackup -Encoding UTF8
  }
  if ($null -ne $claudeBackup) {
    Set-Content -LiteralPath $claudePath -Value $claudeBackup -Encoding UTF8
  } elseif (Test-Path -LiteralPath $claudePath -PathType Leaf) {
    Remove-Item -LiteralPath $claudePath -Force
  }
}
