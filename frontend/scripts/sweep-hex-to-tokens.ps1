# Replace hardcoded brand hex colors with Tailwind theme-token classes.
# Only touches Tailwind arbitrary-value class fragments of the form: -[#HEX]
# JS-side raw string literals (e.g. `borderColor: '#2C736C'`) are intentionally
# left alone.

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path "$PSScriptRoot\..\src").Path
Write-Host "Sweeping under: $root"

$files = Get-ChildItem -Path $root -Recurse -Include *.js,*.jsx -File |
  Where-Object { $_.FullName -notmatch '\\components\\ui\\LoadingSpinner\.jsx$' }

# (pattern, replacement) — applied as literal regex on -[#HEX] fragments.
# Order matters: the darker variants first (so they don't get caught by the
# primary one).
$replacements = @(
  @{ from = '-\[#245b56\]';            to = '-primary/90' },
  @{ from = '-\[#245e58\]';            to = '-primary/90' },
  @{ from = '-\[#245B56\]';            to = '-primary/90' },
  @{ from = '-\[#256a63\]';            to = '-primary/90' },
  @{ from = '-\[#265f59\]';            to = '-primary/90' },
  @{ from = '-\[#256E68\]';            to = '-primary/90' },
  @{ from = '-\[#F1F8F7\]';            to = '-primary/10' },
  @{ from = '-\[#E8F4F3\]';            to = '-primary/15' },
  @{ from = '-\[#2C736C\]';            to = '-primary' },
  @{ from = '-\[#2c736c\]';            to = '-primary' }
)

$totalReplacements = 0
$filesChanged = 0

foreach ($file in $files) {
  $content = Get-Content -Raw -Path $file.FullName
  if ($null -eq $content -or $content.Length -eq 0) { continue }
  $original = $content
  foreach ($r in $replacements) {
    $content = [regex]::Replace($content, $r.from, $r.to)
  }
  if ($content -ne $original) {
    Set-Content -Path $file.FullName -Value $content -NoNewline
    $filesChanged++
    # Count replacements crudely
    $diff = ([regex]::Matches($original, '-\[#(2[Cc]736[Cc]|245[bB]56|245[eE]58|256[aA]63|265[fF]59|256[eE]68|F1F8F7|E8F4F3)\]')).Count
    $totalReplacements += $diff
  }
}

Write-Host "Files changed: $filesChanged"
Write-Host "Replacement sites: $totalReplacements"
