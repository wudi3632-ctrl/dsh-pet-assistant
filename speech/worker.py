"""Local CPU speech worker; PCM16 keyword input, 16kHz mono WAV transcription."""
import argparse
import base64
import io
import json
import sys
import time
import wave
from pathlib import Path
import numpy as np
import sherpa_onnx

parser = argparse.ArgumentParser()
parser.add_argument('--root', required=True)
args = parser.parse_args()
root = Path(args.root)
asr = root / 'streaming-paraformer-bilingual-int8'
kws = root / 'sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20'
recognizer = sherpa_onnx.OnlineRecognizer.from_paraformer(
    tokens=str(asr / 'tokens.txt'), encoder=str(asr / 'encoder.int8.onnx'),
    decoder=str(asr / 'decoder.int8.onnx'), num_threads=2, sample_rate=16000,
    feature_dim=80, decoding_method='greedy_search', provider='cpu',
)
spotter = sherpa_onnx.KeywordSpotter(
    tokens=str(kws / 'tokens.txt'),
    encoder=str(kws / 'encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx'),
    decoder=str(kws / 'decoder-epoch-13-avg-2-chunk-16-left-64.onnx'),
    joiner=str(kws / 'joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx'),
    keywords_file=str(Path(__file__).with_name('keywords.txt')), num_threads=2,
    sample_rate=16000, feature_dim=80, max_active_paths=4,
    keywords_score=1.5, keywords_threshold=0.25, num_trailing_blanks=1, provider='cpu',
)
sessions = {}
print('Local speech ready', file=sys.stderr, flush=True)
for line in sys.stdin:
    request = {}
    try:
        request = json.loads(line)
        raw = base64.b64decode(request['audio'], validate=True)
        started = time.perf_counter()
        if request['op'] == 'warmup':
            result = {'ready': True}
        elif request['op'] == 'hear':
            with wave.open(io.BytesIO(raw), 'rb') as audio:
                if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 16000):
                    raise ValueError('ASR需要16kHz单声道PCM16 WAV')
                samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype='<i2').astype(np.float32) / 32768
            if len(samples) > 16000 * 30:
                raise ValueError('音频超过30秒')
            stream = recognizer.create_stream()
            for offset in range(0, len(samples), 1600):
                stream.accept_waveform(16000, samples[offset:offset+1600])
                while recognizer.is_ready(stream):
                    recognizer.decode_stream(stream)
            stream.accept_waveform(16000, np.zeros(12800, dtype=np.float32))
            stream.input_finished()
            while recognizer.is_ready(stream):
                recognizer.decode_stream(stream)
            result = {'text': recognizer.get_result(stream).strip()}
        elif request['op'] == 'kws':
            if len(raw) % 2 or len(raw) > 16000 * 2 * 3:
                raise ValueError('唤醒输入应为不超过3秒的PCM16片段')
            key = str(request.get('session', 'default'))[:100]
            now = time.monotonic()
            sessions = {k: v for k, v in sessions.items() if now-v[1] < 45}
            if key not in sessions:
                if len(sessions) >= 8:
                    sessions.pop(next(iter(sessions)))
                sessions[key] = [spotter.create_stream(), now]
            stream = sessions[key][0]
            samples = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768
            stream.accept_waveform(16000, samples)
            while spotter.is_ready(stream):
                spotter.decode_stream(stream)
            keyword = spotter.get_result(stream)
            if keyword:
                spotter.reset_stream(stream)
            sessions[key][1] = now
            result = {'keyword': keyword}
        else:
            raise ValueError('不支持的操作')
        result.update(id=request['id'], ok=True, decodeMs=round((time.perf_counter()-started)*1000, 1))
    except Exception as error:
        result = {'id': request.get('id'), 'ok': False, 'message': str(error)}
    print(json.dumps(result, ensure_ascii=False), flush=True)
