# RegesCore for LM Studio - installer (Windows)
#
# Brand and engineering by davidio.dev
# https://davidio.dev
#
#   .\install.ps1              install both plugins
#   .\install.ps1 -Link        symlink instead of copy (for development)
#   .\install.ps1 -Uninstall   remove both plugins

[CmdletBinding()]
param(
    [switch]$Link,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

$Owner = "davidio-dev"
$Plugins = @("regescore", "regescore-gateway")
$SourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Mirrors LM Studio's own resolution order.
function Find-LMStudioHome {
    $userHome = $env:USERPROFILE
    $pointer = Join-Path $userHome ".lmstudio-home-pointer"
    if (Test-Path -LiteralPath $pointer) {
        return (Get-Content -LiteralPath $pointer -Raw).Trim()
    }
    $cacheHome = Join-Path $userHome ".cache\lm-studio"
    if (Test-Path -LiteralPath $cacheHome) {
        return $cacheHome
    }
    return (Join-Path $userHome ".lmstudio")
}

$LmsHome = Find-LMStudioHome
$PluginRoot = Join-Path $LmsHome "extensions\plugins\$Owner"

Write-Host "LM Studio home:  $LmsHome"
Write-Host "Plugin folder:   $PluginRoot"

if (-not (Test-Path -LiteralPath $LmsHome)) {
    Write-Error "$LmsHome does not exist. Start LM Studio once so it creates its home folder, then re-run."
}

if ($Uninstall) {
    foreach ($plugin in $Plugins) {
        $target = Join-Path $PluginRoot $plugin
        if (Test-Path -LiteralPath $target) {
            Remove-Item -LiteralPath $target -Recurse -Force
            Write-Host "removed $target"
        } else {
            Write-Host "not installed: $plugin"
        }
    }
    Write-Host ""
    Write-Host "Done. Restart LM Studio."
    exit 0
}

New-Item -ItemType Directory -Force -Path $PluginRoot | Out-Null

foreach ($plugin in $Plugins) {
    $src = Join-Path $SourceDir $plugin
    $target = Join-Path $PluginRoot $plugin

    if (-not (Test-Path -LiteralPath (Join-Path $src "manifest.json"))) {
        Write-Error "$src\manifest.json not found"
    }

    # Replace rather than merge, so a renamed or deleted source file cannot
    # linger at the target and get loaded.
    if (Test-Path -LiteralPath $target) {
        Write-Host "replacing existing $plugin"
        Remove-Item -LiteralPath $target -Recurse -Force
    }

    if ($Link) {
        # Requires Developer Mode or an elevated shell.
        New-Item -ItemType SymbolicLink -Path $target -Target $src | Out-Null
        Write-Host "linked  $plugin -> $src"
        $installDir = $src
    } else {
        New-Item -ItemType Directory -Force -Path $target | Out-Null
        Get-ChildItem -LiteralPath $src -Force |
            Where-Object { $_.Name -notin @("node_modules", ".lmstudio") } |
            ForEach-Object {
                Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force
            }
        Get-ChildItem -LiteralPath (Join-Path $target "src") -Filter "*.test.ts" -ErrorAction SilentlyContinue |
            Remove-Item -Force
        Write-Host "copied  $plugin"
        $installDir = $target
    }

    if (Get-Command npm -ErrorAction SilentlyContinue) {
        Write-Host "        installing dependencies..."
        Push-Location $installDir
        try {
            npm install --silent --no-audit --no-fund --omit=dev
        } finally {
            Pop-Location
        }
    } else {
        Write-Host "        npm not found on PATH; LM Studio will install dependencies itself"
    }
}

$template = Join-Path $SourceDir "regescore\templates\regescore_fable5.jinja"
Write-Host ""
Write-Host "Installed. Restart LM Studio."
Write-Host ""
Write-Host "Next steps"
Write-Host "  1. Plugin list      enable 'regescore' and configure the doctrine trigger."
Write-Host "  2. Model dropdown   'regescore-gateway' appears there; point it at your endpoint."
Write-Host "  3. Chat template    plugins cannot set a model's Jinja template. Open"
Write-Host "                      My Models > your model > Prompt Template and paste:"
Write-Host "                      $template"
Write-Host ""
Write-Host "For the Claude Code failures this ships with, also set:"
Write-Host '  setx CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS 1'
Write-Host '  setx CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING 1'
Write-Host ""
Write-Host "RegesCore // Fable 5 - davidio.dev"
