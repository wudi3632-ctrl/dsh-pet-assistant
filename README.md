<p align="center">
  <img src="assets/logo.png" width="112" alt="dsh-pet-assistant logo">
</p>

<h1 align="center">dsh-pet-assistant</h1>

<p align="center">
  会听、会说、会陪你，也会拖着鼠标帮你操作 Windows 的可爱桌宠。
</p>

<p align="center">
  <img alt="Windows" src="https://img.shields.io/badge/Windows-10%20%2F%2011-2672EC?logo=windows11&logoColor=white">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white">
  <img alt="Local ASR" src="https://img.shields.io/badge/ASR-sherpa--onnx-00A6A6">
  <img alt="Streaming TTS" src="https://img.shields.io/badge/TTS-Qwen3--TTS-6C63FF">
  <img alt="License" src="https://img.shields.io/badge/code-MIT-green">
</p>

<p align="center">
  <a href="docs/INSTALL_WINDOWS.md">安装教程</a> ·
  <a href="docs/MODELS_AND_VOICE.md">模型与音色</a> ·
  <a href="docs/TROUBLESHOOTING.md">故障排查</a> ·
  <a href="https://github.com/wudi3632-ctrl/dashifeiyu-workbench">大肥鱼工作台</a>
</p>

## 效果预览

<table>
  <tr>
    <td align="center"><img src="docs/media/pet-happy.webp" width="280" alt="开心回应动画"></td>
    <td align="center"><img src="docs/media/pet-thinking.webp" width="280" alt="思考状态动画"></td>
    <td align="center"><img src="docs/media/pet-coding.webp" width="280" alt="写代码动画"></td>
  </tr>
  <tr>
    <td align="center"><b>开心回应</b></td>
    <td align="center"><b>倾听与思考</b></td>
    <td align="center"><b>执行任务</b></td>
  </tr>
</table>

> 动图直接取自项目实际动画资源。语音唤醒后，桌宠会用气泡和 TTS 同步回复；执行鼠标任务时会跑到光标旁，营造“拖着鼠标去操作”的效果。

> 本项目基于 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 二次开发并保留上游 Git 历史。代码使用 MIT License；仓库内沿用的桌宠动画、图片、字体和声音素材遵循上游的非商用与署名规则，不等同于 MIT 代码授权。

## 能做什么

- “大肥鱼 / 鲸鲸 / 小鲸鱼 / 小鲸”关键词唤醒，30 秒连续会话
- sherpa-onnx KWS、VAD 与流式 Paraformer 中文 ASR
- Qwen3-TTS / CosyVoice，文字气泡与语音同步、说话打断
- 打开和激活软件、窗口、浏览器，以及鼠标键盘和常见 UI 操作
- 任务拆分、任务卡片、确认步骤和执行结果验证
- 自动化移动鼠标时由桌宠做出“拖着鼠标去操作”的演出

典型指令包括：“打开 B 站”“在记事本里写一段自我介绍”“打开已经登录的微信并找到联系人”。需要发送消息、删除内容、付款或发布时，助手应停在最终动作前等待确认。

桌面自动化并非系统权限边界。发消息、删除、付款、发布和提交表单等动作应保留人工确认；软件升级或 UI 变化后可能需要重新适配。

## 选择安装方式

| 目标 | 安装内容 |
|---|---|
| 先看桌宠或参与开发 | 本仓库 standalone 模式 |
| 在 DSH 中日常使用 | [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) + 官方 `dsh-pet` + 本仓库覆盖部署 |
| 语音唤醒与识别 | 再安装 sherpa-onnx 和两个模型 |
| 可爱克隆音色、低延迟回复 | 再安装 `dashifeiyu-workbench` 的 Qwen3-TTS 服务 |

完整教程见 [Windows 安装指南](docs/INSTALL_WINDOWS.md)。模型和音色见 [模型与语音指南](docs/MODELS_AND_VOICE.md)。遇到问题先看 [故障排查](docs/TROUBLESHOOTING.md)。

## 最短开发启动

要求 Windows 10/11、Node.js 22.12+ 和 pnpm：

```powershell
git clone https://github.com/wudi3632-ctrl/dsh-pet-assistant.git
cd dsh-pet-assistant
corepack enable
pnpm install --frozen-lockfile
pnpm run build
pnpm run standalone
```

standalone 用于开发和查看桌宠，不会自动获得 DSH 的模型配置与完整 agent 能力。

## 部署到 DSH

先通过 DSH 安装官方 `dsh-pet`，退出 DSH，再执行：

```powershell
pnpm run build
node scripts/deploy-local.mjs --destination "$HOME\.dsh\profiles\desktop\node_modules\dsh-pet"
```

脚本会先备份被替换的文件，不会停止 DSH；复制完成后需要重启 DSH。自定义 DSH 数据目录请把 `--destination` 换成实际插件目录。所有参数：

```powershell
node scripts/deploy-local.mjs --help
```

## 配置诊断

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\doctor-windows.ps1
pnpm test
pnpm run typecheck
```

首次端到端验收顺序：启动 TTS → 启动 DSH → 说“大肥鱼” → 等待“正在听” → 说“打开记事本并写一段自我介绍” → 检查任务卡片、鼠标演出、气泡和 TTS。详见安装指南。

## 仓库边界

模型权重、Python/Node 运行时、个人克隆音色、参考干声、API 密钥、DSH 用户数据、联系人、聊天记录、日志和本机配置均不提交。模型应放在仓库外并通过环境变量指向。隐私和安全说明见 [PRIVACY.md](PRIVACY.md) 与 [SECURITY.md](SECURITY.md)。

## License 与署名

- 代码：[MIT License](LICENSE)
- 上游：[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)
- 媒体素材：遵循上游非商用与署名约束；公开分发前自行核对每项素材授权
