<#
.SYNOPSIS
    Finds every place Claude Code's context window is capped, and reports the
    value it will actually use.

.DESCRIPTION
    The /context panel showing a smaller window than your model supports - 100k
    when the model is loaded with far more - is almost never the model. It is a
    cap applied by one of five layers, and the panel does not say which.

    This reproduces Claude Code's own resolution order, verified against the
    2.1.220 binary, and reports the winner. Two functions decide it.

    The raw window:
      1. DISABLE_COMPACT set AND CLAUDE_CODE_MAX_CONTEXT_TOKENS > 0
         -> that value, verbatim and unclamped. The only way above 200000.
      2. a model id ending in [1m]                          -> 1000000
      3. CLAUDE_CODE_MAX_CONTEXT_TOKENS > 0, but ONLY when the model id does
         not start with "claude-". A gateway model named claude-anything is
         silently excluded from this branch, which is the trap most local
         setups fall into.
      4. otherwise                                          -> 200000

    Then the auto-compact cap, applied as min(raw, cap):
      1. env CLAUDE_CODE_AUTO_COMPACT_WINDOW - floored at 100000, ceilinged at
         1000000. Any value at or below 100000 lands on exactly 100000, which
         is the usual source of a 100k window on every model.
      2. settings.json autoCompactWindow     - applied with no floor.
      3. first-party server data and experiments (not reachable through a
         custom base URL).
      4. claude-sonnet-4-6, claude-opus-4-6, claude-opus-4-8, claude-opus-5
                                             -> capped at 200000.
      5. otherwise                           -> the raw window, uncapped.

    Max output tokens is separate: an unrecognised model gets a default of
    32000 and a hard ceiling of 128000. CLAUDE_CODE_MAX_OUTPUT_TOKENS raises
    the default but is capped at the ceiling.

    Every layer is searched: the Process, User and Machine environment, and
    the env blocks and autoCompactWindow keys of every settings file Claude
    Code reads.

.PARAMETER ModelId
    The model id to resolve for. Defaults to $env:ANTHROPIC_MODEL. The
    "claude-" prefix rule above makes this matter.

.PARAMETER ProjectPath
    Project root whose .claude settings are read. Defaults to the current
    directory.

.PARAMETER ServerUrl
    Optional LM Studio root. When given, the loaded context length is read
    from /api/v0/models so the report can flag a window larger than the model
    is actually loaded with - which produces overflow errors rather than a
    bigger window.

.PARAMETER Window
    With -Fix, the context window to configure, in tokens.

.PARAMETER Fix
    Apply the change. Without it, nothing is written.

.PARAMETER Scope
    Which environment to write to with -Fix: User (default) or Machine.
    Machine needs an elevated shell.

.EXAMPLE
    .\Get-ClaudeContextWindow.ps1
    Report only. Shows every cap and which one wins.

.EXAMPLE
    .\Get-ClaudeContextWindow.ps1 -ModelId 'claude-fable-5.0-rg35bmoe' -ServerUrl http://127.0.0.1:2126
    Resolve for a specific model and cross-check against the loaded context length.

.EXAMPLE
    .\Get-ClaudeContextWindow.ps1 -Window 200000 -Fix
    Raise the window to 200000, keeping auto-compaction enabled.

.EXAMPLE
    .\Get-ClaudeContextWindow.ps1 -Window 262144 -Fix
    Above 200000, which requires disabling auto-compaction. The script says so
    before doing it.

.NOTES
    RegesCore // Fable 5 - brand and engineering by davidio.dev
    https://davidio.dev
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [AllowEmptyString()][string]$ModelId = $env:ANTHROPIC_MODEL,
    [string]$ProjectPath = (Get-Location).Path,
    [AllowEmptyString()][string]$ServerUrl = '',
    [int]$Window = 0,
    [switch]$Fix,
    [ValidateSet('User', 'Machine')][string]$Scope = 'User'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Constants read out of the Claude Code 2.1.220 binary. Named after what they
# mean, with the identifier they carry in the bundle, so a future version can
# be diffed against this.
$DEFAULT_WINDOW      = 200000   # ber
$MODEL_DEFAULT_CAP   = 200000   # gxe
$COMPACT_WINDOW_MIN  = 100000   # _fo  - the floor that produces a 100k window
$COMPACT_WINDOW_MAX  = 1000000  # Nds
$OUTPUT_DEFAULT      = 32000    # Mxg
$OUTPUT_CEILING      = 128000   # Oxg
$CAPPED_AT_200K = @(
    'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-opus-4-8', 'claude-opus-5'
)

$KNOBS = @(
    'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
    'CLAUDE_CODE_MAX_CONTEXT_TOKENS',
    'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
    'DISABLE_COMPACT',
    'DISABLE_AUTO_COMPACT',
    'MAX_THINKING_TOKENS'
)

function Write-Section {
    param([Parameter(Mandatory)][string]$Text)
    Write-Host ''
    Write-Host $Text -ForegroundColor Cyan
    Write-Host ('-' * $Text.Length) -ForegroundColor DarkGray
}

function Show-Table {
    param($Rows)
    $list = @($Rows)
    if ($list.Count -eq 0) { return }
    # Format-Table into the host directly; piping it away prints blanks.
    $list | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
}

function Get-EnvLayer {
    <#  Reads one environment scope, tolerating non-Windows where the User and
        Machine scopes do not exist. Returns a hashtable of the knobs found. #>
    param([Parameter(Mandatory)][string]$Target)
    $found = @{}
    foreach ($name in $KNOBS) {
        $value = $null
        try {
            $value = [Environment]::GetEnvironmentVariable($name, $Target)
        } catch {
            return $null   # scope unavailable on this platform
        }
        if ($null -ne $value -and "$value".Trim().Length -gt 0) {
            $found[$name] = "$value"
        }
    }
    return $found
}

function Get-SettingsFiles {
    param([Parameter(Mandatory)][string]$Project)
    $home_ = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
    $programData = if ($env:ProgramData) { $env:ProgramData } else { '/etc' }
    # Highest precedence first, matching Claude Code's own merge order.
    return @(
        [pscustomobject]@{ Precedence = 1; Kind = 'managed'; Path = (Join-Path $programData 'ClaudeCode/managed-settings.json') }
        [pscustomobject]@{ Precedence = 2; Kind = 'project local'; Path = (Join-Path $Project '.claude/settings.local.json') }
        [pscustomobject]@{ Precedence = 3; Kind = 'project'; Path = (Join-Path $Project '.claude/settings.json') }
        [pscustomobject]@{ Precedence = 4; Kind = 'user'; Path = (Join-Path $home_ '.claude/settings.json') }
        [pscustomobject]@{ Precedence = 5; Kind = 'user legacy'; Path = (Join-Path $home_ '.claude.json') }
    )
}

function Read-SettingsFindings {
    <#  Every relevant key in one settings file: autoCompactWindow and
        autoCompactEnabled at the top level, plus any knob inside its env
        block, which sets the same variables as the real environment. #>
    param([Parameter(Mandatory)]$File)
    $hits = @()
    if (-not (Test-Path -LiteralPath $File.Path)) { return $hits }

    $json = $null
    try {
        $json = Get-Content -LiteralPath $File.Path -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        $hits += [pscustomobject]@{
            Source = $File.Kind; Path = $File.Path; Key = '(unparseable)'
            Value = $_.Exception.Message; Precedence = $File.Precedence
        }
        return $hits
    }
    if ($null -eq $json) { return $hits }

    $names = @()
    if ($json.PSObject) { $names = @($json.PSObject.Properties | ForEach-Object { $_.Name }) }

    foreach ($key in @('autoCompactWindow', 'autoCompactEnabled')) {
        if ($names -contains $key) {
            $hits += [pscustomobject]@{
                Source = $File.Kind; Path = $File.Path; Key = $key
                Value = "$($json.$key)"; Precedence = $File.Precedence
            }
        }
    }

    if ($names -contains 'env' -and $null -ne $json.env -and $json.env.PSObject) {
        $envNames = @($json.env.PSObject.Properties | ForEach-Object { $_.Name })
        foreach ($name in $KNOBS) {
            if ($envNames -contains $name) {
                $hits += [pscustomobject]@{
                    Source = $File.Kind; Path = $File.Path; Key = "env.$name"
                    Value = "$($json.env.$name)"; Precedence = $File.Precedence
                }
            }
        }
    }
    # Returned bare; every call site wraps in @() so a single hit still counts.
    return $hits
}

function Resolve-Int {
    param([AllowNull()]$Value)
    if ($null -eq $Value) { return $null }
    $parsed = 0
    if ([int]::TryParse("$Value".Trim(), [ref]$parsed)) { return $parsed }
    return $null
}

function Get-RawWindow {
    <#  Claude Code's Xv() / mZc(). Returns the window before the compact cap. #>
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Model, [Parameter(Mandatory)][hashtable]$Env)

    $maxContext = Resolve-Int $Env['CLAUDE_CODE_MAX_CONTEXT_TOKENS']
    $compactOff = $Env.ContainsKey('DISABLE_COMPACT') -and
                  $Env['DISABLE_COMPACT'] -notin @('0', 'false', '')

    if ($compactOff -and $null -ne $maxContext -and $maxContext -gt 0) {
        return [pscustomobject]@{
            Value = $maxContext
            Source = 'DISABLE_COMPACT + CLAUDE_CODE_MAX_CONTEXT_TOKENS (unclamped)'
        }
    }
    if ($Model -match '\[1m\]$') {
        return [pscustomobject]@{ Value = 1000000; Source = 'the [1m] model suffix' }
    }
    if ($null -ne $maxContext -and $maxContext -gt 0) {
        if ($Model.ToLowerInvariant().StartsWith('claude-')) {
            return [pscustomobject]@{
                Value = $DEFAULT_WINDOW
                Source = "built-in default; CLAUDE_CODE_MAX_CONTEXT_TOKENS=$maxContext IGNORED because the model id starts with 'claude-'"
            }
        }
        return [pscustomobject]@{ Value = $maxContext; Source = 'CLAUDE_CODE_MAX_CONTEXT_TOKENS' }
    }
    return [pscustomobject]@{ Value = $DEFAULT_WINDOW; Source = 'built-in default' }
}

function Get-CompactWindow {
    <#  Claude Code's o7(). Returns the number the /context panel prints. #>
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$Model,
        [Parameter(Mandatory)][hashtable]$Env,
        [Parameter(Mandatory)][int]$Raw,
        [AllowNull()]$SettingsWindow,
        [AllowEmptyString()][string]$SettingsPath = ''
    )

    if ($Env.ContainsKey('CLAUDE_CODE_AUTO_COMPACT_WINDOW')) {
        $raw = $Env['CLAUDE_CODE_AUTO_COMPACT_WINDOW']
        $parsed = Resolve-Int $raw
        $note = ''
        if ($null -eq $parsed -or $parsed -le 0) {
            $parsed = $COMPACT_WINDOW_MIN
            $note = " (invalid '$raw', fell back to $COMPACT_WINDOW_MIN)"
        } elseif ($parsed -gt $COMPACT_WINDOW_MAX) {
            $note = " (capped from $parsed to $COMPACT_WINDOW_MAX)"
            $parsed = $COMPACT_WINDOW_MAX
        }
        $effective = [Math]::Max($COMPACT_WINDOW_MIN, $parsed)
        if ($effective -ne $parsed) { $note += " (floored up to $COMPACT_WINDOW_MIN)" }
        return [pscustomobject]@{
            Value = [Math]::Min($Raw, $effective)
            Source = "env CLAUDE_CODE_AUTO_COMPACT_WINDOW$note"
        }
    }

    $fromSettings = Resolve-Int $SettingsWindow
    if ($null -ne $fromSettings) {
        return [pscustomobject]@{
            Value = [Math]::Min($Raw, $fromSettings)
            Source = "autoCompactWindow in $SettingsPath"
        }
    }

    if ($Raw -lt 1000000 -and ($CAPPED_AT_200K -contains $Model.ToLowerInvariant())) {
        return [pscustomobject]@{
            Value = [Math]::Min($Raw, $MODEL_DEFAULT_CAP)
            Source = "per-model default cap for $Model"
        }
    }
    return [pscustomobject]@{ Value = $Raw; Source = 'no cap applied' }
}

function Get-MaxOutput {
    param([Parameter(Mandatory)][hashtable]$Env)
    $configured = Resolve-Int $Env['CLAUDE_CODE_MAX_OUTPUT_TOKENS']
    if ($null -eq $configured -or $configured -le 0) {
        return [pscustomobject]@{
            Value = $OUTPUT_DEFAULT
            Source = "built-in default for an unrecognised model (ceiling $OUTPUT_CEILING)"
        }
    }
    if ($configured -gt $OUTPUT_CEILING) {
        return [pscustomobject]@{
            Value = $OUTPUT_CEILING
            Source = "CLAUDE_CODE_MAX_OUTPUT_TOKENS=$configured capped at the $OUTPUT_CEILING ceiling"
        }
    }
    return [pscustomobject]@{ Value = $configured; Source = 'CLAUDE_CODE_MAX_OUTPUT_TOKENS' }
}

function Get-LoadedContextLength {
    <#  LM Studio's native REST API reports the length the model is actually
        loaded with, which is the real ceiling regardless of what the client
        believes. Field names vary by build, so match loosely. #>
    param([Parameter(Mandatory)][string]$Root)
    $uri = ($Root.TrimEnd('/')) + '/api/v0/models'
    try {
        $response = Invoke-RestMethod -Uri $uri -TimeoutSec 20
    } catch {
        Write-Host "  could not read $uri - $($_.Exception.Message)" -ForegroundColor DarkGray
        return $null
    }
    $models = if ($response.PSObject.Properties.Name -contains 'data') { $response.data } else { $response }
    $rows = @()
    foreach ($model in @($models)) {
        if ($null -eq $model -or -not $model.PSObject) { continue }
        $names = @($model.PSObject.Properties | ForEach-Object { $_.Name })
        $row = [ordered]@{ id = if ($names -contains 'id') { $model.id } else { '?' } }
        foreach ($field in @('state', 'loaded_context_length', 'max_context_length')) {
            if ($names -contains $field) { $row[$field] = $model.$field }
        }
        $rows += [pscustomobject]$row
    }
    return $rows
}

# =====================================================================
# Report
# =====================================================================

Write-Host ''
Write-Host 'Claude Code context window resolver - davidio.dev' -ForegroundColor Cyan
if (-not $ModelId) {
    Write-Host '  model    : (ANTHROPIC_MODEL is not set; pass -ModelId)' -ForegroundColor Yellow
} else {
    Write-Host "  model    : $ModelId"
}
Write-Host "  project  : $ProjectPath"

# -- 1. Environment ----------------------------------------------------
Write-Section 'Environment variables'
$layers = [ordered]@{}
foreach ($target in @('Process', 'User', 'Machine')) {
    $layer = Get-EnvLayer -Target $target
    if ($null -eq $layer) {
        Write-Host "  $target scope is not available on this platform" -ForegroundColor DarkGray
        continue
    }
    $layers[$target] = $layer
}

$envRows = @()
foreach ($target in $layers.Keys) {
    foreach ($name in $layers[$target].Keys) {
        $envRows += [pscustomobject]@{
            Scope = $target; Variable = $name; Value = $layers[$target][$name]
        }
    }
}
if ($envRows.Count -eq 0) {
    Write-Host '  none of the context or output knobs are set in the environment'
} else {
    Show-Table $envRows
}

# Process wins at runtime, so that is the layer Claude Code sees.
$effectiveEnv = @{}
foreach ($target in @('Machine', 'User', 'Process')) {
    if (-not $layers.Contains($target)) { continue }
    foreach ($name in $layers[$target].Keys) { $effectiveEnv[$name] = $layers[$target][$name] }
}

# -- 2. Settings files -------------------------------------------------
Write-Section 'Settings files'
$files = Get-SettingsFiles -Project $ProjectPath
$settingsHits = @()
foreach ($file in $files) {
    $exists = Test-Path -LiteralPath $file.Path
    $mark = if ($exists) { ' ' } else { '-' }
    Write-Host "  $mark $($file.Kind.PadRight(13)) $($file.Path)" -ForegroundColor $(if ($exists) { 'Gray' } else { 'DarkGray' })
    if ($exists) { $settingsHits += @(Read-SettingsFindings -File $file) }
}

Write-Host ''
if ($settingsHits.Count -eq 0) {
    Write-Host '  no context or output keys found in any settings file'
} else {
    Show-Table ($settingsHits | Sort-Object Precedence | Select-Object Source, Key, Value, Path)
    # A settings env block sets the same variables, at lower precedence than a
    # real environment variable of the same name.
    foreach ($hit in ($settingsHits | Sort-Object -Property Precedence -Descending)) {
        if ($hit.Key -like 'env.*') {
            $name = $hit.Key.Substring(4)
            if (-not $effectiveEnv.ContainsKey($name)) { $effectiveEnv[$name] = $hit.Value }
        }
    }
}

$settingsWindow = $null
$settingsWindowPath = ''
foreach ($hit in ($settingsHits | Where-Object { $_.Key -eq 'autoCompactWindow' } | Sort-Object Precedence)) {
    if ($null -eq $settingsWindow) { $settingsWindow = $hit.Value; $settingsWindowPath = $hit.Path }
}

# -- 3. Resolve --------------------------------------------------------
Write-Section 'Resolved'
$raw = Get-RawWindow -Model $ModelId -Env $effectiveEnv
$compact = Get-CompactWindow -Model $ModelId -Env $effectiveEnv -Raw $raw.Value `
    -SettingsWindow $settingsWindow -SettingsPath $settingsWindowPath
$output = Get-MaxOutput -Env $effectiveEnv

Write-Host ("  raw context window   : {0,9:N0}   {1}" -f $raw.Value, $raw.Source)
Write-Host ("  window /context shows: {0,9:N0}   {1}" -f $compact.Value, $compact.Source) -ForegroundColor $(
    if ($compact.Value -lt $raw.Value) { 'Yellow' } else { 'Green' })
Write-Host ("  max output tokens    : {0,9:N0}   {1}" -f $output.Value, $output.Source)

if ($raw.Source -like '*IGNORED*') {
    Write-Host ''
    Write-Host '  CLAUDE_CODE_MAX_CONTEXT_TOKENS is being discarded.' -ForegroundColor Yellow
    Write-Host '  It only applies when the model id does NOT start with "claude-".' -ForegroundColor Yellow
    Write-Host '  Either rename the model in LM Studio, or set DISABLE_COMPACT=1' -ForegroundColor Yellow
    Write-Host '  alongside it, which takes an earlier branch and skips the check.' -ForegroundColor Yellow
}

# -- 4. Cross-check against the server ---------------------------------
if ($ServerUrl) {
    Write-Section 'What the server actually has loaded'
    $loaded = Get-LoadedContextLength -Root $ServerUrl
    if ($loaded) {
        Show-Table $loaded
        $lengths = @($loaded | ForEach-Object {
            if ($_.PSObject.Properties.Name -contains 'loaded_context_length') { $_.loaded_context_length }
        } | Where-Object { $_ -is [int] -and $_ -gt 0 })
        if ($lengths.Count -gt 0) {
            $smallest = ($lengths | Measure-Object -Minimum).Minimum
            if ($compact.Value -gt $smallest) {
                Write-Host ("  The client believes it has {0:N0} tokens but the model is loaded with {1:N0}." -f $compact.Value, $smallest) -ForegroundColor Yellow
                Write-Host '  Raising the client past the loaded length produces overflow errors,' -ForegroundColor Yellow
                Write-Host '  not a bigger window. Raise the context length in LM Studio first.' -ForegroundColor Yellow
            } else {
                Write-Host ("  Consistent: the loaded length ({0:N0}) is at least the client window." -f $smallest) -ForegroundColor Green
            }
        }
    }
}

# -- 5. Fix ------------------------------------------------------------
if ($Window -le 0) {
    Write-Section 'To change it'
    Write-Host @"
  Re-run with -Window N -Fix. The script picks the right combination:

    at or below $DEFAULT_WINDOW tokens
        CLAUDE_CODE_AUTO_COMPACT_WINDOW=N, and any lower cap removed.
        Auto-compaction keeps working.

    above $DEFAULT_WINDOW tokens
        The $DEFAULT_WINDOW built-in default has to be replaced, and the only
        branch that does that also requires DISABLE_COMPACT=1. Auto-compaction
        stops, so a long session will hit a hard context error instead of
        compacting. The script will say so before writing.

  Note the floor: CLAUDE_CODE_AUTO_COMPACT_WINDOW is raised to $COMPACT_WINDOW_MIN if you
  set it lower, which is why a too-small value shows up as exactly 100k.
"@
    exit 0
}

Write-Section "Configuring a $Window token window"
$plan = @{}
if ($Window -le $DEFAULT_WINDOW) {
    $plan['CLAUDE_CODE_AUTO_COMPACT_WINDOW'] = "$Window"
    $plan['CLAUDE_CODE_MAX_CONTEXT_TOKENS'] = $null
    Write-Host "  Auto-compaction stays enabled."
} else {
    $plan['CLAUDE_CODE_MAX_CONTEXT_TOKENS'] = "$Window"
    $plan['DISABLE_COMPACT'] = '1'
    $plan['CLAUDE_CODE_AUTO_COMPACT_WINDOW'] = $null
    Write-Host "  $Window is above the $DEFAULT_WINDOW built-in default, so this also sets" -ForegroundColor Yellow
    Write-Host "  DISABLE_COMPACT=1. Auto-compaction will stop: a session that fills the" -ForegroundColor Yellow
    Write-Host "  window will fail rather than compact. That is the documented tradeoff." -ForegroundColor Yellow
}

if ($Window -gt $COMPACT_WINDOW_MAX) {
    Write-Host "  WARNING: $Window is above the $COMPACT_WINDOW_MAX ceiling Claude Code enforces elsewhere." -ForegroundColor Yellow
}

Write-Host ''
foreach ($name in $plan.Keys) {
    $value = $plan[$name]
    if ($null -eq $value) { Write-Host "  remove $name (from the $Scope scope)" }
    else { Write-Host "  set    $name = $value (in the $Scope scope)" }
}

if (-not $Fix) {
    Write-Host ''
    Write-Host '  Report only. Add -Fix to apply.' -ForegroundColor Yellow
    exit 0
}

foreach ($name in $plan.Keys) {
    $value = $plan[$name]
    $action = if ($null -eq $value) { "remove $name" } else { "set $name=$value" }
    if (-not $PSCmdlet.ShouldProcess("$Scope environment", $action)) { continue }
    try {
        [Environment]::SetEnvironmentVariable($name, $value, $Scope)
        Write-Host "  applied: $action" -ForegroundColor Green
    } catch {
        Write-Host "  FAILED: $action - $($_.Exception.Message)" -ForegroundColor Red
        if ($Scope -eq 'Machine') {
            Write-Host '  The Machine scope needs an elevated shell.' -ForegroundColor Yellow
        }
    }
}

Write-Host ''
Write-Host '  Open a new terminal so the change is picked up, then run /context' -ForegroundColor Cyan
Write-Host '  in Claude Code to confirm the number moved.' -ForegroundColor Cyan
Write-Host ''
Write-Host '  RegesCore // Fable 5 - davidio.dev' -ForegroundColor DarkGray
