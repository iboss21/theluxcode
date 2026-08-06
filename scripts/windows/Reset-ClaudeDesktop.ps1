<#
.SYNOPSIS
    Resets Claude Desktop and Claude Code to factory state, with a backup.

.DESCRIPTION
    Report-only by default. Nothing is deleted or changed until you pass -Fix,
    and everything removed is copied to a timestamped backup folder first.

    Read this before running it, because "reset everything" spans four kinds of
    state and you almost never want all four:

      Environment variables   ANTHROPIC_*, CLAUDE_*, and the token/limit knobs.
                              This is the tier that usually causes the problem.
                              A stale ANTHROPIC_BASE_URL pointing at a proxy
                              that is not running makes every request fail with
                              ConnectionRefused - including requests to the real
                              API - because the client dials the override, not
                              the default.

      Settings                ~/.claude/settings.json, settings.local.json,
                              ~/.claude.json, and the desktop app's config.
                              Safe to clear; you lose preferences and MCP
                              server definitions.

      History                 ~/.claude/projects, sessions, todos,
                              shell-snapshots. Safe to clear; you lose past
                              conversations and resumable sessions.

      Credentials             The saved login. Clearing it signs you out and
                              you must log in again. NOT touched unless you
                              pass -IncludeCredentials, because signing out is
                              rarely what "reset my settings" means and it is
                              the one step you cannot undo from the backup.

    Order matters: environment variables are cleared last, so if the script
    fails partway the overrides that let you diagnose it are still in place.

.PARAMETER Fix
    Actually perform the reset. Without it, nothing is written.

.PARAMETER Scope
    Which tiers to reset: Env, Settings, History, All. Default All.
    Credentials are never included here - use -IncludeCredentials.

.PARAMETER IncludeCredentials
    Also clear the saved login. You will have to sign in again.

.PARAMETER BackupPath
    Where to copy what is removed. Defaults to a timestamped folder on the
    Desktop.

.EXAMPLE
    .\Reset-ClaudeDesktop.ps1
    Report what exists and what would be removed. Changes nothing.

.EXAMPLE
    .\Reset-ClaudeDesktop.ps1 -Scope Env -Fix
    Clear only the environment overrides - the usual fix for ConnectionRefused.

.EXAMPLE
    .\Reset-ClaudeDesktop.ps1 -Fix
    Full reset of settings, history and environment. Keeps you signed in.

.NOTES
    RegesCore // Fable 5 - brand and engineering by davidio.dev
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$Fix,
    [ValidateSet('Env', 'Settings', 'History', 'All')][string[]]$Scope = @('All'),
    [switch]$IncludeCredentials,
    [string]$BackupPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$doEnv = $Scope -contains 'All' -or $Scope -contains 'Env'
$doSettings = $Scope -contains 'All' -or $Scope -contains 'Settings'
$doHistory = $Scope -contains 'All' -or $Scope -contains 'History'

if (-not $BackupPath) {
    # GetFolderPath returns an empty string when the shell folder is not
    # registered - a redirected or OneDrive-managed Desktop does this - and
    # Join-Path then throws on the empty root. Fall back to the profile.
    $desk = [Environment]::GetFolderPath('Desktop')
    if ([string]::IsNullOrWhiteSpace($desk)) {
        $desk = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
    }
    $BackupPath = Join-Path $desk ('claude-reset-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
}

# Names the clients read. Grouped so the report says why each one matters.
$ENV_NAMES = @(
    # The overrides that break everything when stale.
    'ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_CUSTOM_HEADERS', 'ANTHROPIC_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL',
    'ANTHROPIC_BETAS', 'ANTHROPIC_CUSTOM_MODEL_OPTION',
    # Context and output limits.
    'CLAUDE_CODE_MAX_CONTEXT_TOKENS', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
    'CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'MAX_THINKING_TOKENS',
    'MAX_MCP_OUTPUT_TOKENS', 'BASH_MAX_OUTPUT_LENGTH',
    'DISABLE_AUTO_COMPACT', 'DISABLE_COMPACT',
    # Behaviour toggles.
    'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS', 'CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING',
    'CLAUDE_CODE_DISABLE_THINKING', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_SUBAGENT_MODEL',
    'CLAUDE_CODE_EFFORT_LEVEL', 'CLAUDE_CODE_MAX_TURNS', 'CLAUDE_CODE_MAX_RETRIES',
    'CLAUDE_CODE_EXTRA_BODY', 'CLAUDE_CODE_ATTRIBUTION_HEADER',
    'API_TIMEOUT_MS', 'MCP_TIMEOUT', 'MCP_TOOL_TIMEOUT',
    'DISABLE_TELEMETRY', 'DISABLE_ERROR_REPORTING', 'DISABLE_AUTOUPDATER'
)

$home_ = $env:USERPROFILE
$SETTINGS_PATHS = @(
    (Join-Path $home_ '.claude\settings.json'),
    (Join-Path $home_ '.claude\settings.local.json'),
    (Join-Path $home_ '.claude.json'),
    (Join-Path $home_ '.claude.json.backup'),
    (Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'),
    (Join-Path $env:APPDATA 'Claude\config.json')
)
$HISTORY_PATHS = @(
    (Join-Path $home_ '.claude\projects'),
    (Join-Path $home_ '.claude\sessions'),
    (Join-Path $home_ '.claude\todos'),
    (Join-Path $home_ '.claude\shell-snapshots'),
    (Join-Path $home_ '.claude\statsig'),
    (Join-Path $home_ '.claude\history.jsonl'),
    (Join-Path $env:APPDATA 'Claude\Cache'),
    (Join-Path $env:APPDATA 'Claude\Code Cache'),
    (Join-Path $env:APPDATA 'Claude\GPUCache'),
    (Join-Path $env:APPDATA 'Claude\Local Storage'),
    (Join-Path $env:APPDATA 'Claude\Session Storage'),
    (Join-Path $env:APPDATA 'Claude\IndexedDB')
)

function Write-Head { param([string]$T) Write-Host ''; Write-Host $T -ForegroundColor Cyan
    Write-Host ('-' * $T.Length) -ForegroundColor DarkGray }

function Save-Copy {
    <#  Backup before removal. A reset with no way back is not a reset, it is
        a data loss event with a friendly name. #>
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Kind)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $rel = $Path -replace '^[A-Za-z]:\\', '' -replace '[:\\]', '_'
    $dest = Join-Path (Join-Path $BackupPath $Kind) $rel
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
    Copy-Item -LiteralPath $Path -Destination $dest -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'Claude reset - davidio.dev' -ForegroundColor Cyan
Write-Host "  mode   : $(if ($Fix) { 'APPLY' } else { 'report only' })" -ForegroundColor $(if ($Fix) { 'Yellow' } else { 'Gray' })
Write-Host "  scope  : $($Scope -join ', ')$(if ($IncludeCredentials) { ' + credentials' })"
Write-Host "  backup : $BackupPath"

# -- running processes --------------------------------------------------
# A running client rewrites its settings on exit, so a reset applied
# underneath one is silently undone the moment it closes.
Write-Head 'Running Claude processes'
$procs = @(Get-Process -Name 'Claude', 'claude' -ErrorAction SilentlyContinue)
if ($procs.Count -eq 0) { Write-Host '  none running' -ForegroundColor Green }
else {
    foreach ($p in $procs) { Write-Host "  $($p.ProcessName) (pid $($p.Id))" -ForegroundColor Yellow }
    Write-Host '  Close these first. A running client rewrites its settings on' -ForegroundColor Yellow
    Write-Host '  exit and would undo this reset.' -ForegroundColor Yellow
}

# -- environment --------------------------------------------------------
Write-Head 'Environment overrides'
$found = @()
foreach ($name in $ENV_NAMES) {
    foreach ($target in @('Process', 'User', 'Machine')) {
        $value = $null
        try { $value = [Environment]::GetEnvironmentVariable($name, $target) } catch { continue }
        if ($null -ne $value -and "$value".Trim().Length -gt 0) {
            $found += [pscustomobject]@{ Scope = $target; Name = $name; Value = "$value" }
        }
    }
}
if ($found.Count -eq 0) { Write-Host '  none set' -ForegroundColor Green }
else {
    $found | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
    $base = @($found | Where-Object { $_.Name -eq 'ANTHROPIC_BASE_URL' })
    if ($base.Count -gt 0) {
        Write-Host '  ANTHROPIC_BASE_URL is set. Every request goes there instead of' -ForegroundColor Yellow
        Write-Host '  the real API, so if nothing is listening you get' -ForegroundColor Yellow
        Write-Host '  ConnectionRefused on every message. This is the single most' -ForegroundColor Yellow
        Write-Host '  likely cause of a client that cannot connect at all.' -ForegroundColor Yellow
    }
}

# -- files --------------------------------------------------------------
function Show-Paths {
    param([Parameter(Mandatory)][string[]]$Paths, [Parameter(Mandatory)][string]$Kind)
    $hits = @()
    foreach ($p in $Paths) {
        if (-not (Test-Path -LiteralPath $p)) { continue }
        $item = Get-Item -LiteralPath $p -ErrorAction SilentlyContinue
        if (-not $item) { continue }
        # An empty directory makes Measure-Object emit nothing at all, and
        # reading .Sum off that throws under StrictMode. An empty cache folder
        # is exactly the normal case, so this has to be guarded rather than
        # assumed non-empty.
        $size = 0
        if ($item.PSIsContainer) {
            $measured = Get-ChildItem -LiteralPath $p -Recurse -File -ErrorAction SilentlyContinue |
                Measure-Object -Property Length -Sum
            if ($null -ne $measured -and $null -ne $measured.Sum) { $size = $measured.Sum }
        } else {
            $size = $item.Length
        }
        $hits += [pscustomobject]@{ KB = [int]($size / 1KB); Path = $p }
    }
    if ($hits.Count -eq 0) { Write-Host '  nothing present' -ForegroundColor Green; return @() }
    $hits | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
    return @($hits | Select-Object -ExpandProperty Path)
}

$settingsHits = @()
if ($doSettings) { Write-Head 'Settings'; $settingsHits = Show-Paths -Paths $SETTINGS_PATHS -Kind 'settings' }

$historyHits = @()
if ($doHistory) { Write-Head 'History and caches'; $historyHits = Show-Paths -Paths $HISTORY_PATHS -Kind 'history' }

# -- credentials --------------------------------------------------------
Write-Head 'Credentials'
$credTargets = @()
try {
    $raw = cmdkey /list 2>$null | Out-String
    $credTargets = @([regex]::Matches($raw, 'Target:\s*(\S*(?i:claude|anthropic)\S*)') |
        ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
} catch { }
$credFile = Join-Path $home_ '.claude\.credentials.json'
if (Test-Path -LiteralPath $credFile) { $credTargets += $credFile }

if ($credTargets.Count -eq 0) { Write-Host '  none found' }
else {
    foreach ($t in $credTargets) { Write-Host "  $t" }
    Write-Host $(if ($IncludeCredentials) {
        '  WILL BE CLEARED - you will have to sign in again.'
    } else {
        '  kept. Pass -IncludeCredentials to clear and sign out.'
    }) -ForegroundColor $(if ($IncludeCredentials) { 'Yellow' } else { 'DarkGray' })
}

if (-not $Fix) {
    Write-Head 'Nothing changed'
    Write-Host '  Add -Fix to apply. Start narrow:' -ForegroundColor Cyan
    Write-Host '    .\Reset-ClaudeDesktop.ps1 -Scope Env -Fix' -ForegroundColor DarkGray
    Write-Host '  That clears only the overrides, which fixes ConnectionRefused' -ForegroundColor Cyan
    Write-Host '  without losing a single conversation.' -ForegroundColor Cyan
    Write-Host ''
    exit 0
}

# -- apply --------------------------------------------------------------
Write-Head 'Applying'
New-Item -ItemType Directory -Force -Path $BackupPath | Out-Null

foreach ($p in @($settingsHits) + @($historyHits)) {
    $kind = if ($settingsHits -contains $p) { 'settings' } else { 'history' }
    if (-not $PSCmdlet.ShouldProcess($p, 'back up and remove')) { continue }
    Save-Copy -Path $p -Kind $kind
    try {
        Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction Stop
        Write-Host "  removed  $p" -ForegroundColor Green
    } catch {
        Write-Host "  LOCKED   $p - $($_.Exception.Message)" -ForegroundColor Red
    }
}

if ($IncludeCredentials) {
    foreach ($t in $credTargets) {
        if (-not $PSCmdlet.ShouldProcess($t, 'clear credential')) { continue }
        if (Test-Path -LiteralPath $t) {
            Save-Copy -Path $t -Kind 'credentials'
            Remove-Item -LiteralPath $t -Force -ErrorAction SilentlyContinue
            Write-Host "  removed  $t" -ForegroundColor Green
        } else {
            cmdkey /delete:$t 2>$null | Out-Null
            Write-Host "  cleared  $t" -ForegroundColor Green
        }
    }
}

# Last, deliberately: if anything above failed, the overrides that let you
# diagnose it are still in place.
if ($doEnv) {
    $record = Join-Path $BackupPath 'environment.json'
    $found | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $record -Encoding UTF8
    foreach ($e in $found) {
        if ($e.Scope -eq 'Process') { continue }   # dies with this shell anyway
        if (-not $PSCmdlet.ShouldProcess("$($e.Scope):$($e.Name)", 'clear')) { continue }
        try {
            [Environment]::SetEnvironmentVariable($e.Name, $null, $e.Scope)
            Write-Host "  cleared  $($e.Scope) $($e.Name)" -ForegroundColor Green
        } catch {
            Write-Host "  FAILED   $($e.Scope) $($e.Name) - needs an elevated shell" -ForegroundColor Red
        }
    }
}

Write-Head 'Done'
Write-Host "  backup : $BackupPath"
Write-Host '  Open a NEW terminal - this one still holds the old variables.' -ForegroundColor Cyan
Write-Host '  To restore a setting, copy it back from the backup folder;' -ForegroundColor DarkGray
Write-Host '  environment.json records every variable and its old value.' -ForegroundColor DarkGray
Write-Host ''
Write-Host '  RegesCore // Fable 5 - davidio.dev' -ForegroundColor DarkGray
Write-Host ''
