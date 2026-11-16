[CmdletBinding()]
param(
    [string]$PluginDir = $env:DSH_PET_DEPLOY_DIR,
    [string]$AsrPython = $env:DSH_PET_ASR_PYTHON,
    [string]$AsrModel = $env:DSH_PET_ASR_MODEL,
    [string]$QwenService = $env:DSH_PET_QWEN_SERVICE,
    [string]$QwenHealthUrl = 'http://127.0.0.1:9883/health'
)

$ErrorActionPreference = 'Stop'
$script:Failures = 0

function Test-Item([string]$Label, [bool]$Ok, [string]$Detail) {
    $mark = if ($Ok) { '[OK]  ' } else { '[FAIL]' }
    Write-Host "$mark $Label - $Detail" -ForegroundColor $(if ($Ok) { 'Green' } else { 'Red' })
    if (-not $Ok) { $script:Failures++ }
}

function Test-Optional([string]$Label, [bool]$Ok, [string]$Detail) {
    $mark = if ($Ok) { '[OK]  ' } else { '[SKIP]' }
    Write-Host "$mark $Label - $Detail" -ForegroundColor $(if ($Ok) { 'Green' } else { 'Yellow' })
}

$repo = Split-Path -Parent $PSScriptRoot
$node = Get-Command node -ErrorAction SilentlyContinue
$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
Test-Item 'Node.js' ($null -ne $node) $(if ($node) { (& node --version) } else { 'install Node.js 22.12+' })
Test-Item 'pnpm' ($null -ne $pnpm) $(if ($pnpm) { (& pnpm --version) } else { 'run corepack enable' })
Test-Item 'built plugin' (Test-Path (Join-Path $repo 'lib')) 'run pnpm install and pnpm run build when missing'

if (-not $PluginDir) {
    $PluginDir = Join-Path $HOME '.dsh\profiles\desktop\node_modules\dsh-pet'
}
Test-Item 'DSH plugin directory' (Test-Path $PluginDir) $PluginDir

if ($AsrPython) {
    Test-Item 'ASR Python' (Test-Path $AsrPython) $AsrPython
} else {
    Test-Optional 'ASR Python' $false 'DSH_PET_ASR_PYTHON is not set'
}

if ($AsrModel) {
    $asrFiles = @(
        'streaming-paraformer-bilingual-int8\tokens.txt',
        'streaming-paraformer-bilingual-int8\encoder.int8.onnx',
        'streaming-paraformer-bilingual-int8\decoder.int8.onnx',
        'sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20\tokens.txt',
        'sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20\encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx',
        'sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20\decoder-epoch-13-avg-2-chunk-16-left-64.onnx',
        'sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20\joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx',
        'keywords-dsh-pet.txt'
    )
    foreach ($relative in $asrFiles) {
        Test-Item "ASR $relative" (Test-Path (Join-Path $AsrModel $relative)) (Join-Path $AsrModel $relative)
    }
} else {
    Test-Optional 'ASR model' $false 'DSH_PET_ASR_MODEL is not set'
}

if ($QwenService) {
    Test-Item 'Qwen service script' (Test-Path $QwenService) $QwenService
} else {
    Test-Optional 'Qwen service script' $false 'DSH_PET_QWEN_SERVICE is not set'
}

try {
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri $QwenHealthUrl
    Test-Optional 'Qwen TTS health' ($response.StatusCode -eq 200) "$QwenHealthUrl HTTP $($response.StatusCode)"
} catch {
    Test-Optional 'Qwen TTS health' $false "$QwenHealthUrl is not running (optional during build)"
}

if ($script:Failures -gt 0) {
    Write-Host "`n$script:Failures required check(s) failed." -ForegroundColor Red
    exit 1
}
Write-Host "`nRequired checks passed. Optional speech checks may still need configuration." -ForegroundColor Green
