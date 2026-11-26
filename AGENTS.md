# DSH 桌宠插件

本项目只支持 DeepSeek Harness（DSH），不属于大肥鱼工作台，不再安装到 Codex 或 WorkBuddy。旧适配不参与本项目默认运行或验收，也不随独立插件分发。

安装：阅读 INSTALL.md，运行 node scripts/install.mjs。需要Node >=22；安装器复用或下载Electron，语音模型通过scripts/setup-speech.py独立准备。安装器备份本地配置、迁移旧桥接区块并调用DSH官方plugin add注册独立bundle；保留其他插件、角色素材、音色与用户配置，不复制账号凭据。需要重载时采用 DSH 正常插件重载/重启，不强制中断其他任务。

执行：桌宠负责本地关键词唤醒/VAD/ASR、动作、气泡、任务卡和角色声音；dsh-bridge 通过 Session Controller 在专属工作区会话执行任务，沿用 DSH 模型、low 推理和权限流程。任务必须先收到DSH客户端已选择实际会话的确认；无需 pet_next 或保持一段聊天等待，不使用模拟宿主输入或外部模型 CLI。

验证：分别检查 DSH 任务桥可用、真实工具结果、本地语音和实际 Electron 展示。真人语音验证已由用户明确跳过，用合成音频测试时必须注明。模型说完成不等于实际操作成功。不要改动 QQ、网络或其他宿主设置。

角色：大肥鱼保留原唤醒词与 Qwen TTS；小鸡毛仅以“小鸡毛”唤醒，使用本地狗叫和屏幕中心朝向，切换不影响任务宿主。保留全部 WebM 和用户声音。

分发：运行npm run release:local生成白名单源码ZIP和tgz，不自动发布；完整安装教程在INSTALL.md。默认只分发大肥鱼动作，不打包私人音色、导入角色或模型。
