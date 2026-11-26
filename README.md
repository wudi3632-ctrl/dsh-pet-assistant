# 大肥鱼 · 原创桌宠

DSH 独立桌宠插件，不依赖第三方 dsh-pet。角色负责语音、动作、气泡与任务展示；DSH 原生 Agent 负责理解与执行。已接入60项原创透明WebM、768×768、24fps。

支持[切换桌宠形象与导入动作包](CHARACTERS.md)：大肥鱼保留，小鸡毛60动作透明WebM已本地接入。右键角色选择“更换桌宠形象…”。气泡和任务卡会避开屏幕边缘，角色可拖至工作区底部。

让宿主Agent自行安装请先读[安装入口](INSTALL.md)及[Agent指令](AGENTS.md)。请使用本仓库0.3.2及之后版本；旧版dsh-pet派生实现已由独立插件替换。角色看不到时运行`node scripts/desktop.mjs --show`移回主屏中央，或双击托盘图标。

2026-11-25 起定位为 **DSH 专用桌宠插件**。任务由 DSH Session Controller 的专属会话自动接收、执行和汇报，不需要聊天持续等待。Codex/WorkBuddy 适配退出默认安装与运行，旧代码和报告仅保留在 legacy/multi-host。0.3.1 已注册独立 DSH bundle，插件详情页可直接启停/设置/打开任务会话。当前验收见 [ACCEPTANCE.md](ACCEPTANCE.md)。

2026-11-25已在本机实际Electron窗口检查60项解码/播放及抽样Alpha、21次关键事件切换、idle两轮循环；详见[验收范围](ACCEPTANCE.md)。素材原始未批准标记保留，动作表现、完整接缝与真实指针牵引未据此自动放行。

## 已实现

- 60项动作清单、可抢占动作调度、双视频切换、缺失及解码失败回退。
- 浏览器预览与独立Electron透明置顶窗口；拖动、右键菜单、空白区点击穿透。
- 本地Sherpa关键词唤醒、VAD切句、ASR、30秒连续会话；启动即预热并常驻内存，休眠不卸载，唤醒词随角色切换。
- 单回合去重、播放期间只保留关键词检测、关键词打断、取消旧音频及迟到回复隔离。
- 使用现有TTS服务音色，分句合成、预取下一句；气泡随分句音频进度估算推进，最多显示最近64个字符并自动收起。
- 独立DSH插件、自动创建“桌宠语音”工作区与会话；执行前确认DSH客户端已切入真实会话，跟随当前模型并设low。
- DSH保留完整任务结果；桌宠仅播报同一回合的简报，不额外发起摘要模型请求。
- 真实工具开始、确认与失败事件；任务卡每回合重建，支持结构化计划和步骤进度。

**当前限制**：DSH桥接目前收集最终回复，从同回合结果取简短口播，再分句流式TTS，并非LLM token端到端流式。字级字幕使用音频时长估算，未接入强制对齐。默认DSH会话事件不包含完整todolist与鼠标轨迹；这些字段由未来工具适配器通过事件协议提供。桌宠不会根据“DSH回过话”推断Windows操作已成功。Windows操作能力取决于当前DSH已注册工具及其权限流程。

## 安装给自己或其他用户

从[Releases](https://github.com/wudi3632-ctrl/dsh-pet-assistant/releases/tag/v0.3.2)下载 **0.3.2 Windows source ZIP**，解压到固定目录。已安装DSH和Node.js 22+后，在该目录运行：

```powershell
node scripts/install.mjs
```

安装器自动找运行中的DSH与已有Electron；缺运行时则通过npm准备。进入 **DSH → 插件 → dsh-dashifeiyu-pet → 启用/显示桌宠** 即可先使用角色与文字任务。不需要旧dsh-pet，也不需要作者的配置或账号。

需要语音输入时，安装Python 3.11并运行：

```powershell
py -3.11 scripts/setup-speech.py
```

脚本自动准备CPU版唤醒/ASR模型与独立Python环境，校验下载并写入本机设置。第一次需要联网，之后模型本地常驻。Qwen TTS为可选项，有完整服务示例、依赖安装与自备参考录音教程，不要求基础安装用户下载大模型。

**完整教程：[INSTALL.md](INSTALL.md)**，包括下载正确版本、安装、首次任务、麦克风、离线模型、Qwen、诊断、更新和卸载。

```powershell
npm run doctor
```

也可克隆本仓库后执行相同安装命令：`git clone https://github.com/wudi3632-ctrl/dsh-pet-assistant.git`。本版是独立实现，升级旧版前先在DSH中停用旧版插件，避免两个桌宠同时运行。

纯浏览器开发预览可运行 `npm start` 后打开 http://127.0.0.1:57832/；透明桌面运行 `npm run desktop`。DSH任务仍需已启用插件和已连接的DSH客户端。

本地配置保存在被Git忽略的settings.local.json，模型/虚拟环境在.runtime。不要将私人配置、参考录音或会话一起上传。程序与素材分发边界见[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 替换原创动画

1. 把WebM放入`public/assets/motions/`。
2. 编辑`public/assets/motions.json`，找到同名动作ID并设置`enabled: true`。当前交付文件名为`dfy_<id>_v002_768_24.webm`。
3. 点击“重新读取动画清单”；不需要重写动作调度代码。
4. 以透明背景、实际脚底锚点及循环接缝验收。牵引动作需填写实测`handAnchor`再接通鼠标轨迹定位；现阶段只显示牵引状态占位，不会主动移动真实光标。

当前交付为768×768、24fps、VP9 Alpha WebM、无音轨。动作清单在public/assets/motions.json。素材不可用才显示占位。

## 事件接入

`POST /api/events`支持本机工具适配器发送真实事件，需请求头`x-pet-client: 1`；前端通过`GET /api/events`接收。

```json
{"type":"task.plan","turnId":"当前回合ID","seq":3,"steps":[{"id":"open","label":"打开浏览器"}]}
```

```json
{"type":"tool.progress","turnId":"当前回合ID","seq":4,"stepId":"open","status":"completed"}
```

回合ID必须对应当前回合，seq单调增加。支持`voice.*`、`turn.*`、`tool.started`、`tool.progress`、`approval.required`、`audio.*`、`pointer.move`、`pointer.arrived`、`pointer.click`。鼠标事件只表达执行器引起的操作，不追随用户自由移动鼠标；目前还没有从所有DSH Windows工具自动提取轨迹。桌面模式收到pointer事件时临时全窗穿透，避免操作点击角色。

## 验证

```powershell
npm test
python tests/browser_acceptance.py
python tests/live_voice_probe.py
python tests/microphone_acceptance.py
```

后3项需要已启动浏览器版服务，浏览器测试还需要Python Playwright与Chromium，真实语音探测使用现有TTS服务和ffmpeg。

测试边界与结果见[ACCEPTANCE.md](ACCEPTANCE.md)。浏览器截图保存在被Git忽略的`artifacts/`。
