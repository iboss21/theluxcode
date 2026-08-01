# RegesCore for LM Studio - installer (Windows)
#
# Brand and engineering by davidio.dev
# https://davidio.dev
#
#   .\install.ps1              install both plugins into LM Studio
#   .\install.ps1 -Dev         run them in development mode instead (live reload)
#   .\install.ps1 -Uninstall   print removal instructions
#
# LM Studio does not discover plugins by scanning a folder. A plugin becomes
# visible only when the app is told about it through its local API, which is
# what "lms dev --install" does. Copying files into extensions\plugins does
# nothing on its own.
#
# Requirements:
#   - LM Studio must be RUNNING. The command talks to its local server.
#   - "lms" must be on PATH. LM Studio ships it; if it is missing, open
#     LM Studio, go to Developer settings and enable the CLI, or run
#     "lms bootstrap" from LM Studio's install folder.

[CmdletBinding()]
param(
    [switch]$Dev,
    [switch]$Uninstall,
    [string]$LmsPath
)

$ErrorActionPreference = "Stop"

$Plugins = @("regescore", "regescore-gateway")
$SourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Find-LMStudioHome {
    $userHome = $env:USERPROFILE
    $pointer = Join-Path $userHome ".lmstudio-home-pointer"
    if (Test-Path -LiteralPath $pointer) {
        return (Get-Content -LiteralPath $pointer -Raw).Trim()
    }
    $cacheHome = Join-Path $userHome ".cache\lm-studio"
    if (Test-Path -LiteralPath $cacheHome) { return $cacheHome }
    return (Join-Path $userHome ".lmstudio")
}

function Resolve-Lms {
    if ($LmsPath) {
        if (-not (Test-Path -LiteralPath $LmsPath)) { Write-Error "Not found: $LmsPath" }
        return $LmsPath
    }
    $onPath = Get-Command lms -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }

    # LM Studio keeps the CLI under its home directory. Search rather than
    # hard-coding, because the layout has changed between releases.
    $lmsHome = Find-LMStudioHome
    if (Test-Path -LiteralPath $lmsHome) {
        $found = Get-ChildItem -LiteralPath $lmsHome -Recurse -Depth 3 -Force `
            -Include 'lms.exe', 'lms.cmd', 'lms.ps1' -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    return $null
}

if ($Uninstall) {
    Write-Host ""
    Write-Host "LM Studio has no command-line uninstall for plugins." -ForegroundColor Yellow
    Write-Host "Remove them in the app: open the Integrations panel, click the"
    Write-Host "three dots next to 'regescore' or 'regescore-gateway', and choose"
    Write-Host "the removal option. Then restart LM Studio."
    exit 0
}

$lms = Resolve-Lms
if (-not $lms) {
    Write-Host ""
    Write-Error @"
Could not find the 'lms' command.

Open LM Studio, go to the Developer tab, and enable the command-line tool.
Alternatively run 'lms bootstrap' from LM Studio's installation folder, then
open a new terminal and re-run this script. You can also pass the path
directly:  .\install.ps1 -LmsPath 'C:\path\to\lms.exe'
"@
}

Write-Host ""
Write-Host "RegesCore for LM Studio - davidio.dev" -ForegroundColor Cyan
Write-Host "  lms      : $lms"
Write-Host "  source   : $SourceDir"
Write-Host "  mode     : $(if ($Dev) { 'development (live reload)' } else { 'install' })"
Write-Host ""
Write-Host "LM Studio must be running: these commands talk to its local server." -ForegroundColor DarkGray
Write-Host ""

foreach ($plugin in $Plugins) {
    $dir = Join-Path $SourceDir $plugin
    if (-not (Test-Path -LiteralPath (Join-Path $dir "manifest.json"))) {
        Write-Error "$dir\manifest.json not found"
    }

    Write-Host "-> $plugin" -ForegroundColor Cyan
    Push-Location $dir
    try {
        if (-not (Test-Path -LiteralPath (Join-Path $dir "node_modules"))) {
            if (Get-Command npm -ErrorAction SilentlyContinue) {
                Write-Host "   installing dependencies..."
                npm install --silent --no-audit --no-fund --omit=dev
            } else {
                Write-Host "   npm not on PATH; lms will install dependencies itself"
            }
        }

        if ($Dev) {
            # lms dev is a foreground watcher: it holds the registration open and
            # rebuilds on every change. Each plugin needs its own window.
            Write-Host "   starting dev server in a new window..."
            Start-Process -FilePath $lms -ArgumentList 'dev' -WorkingDirectory $dir
        } else {
            Write-Host "   installing into LM Studio..."
            & $lms dev --install --yes
            if ($LASTEXITCODE -ne 0) {
                Write-Error "lms dev --install failed for $plugin (exit $LASTEXITCODE). Is LM Studio running?"
            }
        }
    } finally {
        Pop-Location
    }
}

$template = Join-Path $SourceDir "regescore\templates\regescore_fable5.jinja"
Write-Host ""
if ($Dev) {
    Write-Host "Dev servers started. The plugins stay registered while those windows" -ForegroundColor Green
    Write-Host "remain open. Close them to unregister." -ForegroundColor Green
} else {
    Write-Host "Installed. Open the Integrations panel in LM Studio:" -ForegroundColor Green
    Write-Host "  - 'regescore' appears in the plugin list; enable it." -ForegroundColor Green
    Write-Host "  - 'regescore-gateway' appears in the MODEL dropdown, not the plugin" -ForegroundColor Green
    Write-Host "    list, because it registers a generator." -ForegroundColor Green
}
Write-Host ""
Write-Host "Chat template (manual - plugins cannot set it):"
Write-Host "  My Models > your model > Prompt Template, paste:"
Write-Host "  $template"
Write-Host ""
Write-Host "For the Claude Code 400s, also set:"
Write-Host '  setx CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS 1'
Write-Host '  setx CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING 1'
Write-Host ""
Write-Host "RegesCore // Fable 5 - davidio.dev"
