<#
.SYNOPSIS
    Isolates where image support breaks between Claude Code, LM Studio and the
    model, by sending a known image straight to the server.

.DESCRIPTION
    When a model answers that it cannot see an attached screenshot, the image
    was lost at one of four layers, and they need different fixes:

      1. The model has no vision projector loaded (no mmproj alongside the GGUF).
      2. LM Studio's endpoint does not accept the image block.
      3. The chat template emits the wrong media marker, so mtmd attaches
         nothing.
      4. The client never sent the image.

    This script removes the client from the picture. It posts a 64x64 solid red
    square, embedded below so the test is identical on every machine, and asks
    the model what colour it is. A model that answers "red" can see images, and
    the fault is above the server. A model that describes nothing, errors, or
    talks about something else cannot, and the fault is at layers 1 to 3.

    It tests the Anthropic-compatible endpoint, which is the one Claude Code
    uses, and optionally the OpenAI-compatible one for comparison.

.PARAMETER BaseUrl
    Server root, without the version segment. Defaults to http://127.0.0.1:2126.

.PARAMETER Model
    Model ID to test. Defaults to the first model the server reports.

.PARAMETER Both
    Also test the OpenAI-compatible /v1/chat/completions endpoint. When the two
    disagree, the fault is in the endpoint rather than the model.

.PARAMETER TimeoutSeconds
    How long to wait. Prompt processing on a partially offloaded model can take
    minutes, so this defaults high.

.EXAMPLE
    .\Test-RegesCoreVision.ps1
    Test the default endpoint with the first available model.

.EXAMPLE
    .\Test-RegesCoreVision.ps1 -Model 'claude-fable-5.0-rg35bmoe' -Both
    Test a specific model on both endpoints.

.NOTES
    RegesCore // Fable 5 - brand and engineering by davidio.dev
    https://davidio.dev
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = "http://127.0.0.1:2126",
    [string]$Model,
    [switch]$Both,
    [int]$TimeoutSeconds = 600
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# 64x64 solid red PNG. Embedded so every run tests the identical bytes.
$RedSquarePng = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAT0lEQVR42u3PQQkAAAgEsEty/UMZxgi+hcEKLNO+FgEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQGBywLPLIEA68ZURwAAAABJRU5ErkJggg=='
$Question = 'What colour is this image? Answer with the colour name only.'

$root = $BaseUrl.TrimEnd('/')
if ($root -notmatch '/v\d+$') { $root = "$root/v1" }

function Write-Section {
    param([string]$Text)
    Write-Host ''
    Write-Host $Text -ForegroundColor Cyan
    Write-Host ('-' * $Text.Length) -ForegroundColor DarkGray
}

function Invoke-Endpoint {
    param(
        [Parameter(Mandatory)][string]$Uri,
        [Parameter(Mandatory)][hashtable]$Headers,
        [Parameter(Mandatory)]$Body
    )
    $json = $Body | ConvertTo-Json -Depth 20 -Compress
    $started = Get-Date
    try {
        $response = Invoke-WebRequest -Uri $Uri -Method Post -Headers $Headers `
            -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) `
            -ContentType 'application/json' -TimeoutSec $TimeoutSeconds `
            -UseBasicParsing
        return [pscustomobject]@{
            Ok      = $true
            Status  = $response.StatusCode
            Content = $response.Content
            Seconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
        }
    } catch {
        $status = $null
        $detail = $_.Exception.Message
        # The server's own error body says far more than the status line.
        if ($_.PSObject.Properties.Name -contains 'Exception' -and
            $_.Exception.PSObject.Properties.Name -contains 'Response' -and
            $null -ne $_.Exception.Response) {
            try {
                $status = [int]$_.Exception.Response.StatusCode
                $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
                $detail = $reader.ReadToEnd()
            } catch { }
        }
        return [pscustomobject]@{
            Ok      = $false
            Status  = $status
            Content = $detail
            Seconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
        }
    }
}

function Get-AnswerText {
    param([Parameter(Mandatory)][string]$Json)
    try {
        $parsed = $Json | ConvertFrom-Json
    } catch {
        return $Json
    }
    # Anthropic: content is an array of blocks. OpenAI: choices[].message.content.
    if ($parsed.PSObject.Properties.Name -contains 'content') {
        $parts = @()
        foreach ($block in $parsed.content) {
            if ($block.PSObject.Properties.Name -contains 'text') { $parts += $block.text }
        }
        return ($parts -join '')
    }
    if ($parsed.PSObject.Properties.Name -contains 'choices') {
        return ($parsed.choices | ForEach-Object { $_.message.content }) -join ''
    }
    return $Json
}

function Show-Verdict {
    param([Parameter(Mandatory)][string]$Answer, [Parameter(Mandatory)][string]$Label)
    $clean = $Answer.Trim()
    if ($clean.Length -eq 0) {
        Write-Host "  $Label - EMPTY RESPONSE" -ForegroundColor Red
        Write-Host "  The model produced no answer text. If the token count was" -ForegroundColor DarkGray
        Write-Host "  non-zero, the output went to the reasoning channel and was" -ForegroundColor DarkGray
        Write-Host "  stripped." -ForegroundColor DarkGray
        return
    }
    Write-Host "  answer: $clean"
    if ($clean -match '(?i)\bred\b|\bcrimson\b|\bscarlet\b') {
        Write-Host "  $Label - VISION WORKS. The image reached the model." -ForegroundColor Green
    } else {
        Write-Host "  $Label - VISION DID NOT WORK. The image did not reach the model." -ForegroundColor Red
    }
}

Write-Host ''
Write-Host 'RegesCore vision isolation test - davidio.dev' -ForegroundColor Cyan
Write-Host "  endpoint : $root"

# -- 1. Which models does the server actually have? ------------------------
Write-Section 'Models reported by the server'
$modelsResult = $null
try {
    $modelsResult = Invoke-WebRequest -Uri "$root/models" -Method Get -TimeoutSec 30 -UseBasicParsing
} catch {
    Write-Host "  could not reach $root/models - $($_.Exception.Message)" -ForegroundColor Red
    Write-Host '  Is LM Studio running, and is the server switch on?' -ForegroundColor Yellow
    exit 1
}
$modelIds = @()
try {
    $modelIds = ($modelsResult.Content | ConvertFrom-Json).data | ForEach-Object { $_.id }
} catch { }
foreach ($id in $modelIds) { Write-Host "  - $id" }
if ($modelIds.Count -eq 0) { Write-Host '  (none reported)' -ForegroundColor Yellow }

if (-not $Model) {
    if ($modelIds.Count -eq 0) {
        Write-Host ''
        Write-Host 'No model to test. Load one in LM Studio first.' -ForegroundColor Red
        exit 1
    }
    $Model = $modelIds[0]
}
Write-Host ''
Write-Host "  testing  : $Model"
if ($modelIds.Count -gt 0 -and $modelIds -notcontains $Model) {
    Write-Host "  WARNING: '$Model' is not in the list above. A request for a model" -ForegroundColor Yellow
    Write-Host "  the server does not have will hang or fail, which looks like a" -ForegroundColor Yellow
    Write-Host "  gateway timeout in the client." -ForegroundColor Yellow
}

# -- 2. Anthropic-compatible endpoint, the one Claude Code uses -------------
Write-Section 'POST /messages  (Anthropic-compatible)'
$anthropicBody = @{
    model      = $Model
    max_tokens = 64
    messages   = @(
        @{
            role    = 'user'
            content = @(
                @{
                    type   = 'image'
                    source = @{
                        type       = 'base64'
                        media_type = 'image/png'
                        data       = $RedSquarePng
                    }
                },
                @{ type = 'text'; text = $Question }
            )
        }
    )
}
$anthropic = Invoke-Endpoint -Uri "$root/messages" `
    -Headers @{ 'anthropic-version' = '2023-06-01' } -Body $anthropicBody

Write-Host "  status: $($anthropic.Status)   elapsed: $($anthropic.Seconds)s"
if ($anthropic.Ok) {
    Show-Verdict -Answer (Get-AnswerText -Json $anthropic.Content) -Label 'anthropic'
} else {
    Write-Host '  request failed:' -ForegroundColor Red
    Write-Host "  $($anthropic.Content)"
    if ("$($anthropic.Content)" -match '(?i)marker|bitmap|mtmd') {
        Write-Host ''
        Write-Host '  That error names the media marker. The chat template and the' -ForegroundColor Yellow
        Write-Host '  server disagree on how many <__media__> markers the prompt' -ForegroundColor Yellow
        Write-Host '  should contain. Fix the template, not the model.' -ForegroundColor Yellow
    }
}

# -- 3. OpenAI-compatible endpoint, for comparison --------------------------
if ($Both) {
    Write-Section 'POST /chat/completions  (OpenAI-compatible)'
    $openaiBody = @{
        model      = $Model
        max_tokens = 64
        messages   = @(
            @{
                role    = 'user'
                content = @(
                    @{ type = 'text'; text = $Question },
                    @{
                        type      = 'image_url'
                        image_url = @{ url = "data:image/png;base64,$RedSquarePng" }
                    }
                )
            }
        )
    }
    $openai = Invoke-Endpoint -Uri "$root/chat/completions" -Headers @{} -Body $openaiBody
    Write-Host "  status: $($openai.Status)   elapsed: $($openai.Seconds)s"
    if ($openai.Ok) {
        Show-Verdict -Answer (Get-AnswerText -Json $openai.Content) -Label 'openai'
    } else {
        Write-Host '  request failed:' -ForegroundColor Red
        Write-Host "  $($openai.Content)"
    }
}

Write-Section 'What the result means'
Write-Host @"
  Answer mentions red
      The server and model handle images. The loss is above them: check that
      the client is really attaching the image, and that the model entry the
      client requests is the one you tested.

  Answer describes nothing, or is about something else
      The image bytes never became image tokens. In order of likelihood:
        1. No vision projector is loaded. Put mmproj-F16.gguf in the same
           folder as the GGUF, reload the model, and confirm LM Studio shows a
           vision badge on it.
        2. The chat template emits the wrong media marker. llama.cpp needs the
           literal <__media__>, one per image.

  Request fails with 400
      The endpoint rejected the image block outright. The error body above
      names the field it did not accept.

  Request times out
      Not an image problem. The prompt is not finishing. Reduce the context
      length, raise GPU offload so the whole model fits, and check that the
      model list in the client contains only models the server actually has.

  RegesCore // Fable 5 - davidio.dev
"@
