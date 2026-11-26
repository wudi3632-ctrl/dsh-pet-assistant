# 安装大肥鱼 DSH 桌宠插件

适用版本：0.3.2；Windows 10/11 64位，DSH ≥ 0.2.1-rc.3（本机验证版本为0.2.1-rc.5）。本插件使用自己的WebM播放器与动作包，不安装、不加载第三方dsh-pet。

## 你要安装哪部分

|方式|需要|能使用什么|
|---|---|---|
|基础安装|DSH、Node.js 22或更新的LTS、Electron运行时|角色展示、拖动、文字提交DSH任务、结果气泡|
|加语音输入|以上 + Python 3.10～3.12、CPU版Sherpa模型|关键词唤醒、语音任务、30秒连续对话；无需GPU|
|加大肥鱼语音|以上 + NVIDIA CUDA环境、Qwen模型与自己的参考录音|Qwen音色克隆与流式结果简报|

没有TTS时可以先正常使用文字和任务气泡。语音模型不塞进插件；第一次准备需要联网，之后ASR/KWS完全本地运行。DSH任务仍使用用户自己在DSH配置的模型、账号和工具。

## 1. 获取正确版本

从 [v0.3.2 Release](https://github.com/wudi3632-ctrl/dsh-pet-assistant/releases/tag/v0.3.2) 下载 **dsh-dashifeiyu-pet-0.3.2-windows-source.zip**。解压到长期保留的文件夹，例如 `C:\Apps\dsh-dashifeiyu-pet`，不要从压缩包预览或下载临时目录安装。安装后不要移动或删除目录。

也可从源码安装：

```powershell
git clone https://github.com/wudi3632-ctrl/dsh-pet-assistant.git
cd dsh-pet-assistant
node scripts/install.mjs
```

仓库名称保留dsh-pet-assistant，插件包名为dsh-dashifeiyu-pet。0.3.2已替换早期基于第三方dsh-pet的实现，不依赖原插件。旧版升级先在DSH停用旧桌宠，再安装本版；不要同时启用两个录音桌宠。正确目录应有dsh/host.mjs、install.ps1、speech/models.json和scripts/setup-speech.py。

## 2. 基础安装（先让角色显示出来）

1. 安装并打开DSH，确认可以手动发起一个普通任务。
2. 安装Node.js 22或更新的LTS：https://nodejs.org/ 。重新打开PowerShell，执行 `node --version` 和 `npm --version`。
3. 在解压目录打开PowerShell，执行：

```powershell
node scripts/install.mjs
```

也可以双击右键“使用PowerShell运行” `install.ps1`，或执行 `./install.ps1`。若本机策略阻止脚本，直接使用上面的node命令，不需要修改系统执行策略。

安装器优先复用已有Electron，否则执行npm install下载运行时；自动从PATH或运行中的DSH找到官方CLI，注册为独立DSH插件。保留已有设置并备份；不会复制作者的账号、模型凭据或参考录音，也不会重启正在处理任务的DSH。

在 **DSH → 插件 → 已安装 → dsh-dashifeiyu-pet** 找到插件并启用。详情页有“启用/显示桌宠”“桌宠设置”“打开任务会话”“退出桌宠”。列表未更新时刷新列表；客户端尚未加载时刷新DSH界面，或等当前任务结束后正常重启DSH。

找不到CLI时：

```powershell
node scripts/install.mjs --dsh-cli="C:/你的DSH安装目录/resources/runtime/cli/bin/dsh.cmd"
```

使用其他DSH profile时：

```powershell
node scripts/install.mjs --dsh-profile="C:/Users/你的用户名/.dsh/profiles/desktop"
```

如果只是从DSH官方CLI执行 `dsh plugin --profile desktop add link:C:/Apps/dsh-dashifeiyu-pet`，需先在项目目录运行 `npm install` 以准备Electron，或已有可复用运行时。当前不提供已发布的npm包名安装，也未声称上架DSH插件市场。

## 3. 一键准备语音输入

安装64位Python 3.11（或3.10/3.12）：https://www.python.org/downloads/windows/ ，选择安装Python Launcher。这里使用独立venv，不修改系统Python包。

```powershell
py -3.11 scripts/setup-speech.py
```

脚本从Sherpa官方GitHub Release下载模型，逐文件校验SHA256，只取实际运行需要的7个模型文件（合计约243MB，不含Python和下载压缩包；上游压缩包包含其他精度，下载量可能更大）。创建 `.runtime/speech/.venv`，安装固定版本numpy与sherpa-onnx，验证导入，然后备份并写入本机 `settings.local.json` 的speech配置。已验证模型会复用，不重复下载。

先查看计划、完全不修改文件：

```powershell
py -3.11 scripts/setup-speech.py --dry-run
```

网络不稳定时，可用浏览器先下载以下官方压缩包，再执行离线模型准备（Python包仍需网络或自己的pip缓存）：

- ASR：https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2
- KWS：https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20.tar.bz2

```powershell
py -3.11 scripts/setup-speech.py --asr-archive="C:/Downloads/asr.tar.bz2" --kws-archive="C:/Downloads/kws.tar.bz2"
```

如果已经有同结构的模型与Python环境，可跳过下载，在settings.local.json中设置speech.root与speech.python，或用DFY_ASR_ROOT、DFY_ASR_PYTHON环境变量。仅设置当前PowerShell环境变量不会自动传给已经运行的DSH，推荐使用本机设置文件。

完成后停用再启用桌宠插件。模型在桌宠进程启动时预热并常驻；关闭麦克风或30秒休眠不卸载。准备语音环境不会自动打开麦克风。

## 4. 麦克风和第一次任务

1. 右键桌宠打开设置，点击“启用语音唤醒”，选择真正有音量反馈的输入设备；远控用户选择承载远端声音的虚拟麦克风。
2. 等徽标显示唤醒已开启。默认大肥鱼叫“大肥鱼、鲸鲸、小鲸鱼、小鲸”；用户导入的小鸡毛角色叫“小鸡毛”。
3. 先说“大肥鱼，在当前工作区创建一个测试文件，内容写你好”。确认DSH切到“桌宠语音”工作区，实际出现工具操作和文件；不能只听回复就认定完成。
4. 30秒无任务后回到等待唤醒；只喊名字会等待后续指令。关闭语音时徽标和菜单应同步改变。

文字测试可以直接在设置窗口输入同一任务。宿主必须保持运行且客户端连接。没有DSH会话选择确认时插件会报错，不会在隐藏会话悄悄执行。

## 5. 可选：配置Qwen流式TTS

基础安装不要求TTS，也不附带作者的参考录音或私人音色。只需要文字时跳过本节。当前提供的服务适配器面向NVIDIA CUDA；CPU语音识别不受此限制。显存与首句延迟依具体GPU而异。

推荐单独创建Python 3.10环境，与ASR隔离。安装与本机驱动匹配的PyTorch，下面是CUDA12.8示例；不匹配时遵循 https://pytorch.org/get-started/locally/ ：

```powershell
py -3.10 -m venv .runtime/qwen
.runtime/qwen/Scripts/python.exe -m pip install torch==2.9.1 torchaudio==2.9.1 --index-url https://download.pytorch.org/whl/cu128
.runtime/qwen/Scripts/python.exe -m pip install faster-qwen3-tts==0.5.4
.runtime/qwen/Scripts/hf.exe download Qwen/Qwen3-TTS-12Hz-0.6B-Base --local-dir .runtime/qwen-model
```

准备自己的干净中文参考录音WAV和准确对应的台词。把 `speech/voices.example.json` 复制到 `.runtime/my-voices.json`，把录音放在 `.runtime/my-reference.wav`，修改audio和text。参考路径相对JSON所在目录解析，voice名默认是default。

```powershell
.runtime/qwen/Scripts/python.exe speech/qwen-server.py --model=.runtime/qwen-model --voices=.runtime/my-voices.json
```

保持服务运行。看到“Qwen已就绪”后，用浏览器访问 http://127.0.0.1:9883/health 检查。若9883已被自己的其他服务占用，可改 `--port=9893` 并同步修改配置；不要关闭别人的服务。

在settings.local.json保留原有字段，加入：

```json
{
  "tts": {"provider":"qwen", "baseURL":"http://127.0.0.1:9883", "voice":"default"}
}
```

重新启用桌宠插件，并在设置里打开“角色声音”。完整结果留在DSH，桌宠只播报同一回合的简报，不额外请求摘要模型。小鸡毛等本地音效角色不调用Qwen。

自带适配器复用参考音色，不包含作者的多情绪参考库；不承诺与作者机器完全相同的音色、表演或速度。更改emotion字段不等于自动获得对应情绪录音。当前可选适配器完成语法和输入验证，尚未在一台干净NVIDIA电脑从零安装验收。

## 6. 检查、更新与卸载

```powershell
npm run doctor
npm test
```

诊断会列出Electron、模型缺失文件、语音进程、DSH前端连接与TTS配置。刚安装但未启用插件时DSH未连接是正常现象；缺失语音环境不影响基础文字模式。

更新前完成DSH当前任务，停用插件，把新版程序解压到原目录并保留settings.local.json与.runtime，再重新启用。重新运行安装脚本会保留设置并建立备份。由于link指向该目录，移动目录后需要重新安装。

卸载：在DSH插件管理中卸载本插件；如果使用官方CLI，执行 `dsh plugin --profile desktop remove dsh-dashifeiyu-pet`。退出桌宠后可自行删除解压目录及桌面快捷方式；工作区文件保留在用户目录dashifeiyu-pet-workspace，不自动删除。

## 已知边界与故障排查

- 看不到桌宠：插件详情点“启用/显示”；托盘双击移回主屏。检查artifacts/dsh-desktop.log；无需装旧dsh-pet。
- 打开麦克风没声音：先看徽标是否开启，再选设备并看音量；远控不一定把声音路由到系统默认输入。
- DSH会话没出现：doctor中dsh.uiConnected应为true；刷新DSH界面，检查插件客户端加载。
- TTS失败：先验证独立服务health、voice名称和模型；没准备TTS时关闭角色声音，继续文字模式。
- 模型下载失败：使用上面的离线压缩包参数。哈希不匹配不跳过校验，不覆盖已验证的文件。
- DSH收到任务不代表Windows操作一定成功：能力由DSH的工具、沙盒与审批决定。当前文件任务已实测；此前记事本与资源管理器窗口操作未通过，尚未宣称具备可靠的通用桌面操作。
- 本机环境检查与隔离目录测试通过不等于另一台实体电脑完整验收。完整证据见作者本地DSH-TEST-REPORT.md；真人UU麦克风验证仍未完成。
