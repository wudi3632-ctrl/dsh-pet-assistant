# Contributing

欢迎提交问题和 Pull Request。开始前请先确认改动不包含模型权重、运行时、个人音频、日志、聊天数据、密钥或本机绝对路径。

```powershell
corepack enable
pnpm install
pnpm test
pnpm run typecheck
pnpm run lint
```

Windows 自动化改动应同时提供：最小单元测试、失败时的安全行为、需要人工确认的动作说明，以及至少一条真实桌面手工测试记录。涉及素材的提交必须说明来源和许可。
