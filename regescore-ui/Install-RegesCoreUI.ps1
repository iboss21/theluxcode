<#
.SYNOPSIS
    Replaces the dashboard RegesCore serves with a new Claude Design export.

.DESCRIPTION
    The command center on :3000 serves whatever .dc.html is sitting in its
    public directory. Swapping the design is a file copy - there is no build
    step, because the dc runtime renders the export in the browser.

    What this does:
      1. Backs up the current dashboard, timestamped, so a bad export is one
         command to undo.
      2. Copies the new export in, along with support.js, image-slot.js,
         vendor/ and assets/ if the export folder carries them.
      3. Reports the screen and nav-item count of both the old and the new
         file, so you can see the swap actually changed something before
         restarting anything.

    Point -Source at the folder holding "Reges Core.dc.html" - the folder you
    get from Claude Design's export, e.g. C:\Users\iBoss\Downloads\RegesCore-UI.

.PARAMETER Source
    Folder containing the new export.

.PARAMETER Target
    The public directory RegesCore serves from.

.PARAMETER Name
    Filename to write inside -Target. Defaults to index.dc.html.

.PARAMETER Restore
    Roll back to the most recent backup instead of installing.

.EXAMPLE
    .\Install-RegesCoreUI.ps1 -Source C:\Users\iBoss\Downloads\RegesCore-UI -WhatIf
    Show exactly what would be replaced, without touching anything.

.EXAMPLE
    .\Install-RegesCoreUI.ps1 -Source C:\Users\iBoss\Downloads\RegesCore-UI

.EXAMPLE
    .\Install-RegesCoreUI.ps1 -Restore

.NOTES
    RegesCore // Fable 5 - brand and engineering by davidio.dev
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Source,
    [string]$Target = (Join-Path $PSScriptRoot 'public'),
    [string]$Name = 'index.dc.html',
    [switch]$Restore
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Measure-Dashboard {
    <#  Screen and nav counts are the cheapest honest answer to "is this
        actually a different build". Counted from the markup rather than the
        rendered page so no browser is needed. #>
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $text = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    [pscustomobject]@{
        Path    = $Path
        SizeKB  = [math]::Round((Get-Item -LiteralPath $Path).Length / 1KB)
        Screens = ([regex]::Matches($text, 'data-scr="[a-z0-9_-]+"') | ForEach-Object { $_.Value } | Sort-Object -Unique).Count
        NavItems= [regex]::Matches($text, 'data-goto="').Count
        Sha256  = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.Substring(0, 16)
    }
}

$targetFile = Join-Path $Target $Name
$backupDir = Join-Path $Target '_backup'

Write-Host ''
Write-Host 'RegesCore dashboard swap - davidio.dev' -ForegroundColor Cyan

# -- restore ----------------------------------------------------------
if ($Restore) {
    if (-not (Test-Path -LiteralPath $backupDir)) { throw "no backups in $backupDir" }
    $latest = Get-ChildItem -LiteralPath $backupDir -Filter '*.dc.html' |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latest) { throw "no backups in $backupDir" }
    if ($PSCmdlet.ShouldProcess($targetFile, "restore from $($latest.Name)")) {
        Copy-Item -LiteralPath $latest.FullName -Destination $targetFile -Force
        Write-Host "  restored $($latest.Name)" -ForegroundColor Green
    }
    exit 0
}

if (-not $Source) { throw 'pass -Source with the folder containing "Reges Core.dc.html"' }
if (-not (Test-Path -LiteralPath $Source)) { throw "no such folder: $Source" }

# The export names the file after the design; accept any .dc.html so a rename
# in Claude Design does not break the swap.
$export = Get-ChildItem -LiteralPath $Source -Filter '*.dc.html' -File |
    Sort-Object Length -Descending | Select-Object -First 1
if (-not $export) { throw "no .dc.html found in $Source" }

$before = Measure-Dashboard -Path $targetFile
$after = Measure-Dashboard -Path $export.FullName

Write-Host "  source : $($export.FullName)"
Write-Host "  target : $targetFile"
Write-Host ''
Write-Host ('  {0,-10} {1,8} {2,8} {3,10}  {4}' -f 'build', 'sizeKB', 'screens', 'navitems', 'sha256')
if ($before) {
    Write-Host ('  {0,-10} {1,8} {2,8} {3,10}  {4}' -f 'current', $before.SizeKB, $before.Screens, $before.NavItems, $before.Sha256)
} else {
    Write-Host '  current    (none installed yet)'
}
Write-Host ('  {0,-10} {1,8} {2,8} {3,10}  {4}' -f 'new', $after.SizeKB, $after.Screens, $after.NavItems, $after.Sha256) -ForegroundColor Green

if ($before -and $before.Sha256 -eq $after.Sha256) {
    Write-Host ''
    Write-Host '  These are the SAME FILE. The export you pointed at is what is already' -ForegroundColor Yellow
    Write-Host '  installed, so nothing would change. Re-export from Claude Design and' -ForegroundColor Yellow
    Write-Host '  check the sha256 above moves before running this again.' -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path -LiteralPath $Target)) {
    if ($PSCmdlet.ShouldProcess($Target, 'create')) { New-Item -ItemType Directory -Path $Target -Force | Out-Null }
}

# -- back up ----------------------------------------------------------
if ($before) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = Join-Path $backupDir "$stamp-$Name"
    if ($PSCmdlet.ShouldProcess($backup, 'back up current dashboard')) {
        New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
        Copy-Item -LiteralPath $targetFile -Destination $backup -Force
        Write-Host ''
        Write-Host "  backed up to $backup"
    }
}

# -- install ----------------------------------------------------------
if ($PSCmdlet.ShouldProcess($targetFile, "install $($export.Name)")) {
    Copy-Item -LiteralPath $export.FullName -Destination $targetFile -Force
    Write-Host "  installed $($export.Name) -> $Name" -ForegroundColor Green
}

# Runtime and assets ship alongside the export and change with it. Copying
# only the HTML leaves a new design running on an old runtime.
foreach ($side in @('support.js', 'image-slot.js')) {
    $path = Join-Path $Source $side
    if (-not (Test-Path -LiteralPath $path)) { continue }
    if ($PSCmdlet.ShouldProcess((Join-Path $Target $side), 'copy')) {
        Copy-Item -LiteralPath $path -Destination (Join-Path $Target $side) -Force
        Write-Host "  copied $side"
    }
}
foreach ($dir in @('assets', 'vendor')) {
    $path = Join-Path $Source $dir
    if (-not (Test-Path -LiteralPath $path)) { continue }
    if ($PSCmdlet.ShouldProcess((Join-Path $Target $dir), 'copy folder')) {
        Copy-Item -LiteralPath $path -Destination $Target -Recurse -Force
        Write-Host "  copied $dir/"
    }
}

Write-Host ''
Write-Host '  Done. Hard-refresh the browser (Ctrl+Shift+R) - the old dashboard' -ForegroundColor Cyan
Write-Host '  is cached and a normal reload will show it again.' -ForegroundColor Cyan
Write-Host '  Roll back with:  .\Install-RegesCoreUI.ps1 -Restore' -ForegroundColor DarkGray
Write-Host ''
