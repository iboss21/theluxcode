<#
.SYNOPSIS
    Finds and removes a stale Claude Code model ID - the "ghost" that keeps
    sending requests for a model you no longer have.

.DESCRIPTION
    Claude Code resolves model IDs from environment variables and settings
    files, and the background model slot keeps its own ID separate from the one
    in the /model picker. A leftover value in any of those places produces
    requests naming a model that is not installed, typically a short probe with
    max_tokens 1 that appears in the inference server log for no apparent
    reason.

    This script hunts a given ID across every place it can hide:

      1. Environment variables, in Process, User and Machine scope.
      2. Claude Code settings files: settings.json, settings.local.json,
         ~/.claude.json, and the machine-wide managed-settings.json.
      3. Per-project .claude\settings*.json files.
      4. The gateway model discovery cache.
      5. PowerShell profile scripts that set the variable at shell start.

    It reports by default and changes nothing. Pass -Fix to remove what it
    found. Every file it touches is backed up first, and -WhatIf shows the plan
    without acting.

.PARAMETER Ghost
    One or more substrings to hunt. A value matches when it contains any of
    them, case-insensitively.

.PARAMETER Fix
    Remove what was found. Without this the script only reports.

.PARAMETER IncludeMachine
    Also clean Machine-scope environment variables. Requires an elevated shell.

.PARAMETER ProjectPath
    Extra directories to search for .claude\settings*.json. The current
    directory is always searched.

.PARAMETER ConfigRoot
    Claude Code config directory. Defaults to CLAUDE_CONFIG_DIR, then
    $env:USERPROFILE\.claude.

.PARAMETER BackupDir
    Where backups go. Defaults to a timestamped folder under the config root.

.EXAMPLE
    .\Remove-ClaudeGhostModel.ps1
    Report every place the default ghost ID appears. Changes nothing.

.EXAMPLE
    .\Remove-ClaudeGhostModel.ps1 -Ghost 'qwen/qwen2.5-coder-14b' -Fix -WhatIf
    Show exactly what -Fix would do, without doing it.

.EXAMPLE
    .\Remove-ClaudeGhostModel.ps1 -Fix -IncludeMachine
    Remove it everywhere, including Machine-scope variables. Run elevated.

.EXAMPLE
    .\Remove-ClaudeGhostModel.ps1 -Ghost 'llama-3.1-8b','mistral' -Fix
    Hunt several stale IDs in one pass. Run the script directly, as shown. When
    launching through "pwsh -File", a comma-separated list arrives as one string
    and matches nothing; use "pwsh -Command" for that case.

.NOTES
    RegesCore // Fable 5 - brand and engineering by davidio.dev
    https://davidio.dev

    Restart your terminal and Claude Code after a -Fix run. Already-running
    processes keep the environment block they started with.
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
param(
    [string[]]$Ghost = @('qwen/qwen2.5-coder-14b'),
    [switch]$Fix,
    [switch]$IncludeMachine,
    [string[]]$ProjectPath = @(),
    [string]$ConfigRoot,
    [string]$BackupDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Model-bearing variables are reported even when they do not match a ghost, so
# you can see the whole landscape rather than only the one you guessed at.
$ModelVariablePattern = '^(ANTHROPIC_(MODEL|DEFAULT_.*MODEL|SMALL_FAST_MODEL)|CLAUDE_CODE_SUBAGENT_MODEL)$'

$script:Findings = [System.Collections.Generic.List[object]]::new()
$script:IsWindowsHost = $true
if (Test-Path Variable:\IsWindows) { $script:IsWindowsHost = $IsWindows }

function Get-UserHome {
    if ($env:USERPROFILE) { return $env:USERPROFILE }
    if ($env:HOME) { return $env:HOME }
    return (Get-Location).Path
}

function Test-Ghost {
    param([AllowNull()][string]$Value)
    if ([string]::IsNullOrEmpty($Value)) { return $false }
    foreach ($needle in $Ghost) {
        if ($Value -like "*$needle*") { return $true }
    }
    return $false
}

function Add-Finding {
    param(
        [Parameter(Mandatory)][string]$Kind,
        [Parameter(Mandatory)][string]$Location,
        [Parameter(Mandatory)][string]$Name,
        [AllowNull()][string]$Value,
        [Parameter(Mandatory)][string]$Action,
        [ValidateSet('Ghost', 'Info')][string]$Severity = 'Ghost'
    )
    $script:Findings.Add([pscustomobject]@{
        Kind     = $Kind
        Location = $Location
        Name     = $Name
        Value    = $Value
        Action   = $Action
        Severity = $Severity
    })
}

function New-Backup {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    if (-not (Test-Path -LiteralPath $script:ResolvedBackupDir)) {
        New-Item -ItemType Directory -Force -Path $script:ResolvedBackupDir | Out-Null
    }
    # Flatten the source path into the file name so two settings.json files from
    # different folders cannot overwrite each other in the backup directory.
    $flat = ($Path -replace '[\\/:]', '_').TrimStart('_')
    $target = Join-Path $script:ResolvedBackupDir $flat
    Copy-Item -LiteralPath $Path -Destination $target -Force
    return $target
}

# ---------------------------------------------------------------------------
# Environment variables
# ---------------------------------------------------------------------------

function Invoke-EnvironmentScan {
    $scopes = @('Process', 'User')
    if ($IncludeMachine) { $scopes += 'Machine' }

    foreach ($scope in $scopes) {
        if ($scope -ne 'Process' -and -not $script:IsWindowsHost) {
            Write-Verbose "Skipping $scope scope: not Windows."
            continue
        }

        $entries = @{}
        try {
            $raw = [Environment]::GetEnvironmentVariables($scope)
            foreach ($key in $raw.Keys) { $entries[[string]$key] = [string]$raw[$key] }
        } catch {
            Write-Warning "Cannot read $scope environment variables: $($_.Exception.Message)"
            continue
        }

        foreach ($name in ($entries.Keys | Sort-Object)) {
            $value = $entries[$name]
            $isGhost = Test-Ghost -Value $value
            $isModelVar = $name -match $ModelVariablePattern

            if ($isGhost) {
                Add-Finding -Kind 'EnvironmentVariable' -Location $scope -Name $name `
                    -Value $value -Action 'Remove variable'
                if ($Fix) { Remove-EnvironmentVariable -Name $name -Scope $scope }
            } elseif ($isModelVar -and -not [string]::IsNullOrWhiteSpace($value)) {
                Add-Finding -Kind 'EnvironmentVariable' -Location $scope -Name $name `
                    -Value $value -Action 'No match - review manually' -Severity 'Info'
            }
        }
    }
}

function Remove-EnvironmentVariable {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Scope
    )
    if (-not $PSCmdlet.ShouldProcess("$Scope environment variable $Name", 'Remove')) { return }

    if ($Scope -eq 'Process') {
        Remove-Item -LiteralPath "Env:$Name" -ErrorAction SilentlyContinue
        return
    }
    if (-not $script:IsWindowsHost) { return }
    try {
        [Environment]::SetEnvironmentVariable($Name, $null, $Scope)
    } catch {
        $hint = if ($Scope -eq 'Machine') { ' Run PowerShell as Administrator.' } else { '' }
        Write-Warning "Could not remove $Scope variable ${Name}: $($_.Exception.Message).$hint"
    }
}

# ---------------------------------------------------------------------------
# JSON settings files
# ---------------------------------------------------------------------------

function Get-SettingsFile {
    $userHome = Get-UserHome
    $candidates = [System.Collections.Generic.List[string]]::new()

    foreach ($name in @('settings.json', 'settings.local.json')) {
        $candidates.Add((Join-Path $script:ResolvedConfigRoot $name))
    }
    $candidates.Add((Join-Path $userHome '.claude.json'))

    if ($script:IsWindowsHost -and $env:PROGRAMDATA) {
        $candidates.Add((Join-Path $env:PROGRAMDATA 'ClaudeCode\managed-settings.json'))
    }

    $roots = @((Get-Location).Path) + $ProjectPath
    foreach ($root in $roots) {
        if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root)) { continue }
        $found = Get-ChildItem -LiteralPath $root -Recurse -Force -Filter 'settings*.json' `
            -ErrorAction SilentlyContinue |
            Where-Object { $_.DirectoryName -match '(\\|/)\.claude$' }
        foreach ($file in $found) { $candidates.Add($file.FullName) }
    }

    return $candidates | Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -Unique
}

<#
    Walks a parsed JSON tree and returns the dotted paths of every string value
    containing a ghost. When -Remove is set, the owning property is deleted from
    its parent, and matching array elements are dropped.
#>
function Find-GhostInNode {
    param(
        [Parameter(Mandatory)][AllowNull()]$Node,
        [Parameter(Mandatory)][AllowEmptyString()][string]$NodePath,
        [switch]$Remove
    )
    $hits = [System.Collections.Generic.List[object]]::new()
    if ($null -eq $Node) { return , $hits }

    if ($Node -is [System.Management.Automation.PSCustomObject]) {
        # Snapshot the names: removing while enumerating invalidates the walk.
        # Enumerated through the pipeline because under Set-StrictMode a direct
        # .Properties.Name throws once removals have emptied the object.
        $names = @($Node.PSObject.Properties | Select-Object -ExpandProperty Name)
        foreach ($name in $names) {
            $child = $Node.$name
            $childPath = if ($NodePath) { "$NodePath.$name" } else { $name }

            if ($child -is [string]) {
                if (Test-Ghost -Value $child) {
                    $hits.Add([pscustomobject]@{ Path = $childPath; Value = $child })
                    if ($Remove) { $Node.PSObject.Properties.Remove($name) }
                }
                continue
            }

            $nested = Find-GhostInNode -Node $child -NodePath $childPath -Remove:$Remove
            foreach ($hit in $nested) { $hits.Add($hit) }

            # An object emptied by removals is itself noise; drop it.
            if ($Remove -and $nested.Count -gt 0 -and
                $child -is [System.Management.Automation.PSCustomObject] -and
                @($child.PSObject.Properties).Count -eq 0) {
                $Node.PSObject.Properties.Remove($name)
            }
        }
        return , $hits
    }

    if ($Node -is [System.Collections.IEnumerable] -and $Node -isnot [string]) {
        $index = 0
        foreach ($item in $Node) {
            $itemPath = "$NodePath[$index]"
            if ($item -is [string]) {
                if (Test-Ghost -Value $item) {
                    $hits.Add([pscustomobject]@{ Path = $itemPath; Value = $item })
                }
            } else {
                $nested = Find-GhostInNode -Node $item -NodePath $itemPath -Remove:$Remove
                foreach ($hit in $nested) { $hits.Add($hit) }
            }
            $index++
        }
        return , $hits
    }

    return , $hits
}

function Remove-GhostArrayElement {
    param([Parameter(Mandatory)][AllowNull()]$Node)
    if ($null -eq $Node) { return $Node }

    if ($Node -is [System.Management.Automation.PSCustomObject]) {
        $names = @($Node.PSObject.Properties | Select-Object -ExpandProperty Name)
        foreach ($name in $names) {
            $Node.$name = Remove-GhostArrayElement -Node $Node.$name
        }
        return $Node
    }

    if ($Node -is [System.Collections.IEnumerable] -and $Node -isnot [string]) {
        $kept = @()
        foreach ($item in $Node) {
            if ($item -is [string]) {
                if (-not (Test-Ghost -Value $item)) { $kept += $item }
            } else {
                $kept += (Remove-GhostArrayElement -Node $item)
            }
        }
        return , $kept
    }

    return $Node
}

function Invoke-SettingsScan {
    foreach ($file in Get-SettingsFile) {
      try {
        $raw = Get-Content -LiteralPath $file -Raw -ErrorAction SilentlyContinue
        if ([string]::IsNullOrWhiteSpace($raw)) { continue }

        $json = $null
        try {
            $json = $raw | ConvertFrom-Json
        } catch {
            if (Test-Ghost -Value $raw) {
                Add-Finding -Kind 'SettingsFile' -Location $file -Name '<unparsable>' `
                    -Value 'contains the ghost but is not valid JSON' `
                    -Action 'Edit by hand' -Severity 'Info'
            }
            continue
        }

        $hits = Find-GhostInNode -Node $json -NodePath ''
        if ($hits.Count -eq 0) { continue }

        foreach ($hit in $hits) {
            Add-Finding -Kind 'SettingsFile' -Location $file -Name $hit.Path `
                -Value $hit.Value -Action 'Remove key'
        }

        if (-not $Fix) { continue }
        if (-not $PSCmdlet.ShouldProcess($file, "Remove $($hits.Count) ghost value(s)")) { continue }

        $backup = New-Backup -Path $file
        $cleaned = $raw | ConvertFrom-Json
        [void](Find-GhostInNode -Node $cleaned -NodePath '' -Remove)
        $cleaned = Remove-GhostArrayElement -Node $cleaned
        $cleaned | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $file -Encoding UTF8
        Write-Verbose "Cleaned $file (backup: $backup)"
      } catch {
        # A single awkward file must not abort the sweep over the others.
        Write-Warning "Skipped ${file}: $($_.Exception.Message)"
        Add-Finding -Kind 'SettingsFile' -Location $file -Name '<error>' `
            -Value $_.Exception.Message -Action 'Edit by hand' -Severity 'Info'
      }
    }
}

# ---------------------------------------------------------------------------
# Gateway model discovery cache
# ---------------------------------------------------------------------------

function Invoke-CacheScan {
    $cache = Join-Path $script:ResolvedConfigRoot 'cache\gateway-models.json'
    if (-not (Test-Path -LiteralPath $cache)) { return }

    $raw = Get-Content -LiteralPath $cache -Raw -ErrorAction SilentlyContinue
    if (-not (Test-Ghost -Value $raw)) { return }

    Add-Finding -Kind 'ModelCache' -Location $cache -Name 'gateway-models.json' `
        -Value 'cached model list contains the ghost' -Action 'Delete cache'

    if (-not $Fix) { return }
    if (-not $PSCmdlet.ShouldProcess($cache, 'Delete')) { return }
    # Pure cache: Claude Code rebuilds it from the gateway on next startup.
    New-Backup -Path $cache | Out-Null
    Remove-Item -LiteralPath $cache -Force
}

# ---------------------------------------------------------------------------
# PowerShell profiles
# ---------------------------------------------------------------------------

function Invoke-ProfileScan {
    $paths = @()
    foreach ($name in @('AllUsersAllHosts', 'AllUsersCurrentHost',
                        'CurrentUserAllHosts', 'CurrentUserCurrentHost')) {
        if ($PROFILE.PSObject.Properties.Name -contains $name) { $paths += $PROFILE.$name }
    }

    foreach ($path in ($paths | Select-Object -Unique)) {
        if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path -LiteralPath $path)) { continue }

        $lines = @(Get-Content -LiteralPath $path)
        $matched = @()
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if (Test-Ghost -Value $lines[$i]) { $matched += $i }
        }
        if ($matched.Count -eq 0) { continue }

        foreach ($index in $matched) {
            Add-Finding -Kind 'ShellProfile' -Location $path -Name "line $($index + 1)" `
                -Value $lines[$index].Trim() -Action 'Comment out line'
        }

        if (-not $Fix) { continue }
        if (-not $PSCmdlet.ShouldProcess($path, "Comment out $($matched.Count) line(s)")) { continue }

        New-Backup -Path $path | Out-Null
        foreach ($index in $matched) {
            # Commented rather than deleted: the line may hold other settings,
            # and a comment is trivially reversible.
            $lines[$index] = "# [Remove-ClaudeGhostModel] $($lines[$index])"
        }
        Set-Content -LiteralPath $path -Value $lines -Encoding UTF8
    }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

$script:ResolvedConfigRoot = if ($ConfigRoot) {
    $ConfigRoot
} elseif ($env:CLAUDE_CONFIG_DIR) {
    $env:CLAUDE_CONFIG_DIR
} else {
    Join-Path (Get-UserHome) '.claude'
}

$script:ResolvedBackupDir = if ($BackupDir) {
    $BackupDir
} else {
    Join-Path $script:ResolvedConfigRoot ("ghost-backup-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
}

Write-Host ''
Write-Host 'RegesCore ghost model hunter - davidio.dev' -ForegroundColor Cyan
Write-Host ("  Hunting     : " + ($Ghost -join ', '))
Write-Host ("  Config root : " + $script:ResolvedConfigRoot)
Write-Host ("  Mode        : " + $(if ($Fix) { 'FIX (changes will be made)' } else { 'REPORT ONLY' }))
if ($Fix) { Write-Host ("  Backups     : " + $script:ResolvedBackupDir) }
Write-Host ''

Invoke-EnvironmentScan
Invoke-SettingsScan
Invoke-CacheScan
Invoke-ProfileScan

$ghosts = @($script:Findings | Where-Object { $_.Severity -eq 'Ghost' })
$info = @($script:Findings | Where-Object { $_.Severity -eq 'Info' })

if ($ghosts.Count -eq 0) {
    Write-Host 'No trace of the ghost found.' -ForegroundColor Green
} else {
    Write-Host ("Found $($ghosts.Count) occurrence(s):") -ForegroundColor Yellow
    # Out-String with an explicit width: -AutoSize renders blank when the host
    # has no measurable console, such as a redirected or non-interactive run.
    $ghosts | Format-Table Kind, Location, Name, Value, Action -Wrap |
        Out-String -Width 200 | Write-Host
}

if ($info.Count -gt 0) {
    Write-Host 'Other model settings, for context:' -ForegroundColor DarkGray
    $info | Format-Table Kind, Location, Name, Value -Wrap |
        Out-String -Width 200 | Write-Host
}

if ($ghosts.Count -gt 0) {
    if ($Fix) {
        Write-Host ''
        Write-Host 'Done. Restart your terminal and Claude Code: a running process keeps' -ForegroundColor Green
        Write-Host 'the environment block it started with.' -ForegroundColor Green
    } else {
        Write-Host ''
        Write-Host 'Report only. Re-run with -Fix to remove these, or -Fix -WhatIf to preview.' -ForegroundColor Yellow
    }
}

# Emitted for the pipeline as well as the console, so the result can be tested
# or filtered without re-parsing the display output.
$script:Findings
