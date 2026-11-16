# 模型与音色

仓库不分发模型和个人音频。下面是兼顾体积、速度与质量的推荐组合。

## sherpa-onnx ASR/KWS

从 sherpa-onnx 官方发布页下载对应压缩包：

- [ASR models](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models)：`streaming-paraformer-bilingual-int8`
- [KWS models](https://github.com/k2-fsa/sherpa-onnx/releases/tag/kws-models)：`sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20`

最终目录必须是：

```text
D:\AI\speech\sherpa-onnx\
├─ .venv\Scripts\python.exe
├─ streaming-paraformer-bilingual-int8\
│  ├─ tokens.txt
│  ├─ encoder.int8.onnx
│  └─ decoder.int8.onnx
├─ sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20\
│  ├─ tokens.txt
│  ├─ encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx
│  ├─ decoder-epoch-13-avg-2-chunk-16-left-64.onnx
│  └─ joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx
└─ keywords-dsh-pet.txt
```

不要多套一层同名目录。可用 `scripts/doctor-windows.ps1` 精确检查每个文件。

## Qwen3-TTS

实时桌宠和直播推荐 [Qwen3-TTS 0.6B Base](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base)，上游项目为 [QwenLM/Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS)。本项目测试过的关键版本包括 `faster-qwen3-tts 0.5.4`、`torch/torchaudio 2.9.1+cu128`、`numpy 2.2.6` 和 `soundfile 0.14.0`；CUDA/PyTorch 必须按显卡和驱动从官方渠道选择，不要直接照搬别人的 CUDA wheel。

参考音建议：

- 5–12 秒，单人、无 BGM、无混响、无降噪水声
- 语速和情绪接近日常目标风格
- 提供完全准确的逐字稿，包括语气词
- 不混合不同音色或不同变声器参数
- 只使用本人或已明确授权的声音

情绪参考最好分别录制/生成开心、温柔、难过、生气、严肃和中性片段，并使用符合该情绪的台词。情绪与台词相反会造成音色漂移或表演违和。

## CosyVoice

[FunAudioLLM/CosyVoice](https://github.com/FunAudioLLM/CosyVoice) 更适合质量优先或生成情绪参考音。安装和模型版本耦合较强，请按上游 CUDA、PyTorch、ModelScope/Hugging Face 指南创建独立环境，不要与 Qwen TTS 共用 venv。

## 性能目标

“RTF < 1”只代表合成速度快于播放时长，不等于首包实时。真实体验还取决于首包延迟、分句策略、音频缓冲、LLM 首 token 和并发。实时场景建议 0.6B 模型、GPU 常驻、服务预热和短分句流式输出；CPU-only 可运行但通常无法达到理想实时性。
