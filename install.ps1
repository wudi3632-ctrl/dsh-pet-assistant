param([string]$DshCli = '', [string]$DshProfile = '', [switch]$NoStart)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw '请先安装Node.js 22或更新的LTS版本，重新打开PowerShell后再运行。https://nodejs.org/'
}
$petArguments = @('scripts/install.mjs')
if ($DshCli) { $petArguments += "--dsh-cli=$DshCli" }
if ($DshProfile) { $petArguments += "--dsh-profile=$DshProfile" }
if ($NoStart) { $petArguments += '--no-start' }
& node @petArguments
if ($LASTEXITCODE -ne 0) { throw '插件安装未完成，请查看上面的错误；不要忽略后继续。' }
Write-Host '接下来：DSH → 插件 → dsh-dashifeiyu-pet → 启用/显示桌宠。语音准备请阅读 INSTALL.md。'
