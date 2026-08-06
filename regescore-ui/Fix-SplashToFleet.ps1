<#
.SYNOPSIS
    Makes the splash hand straight off to /fleet/ instead of flashing the old
    dashboard first.

.DESCRIPTION
    RegesCore's public/index.html holds the splash overlay AND the old
    two-column dashboard in the same document. When the boot timer expires the
    splash only hides itself:

        setTimeout(function(){
          var s=document.getElementById('splash');
          if(s&&!s.classList.contains('hidden')){
            s.classList.add('hidden');
            document.body.classList.remove('splash-active');
          }
        },BOOT_MS);

    Hiding the overlay reveals the markup underneath it — the old dashboard —
    and only then does the redirect to /fleet/ run. That ordering is the flash.

    This replaces the hide with a navigation, so the overlay stays opaque until
    the browser leaves the page and the old dashboard is never painted:

        setTimeout(function(){ location.replace('/fleet/'); },BOOT_MS);

    location.replace, not location.href: replace leaves no history entry, so
    Back returns to wherever the operator came from rather than re-running the
    splash and bouncing forward again.

    Idempotent — a second run detects the patch and does nothing.

.PARAMETER Index
    Path to the served index.html. Defaults to the RegesCore layout under the
    current directory.

.PARAMETER Target
    Where the splash should land. Default /fleet/.

.PARAMETER Revert
    Restore the most recent backup.

.EXAMPLE
    .\Fix-SplashToFleet.ps1 -Index 'C:\Users\iBoss\Documents\GitHub\AI Workforce Workflow DataCenter\Reges.Core\public\index.html' -WhatIf

.EXAMPLE
    .\Fix-SplashToFleet.ps1 -Index 'C:\...\Reges.Core\public\index.html'

.NOTES
    RegesCore // Fable 5 - brand and engineering by davidio.dev
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Index = (Join-Path (Get-Location) 'public\index.html'),
    [string]$Target = '/fleet/',
    [switch]$Revert
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$MARK = '/* regescore: splash hands off to the fleet deck */'

Write-Host ''
Write-Host 'RegesCore splash handoff - davidio.dev' -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $Index)) { throw "not found: $Index" }
Write-Host "  file : $Index"

if ($Revert) {
    $backup = Get-ChildItem (Split-Path -Parent $Index) -Filter 'index.html.*.bak' |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $backup) { throw 'no backup found' }
    if ($PSCmdlet.ShouldProcess($Index, "restore $($backup.Name)")) {
        Copy-Item -LiteralPath $backup.FullName -Destination $Index -Force
        Write-Host "  restored $($backup.Name)" -ForegroundColor Green
    }
    exit 0
}

$html = Get-Content -LiteralPath $Index -Raw -Encoding UTF8

if ($html.Contains($MARK)) {
    Write-Host '  already patched - the splash navigates already.' -ForegroundColor Green
    exit 0
}

# Matched on structure, not on exact whitespace: the two statements that reveal
# the page underneath. Anchored on getElementById('splash') so it cannot hit
# any other classList call in a 118 KB document.
$pattern = "(?s)var\s+s\s*=\s*document\.getElementById\(\s*'splash'\s*\)\s*;\s*" +
           "if\s*\(\s*s\s*&&\s*!\s*s\.classList\.contains\(\s*'hidden'\s*\)\s*\)\s*\{[^}]*?\}"

$found = [regex]::Matches($html, $pattern)
if ($found.Count -eq 0) {
    Write-Host ''
    Write-Host '  Could not find the splash-hide block. It may already differ from' -ForegroundColor Yellow
    Write-Host '  the version this was written against. Look for:' -ForegroundColor Yellow
    Write-Host "    getElementById('splash')  ...  classList.add('hidden')" -ForegroundColor DarkGray
    Write-Host '  and replace the body of that setTimeout with:' -ForegroundColor Yellow
    Write-Host "    location.replace('$Target');" -ForegroundColor DarkGray
    exit 1
}
if ($found.Count -gt 1) {
    Write-Host "  $($found.Count) matches - refusing to guess. Patch by hand." -ForegroundColor Yellow
    exit 1
}

Write-Host "  found the splash-hide block at offset $($found[0].Index)"

# Navigate instead of unhiding. The overlay is left in place deliberately: it
# must keep covering the old dashboard for the whole navigation, which is the
# entire point.
$replacement = "$MARK location.replace('$Target');"
$patched = $html.Remove($found[0].Index, $found[0].Length).Insert($found[0].Index, $replacement)

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = "$Index.$stamp.bak"

if ($PSCmdlet.ShouldProcess($Index, "patch splash handoff to $Target")) {
    Copy-Item -LiteralPath $Index -Destination $backupPath -Force
    # UTF8 without BOM: a BOM prepended to a served HTML document shows as a
    # stray character before <!doctype in some parsers.
    [System.IO.File]::WriteAllText($Index, $patched, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "  backed up  $backupPath" -ForegroundColor DarkGray
    Write-Host "  patched    splash -> $Target" -ForegroundColor Green
    Write-Host ''
    Write-Host '  Restart RegesCore, then load http://127.0.0.1:3000/ - splash, then' -ForegroundColor Cyan
    Write-Host '  the fleet deck, with no dashboard in between.' -ForegroundColor Cyan
    Write-Host '  Undo with:  .\Fix-SplashToFleet.ps1 -Revert' -ForegroundColor DarkGray
} else {
    Write-Host '  (WhatIf) would replace the hide with:' -ForegroundColor Yellow
    Write-Host "    $replacement" -ForegroundColor DarkGray
}
Write-Host ''
