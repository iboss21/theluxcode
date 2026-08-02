<#
.SYNOPSIS
    Replaces the dashboard your existing RegesCore server serves at /fleet/
    with a new Claude Design export.

.DESCRIPTION
    RegesCore (github.com/iboss21/reges.core-memory) serves its dashboard from
    a folder inside its own repo — REPOS.md records it as `client/fleet/`. So
    http://127.0.0.1:3000/fleet/ renders whatever HTML is sitting in that
    folder, and dropping a new export anywhere else changes nothing on :3000.
    That is the whole reason a new design can look "not applied": the file that
    is actually being served was never touched.

    This finds the served file rather than assuming its path:

      1. Fetches /fleet/ and fingerprints it — byte length, and the count of
         data-scr screens and data-goto nav items in the markup.
      2. Searches -Root for candidate files whose contents match that
         fingerprint, so the target is identified by what the server returns,
         not by a guessed filename.
      3. Backs the file up, copies the new export over it, and copies
         support.js, image-slot.js, assets/ and vendor/ alongside — the runtime
         ships with the export and changes with it.
      4. Re-fetches /fleet/ and prints before/after counts, so "did it apply"
         is answered by the server, not by hope.

.PARAMETER Source
    Folder holding the new export, e.g. C:\Users\iBoss\Downloads\RegesCore-UI

.PARAMETER Root
    Where to search for the served file. Defaults to $env:USERPROFILE.

.PARAMETER Url
    The dashboard URL to fingerprint and re-check. Default http://127.0.0.1:3000/fleet/

.PARAMETER Target
    Skip discovery and write to this exact file.

.EXAMPLE
    .\Deploy-ToRegesCore.ps1 -Source C:\Users\iBoss\Downloads\RegesCore-UI -WhatIf

.EXAMPLE
    .\Deploy-ToRegesCore.ps1 -Source C:\Users\iBoss\Downloads\RegesCore-UI

.NOTES
    RegesCore // Fable 5 - brand and engineering by davidio.dev
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)][string]$Source,
    [string]$Root = $env:USERPROFILE,
    [string]$Url = 'http://127.0.0.1:3000/fleet/',
    [string]$Target
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-Fingerprint {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Text)
    [pscustomobject]@{
        Bytes    = $Text.Length
        Screens  = ([regex]::Matches($Text, 'data-scr="[a-z0-9_-]+"') |
                     ForEach-Object { $_.Value } | Sort-Object -Unique).Count
        NavItems = [regex]::Matches($Text, 'data-goto="').Count
        IsDc     = $Text -match '<x-dc'
    }
}

function Show-Fingerprint {
    param([string]$Label, $Fp, [string]$Color = 'Gray')
    if (-not $Fp) { Write-Host ("  {0,-9} (unavailable)" -f $Label) -ForegroundColor DarkGray; return }
    Write-Host ("  {0,-9} {1,9:N0} bytes   {2,3} screens   {3,3} nav items" -f
        $Label, $Fp.Bytes, $Fp.Screens, $Fp.NavItems) -ForegroundColor $Color
}

Write-Host ''
Write-Host 'RegesCore dashboard deploy - davidio.dev' -ForegroundColor Cyan

# -- the new export ----------------------------------------------------
if (-not (Test-Path -LiteralPath $Source)) { throw "no such folder: $Source" }
$export = Get-ChildItem -LiteralPath $Source -Filter '*.dc.html' -File |
    Sort-Object Length -Descending | Select-Object -First 1
if (-not $export) { throw "no .dc.html in $Source" }
$newText = Get-Content -LiteralPath $export.FullName -Raw -Encoding UTF8
$newFp = Get-Fingerprint -Text $newText

# -- what the server is serving now ------------------------------------
$servedText = $null
try {
    $servedText = (Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 20).Content
} catch {
    Write-Host "  could not fetch $Url - $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host '  Discovery needs it. Pass -Target to write to a known path instead.' -ForegroundColor Yellow
}
$servedFp = if ($servedText) { Get-Fingerprint -Text $servedText } else { $null }

Write-Host ''
Show-Fingerprint 'served'  $servedFp 'Yellow'
Show-Fingerprint 'export'  $newFp    'Green'

if ($servedFp -and $servedFp.Bytes -eq $newFp.Bytes -and $servedFp.NavItems -eq $newFp.NavItems) {
    Write-Host ''
    Write-Host '  Already serving this export. Nothing to do.' -ForegroundColor Green
    Write-Host '  If the browser still looks old, it is cached: Ctrl+Shift+R.' -ForegroundColor Cyan
    exit 0
}

# -- find the file being served ----------------------------------------
if (-not $Target) {
    if (-not $servedText) { throw 'cannot discover the target without a reachable -Url; pass -Target' }
    Write-Host ''
    Write-Host "  searching $Root for the file behind $Url ..." -ForegroundColor DarkGray

    # Match on the served byte length first: cheap, and decisive enough that
    # only a handful of files ever need reading.
    $candidates = Get-ChildItem -LiteralPath $Root -Recurse -File -Include '*.html' -ErrorAction SilentlyContinue |
        Where-Object {
            $_.FullName -notmatch '\\node_modules\\' -and
            $_.FullName -notmatch '\\_backup\\' -and
            [math]::Abs($_.Length - $servedFp.Bytes) -lt 4096
        }

    $matches = @()
    foreach ($file in $candidates) {
        $text = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
        $fp = Get-Fingerprint -Text $text
        if ($fp.NavItems -eq $servedFp.NavItems -and $fp.Screens -eq $servedFp.Screens) {
            $matches += $file
        }
    }

    Write-Host "  $($matches.Count) file(s) match what the server returns:"
    foreach ($m in $matches) { Write-Host "    $($m.FullName)" }

    if ($matches.Count -eq 0) {
        Write-Host ''
        Write-Host '  Not found under -Root. The dashboard may be bundled into the' -ForegroundColor Yellow
        Write-Host '  server process, or served from another drive. Find it with:' -ForegroundColor Yellow
        Write-Host '    Get-ChildItem C:\ -Recurse -Directory -Filter fleet -ErrorAction SilentlyContinue' -ForegroundColor DarkGray
        Write-Host '  then re-run with -Target <that folder>\index.html' -ForegroundColor Yellow
        exit 1
    }
    if ($matches.Count -gt 1) {
        Write-Host ''
        Write-Host '  More than one match. Re-run with -Target to pick one.' -ForegroundColor Yellow
        exit 1
    }
    $Target = $matches[0].FullName
}

$targetDir = Split-Path -Parent $Target
Write-Host ''
Write-Host "  target : $Target" -ForegroundColor Cyan

# -- back up and write -------------------------------------------------
if (Test-Path -LiteralPath $Target) {
    $backup = Join-Path $targetDir ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + (Split-Path -Leaf $Target) + '.bak')
    if ($PSCmdlet.ShouldProcess($backup, 'back up the served dashboard')) {
        Copy-Item -LiteralPath $Target -Destination $backup -Force
        Write-Host "  backed up  $backup"
    }
}

if ($PSCmdlet.ShouldProcess($Target, "install $($export.Name)")) {
    Copy-Item -LiteralPath $export.FullName -Destination $Target -Force
    Write-Host "  installed  $($export.Name)" -ForegroundColor Green
}

# The export references ./support.js and assets/wolf.png relatively, so they
# have to sit next to it or the runtime never boots and the page stays blank.
foreach ($side in @('support.js', 'image-slot.js')) {
    $p = Join-Path $Source $side
    if ((Test-Path -LiteralPath $p) -and $PSCmdlet.ShouldProcess((Join-Path $targetDir $side), 'copy')) {
        Copy-Item -LiteralPath $p -Destination (Join-Path $targetDir $side) -Force
        Write-Host "  copied     $side"
    }
}
foreach ($dir in @('assets', 'vendor')) {
    $p = Join-Path $Source $dir
    if ((Test-Path -LiteralPath $p) -and $PSCmdlet.ShouldProcess((Join-Path $targetDir $dir), 'copy folder')) {
        Copy-Item -LiteralPath $p -Destination $targetDir -Recurse -Force
        Write-Host "  copied     $dir/"
    }
}

# -- confirm with the server -------------------------------------------
if ($WhatIfPreference) { Write-Host ''; Write-Host '  (WhatIf - nothing written)' -ForegroundColor Yellow; exit 0 }

Start-Sleep -Seconds 1
try {
    $after = Get-Fingerprint -Text (Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 20).Content
    Write-Host ''
    Show-Fingerprint 'before' $servedFp 'DarkGray'
    Show-Fingerprint 'now'    $after    'Green'
    if ($after.NavItems -eq $newFp.NavItems) {
        Write-Host ''
        Write-Host '  The server is now returning the new export.' -ForegroundColor Green
        Write-Host '  Hard-refresh the browser: Ctrl+Shift+R.' -ForegroundColor Cyan
    } else {
        Write-Host ''
        Write-Host '  The file was written but the server still returns the old markup.' -ForegroundColor Yellow
        Write-Host '  It is caching or bundling the dashboard - restart the RegesCore' -ForegroundColor Yellow
        Write-Host '  process and check again.' -ForegroundColor Yellow
    }
} catch {
    Write-Host "  could not re-check $Url - $($_.Exception.Message)" -ForegroundColor Yellow
}
Write-Host ''
