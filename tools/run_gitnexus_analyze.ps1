param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$GitNexusArgs
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$protectedFiles = @(
  (Join-Path $repoRoot 'AGENTS.md'),
  (Join-Path $repoRoot 'CLAUDE.md')
)

$snapshots = @{}
foreach ($file in $protectedFiles) {
  if (Test-Path -LiteralPath $file) {
    $snapshots[$file] = [System.IO.File]::ReadAllBytes($file)
  }
}

try {
  Push-Location $repoRoot
  if ($GitNexusArgs -and $GitNexusArgs.Count -gt 0) {
    & npx.cmd gitnexus analyze @GitNexusArgs
  } else {
    & npx.cmd gitnexus analyze
  }
  if ($LASTEXITCODE -ne 0) {
    throw "gitnexus analyze failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
  foreach ($file in $snapshots.Keys) {
    [System.IO.File]::WriteAllBytes($file, $snapshots[$file])
  }
}
