# Windows 安装指南

本教程面向一台全新的 Windows 10/11 电脑。路径只是示例，模型和个人音频建议放在仓库外，例如 `D:\AI\speech`。

## 1. 安装基础软件

安装以下组件后重新打开 PowerShell：

- [Git for Windows](https://git-scm.com/download/win)
- [Node.js 22 LTS](https://nodejs.org/)
- Python 3.11 x64（在 [python.org](https://www.python.org/downloads/windows/) 安装器中勾选 Add Python to PATH）
- DSH 及其官方 `dsh-pet` 插件

检查：

```powershell
git --version
node --version
py -3.11 --version
corepack enable
pnpm --version
```

如果使用命令行版 DSH，可安装启动器和官方插件：

```powershell
npm install -g @deepseek-ai/dsh pnpm
dsh --version
dsh plugin --profile desktop add dsh-pet
```

使用 DSH 桌面应用时，也可以直接在应用内“插件管理”搜索 `dsh-pet`。浏览器版 `dsh web` 的 profile 是 `web`，但本项目的 Windows 桌面语音和鼠标演出应使用 `desktop` profile。安装后先重启一次 DSH，确保目标插件目录已经生成。

## 2. 下载和构建

```powershell
git clone https://github.com/wudi3632-ctrl/dsh-pet-assistant.git
cd dsh-pet-assistant
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm run typecheck
pnpm run build
```

只想预览开发版可运行 `pnpm run standalone`。日常使用请继续部署到 DSH。

## 3. 部署到 DSH

1. 先在 DSH 中安装并运行一次官方 `dsh-pet`。
2. 完全退出 DSH，确认托盘里也已退出。
3. 找到插件目录。默认 desktop profile 通常是 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-pet`。
4. 从本仓库执行：

```powershell
node scripts/deploy-local.mjs --destination "$HOME\.dsh\profiles\desktop\node_modules\dsh-pet"
```

脚本会把原文件备份到仓库同级的 `dsh-pet-deploy-backups`。如果使用自定义 DSH 数据目录，必须明确传入实际目录；不要照抄默认路径。

更新时运行 `git pull`、`pnpm install --frozen-lockfile`、`pnpm run build`，退出 DSH 后重新部署。

## 4. 安装本地 ASR

```powershell
New-Item -ItemType Directory -Force D:\AI\speech\sherpa-onnx | Out-Null
py -3.11 -m venv D:\AI\speech\sherpa-onnx\.venv
D:\AI\speech\sherpa-onnx\.venv\Scripts\python.exe -m pip install --upgrade pip
D:\AI\speech\sherpa-onnx\.venv\Scripts\python.exe -m pip install numpy sherpa-onnx
```

按 [模型与语音指南](MODELS_AND_VOICE.md) 下载并解压 Paraformer ASR 与 KWS 模型，然后复制唤醒词：

```powershell
Copy-Item .\runtime\electron-helper\keywords-dsh-pet.txt D:\AI\speech\sherpa-onnx\keywords-dsh-pet.txt
```

把环境变量永久写入当前用户：

```powershell
[Environment]::SetEnvironmentVariable('DSH_PET_ASR_PYTHON', 'D:\AI\speech\sherpa-onnx\.venv\Scripts\python.exe', 'User')
[Environment]::SetEnvironmentVariable('DSH_PET_ASR_MODEL', 'D:\AI\speech\sherpa-onnx', 'User')
```

设置用户环境变量后必须彻底退出并重新启动 DSH；已运行的进程看不到后来写入的变量。

## 5. 安装 TTS

实时桌宠推荐 Qwen3-TTS。服务代码和独立安装说明位于 `dashifeiyu-workbench/speech-services`，默认健康地址为 `http://127.0.0.1:9883/health`。个人音色必须使用本人或已获明确授权的干净参考人声。

服务准备好后设置：

```powershell
[Environment]::SetEnvironmentVariable('DSH_PET_QWEN_PYTHON', 'D:\AI\speech\qwen3-tts\.venv\Scripts\python.exe', 'User')
[Environment]::SetEnvironmentVariable('DSH_PET_QWEN_SERVICE', 'D:\Projects\dashifeiyu-workbench\speech-services\qwen3-tts\qwen_tts_service.py', 'User')
```

也可只手动启动 Qwen 服务；桌宠通过本机 `9883` 端口调用。CosyVoice 是可选的高质量/非强实时方案，默认端口 `9882`。

## 6. 麦克风与远控输入

- Windows 设置 → 隐私和安全性 → 麦克风：允许桌面应用访问。
- 系统声音设置中把真实麦克风或远控软件提供的虚拟输入设为默认输入。
- DSH 启动前完成设备切换；切换后重启 DSH 最可靠。
- 戴耳机可降低 TTS 被麦克风重新收录造成的误打断。

## 7. 运行诊断

重新打开 PowerShell，在仓库中运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\doctor-windows.ps1
Invoke-RestMethod http://127.0.0.1:9883/health
```

自定义 DSH 目录可传 `-PluginDir 'D:\你的DSH数据\profiles\desktop\node_modules\dsh-pet'`。

## 8. 首次完整验收

1. 启动 Qwen3-TTS，确认 `/health` 正常。
2. 启动 DSH，等待桌宠出现。
3. 说“大肥鱼”，应出现“识别/正在听”状态。
4. 说“介绍一下你自己”，应逐步出现气泡文字并开始 TTS。
5. TTS 播放中说“大肥鱼”，应能打断并进入新一轮倾听。
6. 说“打开记事本并写一段三句话的自我介绍”。
7. 任务卡片应显示新任务和分步状态；记事本到前台；桌宠以拖拽鼠标的演出移动；文本实际写入。
8. 说“关闭记事本”，涉及未保存内容时应要求确认，不应静默丢失。

Windows 操作依赖交互式桌面。锁屏、UAC 安全桌面、最小化的远程会话以及管理员权限不一致都会让自动化失效。
