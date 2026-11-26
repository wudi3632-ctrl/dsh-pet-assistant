# 来源与分发边界

本项目是独立DSH插件，不包含第三方dsh-pet实现。DSH由用户单独安装，遵守其许可与服务条款。

程序代码采用MIT许可。Electron、Python、NumPy、Sherpa-ONNX、PyTorch、faster-qwen3-tts与Qwen模型均为独立上游项目，其许可与模型卡保留效力；本项目的MIT许可不覆盖上游权重、商标、参考音频或角色IP。

- Sherpa-ONNX：https://github.com/k2-fsa/sherpa-onnx ，模型来源与校验值见speech/models.json。分发包不包含模型权重；脚本按需从上游下载。
- faster-qwen3-tts：https://github.com/andimarafioti/faster-qwen3-tts
- Qwen3-TTS：https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base
- Electron：https://github.com/electron/electron

角色素材与程序许可分开。大肥鱼WebM随本桌宠提供使用；角色图像与动作不因程序MIT许可自动变成公共领域。用户导入的小鸡毛/线条小狗角色包和狗叫、私人参考录音、情绪参考库、本地会话及账号设置不进入发布白名单。示例仅要求用户填入自己的参考录音，不随包提供作者私人音色。
