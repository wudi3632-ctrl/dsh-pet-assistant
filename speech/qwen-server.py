"""Optional localhost Qwen TTS adapter. No bundled voices or account credentials."""
import argparse
import json
from pathlib import Path
import struct
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

def validate(payload, voices):
    if not isinstance(payload, dict):
        raise ValueError('需要JSON对象')
    text = payload.get('text')
    if not isinstance(text, str) or not text.strip() or len(text) > 500:
        raise ValueError('text需要1至500字')
    voice = payload.get('voice', 'default')
    if voice not in voices:
        raise ValueError('未配置该voice')
    return text.strip(), voice

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', required=True, help='本地Qwen3-TTS-12Hz-0.6B-Base目录')
    parser.add_argument('--voices', required=True, type=Path, help='自己的参考录音配置JSON')
    parser.add_argument('--port', type=int, default=9883)
    args = parser.parse_args()
    import numpy as np
    import torch
    from faster_qwen3_tts import FasterQwen3TTS
    if not torch.cuda.is_available():
        raise RuntimeError('此流式配置需要NVIDIA CUDA显卡；未配置时使用文字模式即可')
    voices = json.loads(args.voices.read_text('utf-8'))
    for profile in voices.values():
        audio = (args.voices.resolve().parent / profile['audio']).resolve()
        if not audio.is_file() or not str(profile['text']).strip():
            raise ValueError('参考音频不存在或参考台词为空')
        profile['audio'] = str(audio)
    model = FasterQwen3TTS.from_pretrained(args.model, device='cuda', dtype=torch.bfloat16,
        attn_implementation='sdpa', max_seq_len=512, local_files_only=True)
    model.warmup(prefill_len=100)
    prompts = {key: model.model.create_voice_clone_prompt(ref_audio=p['audio'], ref_text=p['text'], x_vector_only_mode=False) for key, p in voices.items()}
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def trusted(self):
            return self.headers.get('Host', '').split(':')[0] in ('127.0.0.1', 'localhost') and not self.headers.get('Origin')

        def do_GET(self):
            if not self.trusted():
                self.send_error(403); return
            if self.path != '/health':
                self.send_error(404); return
            data = json.dumps({'ok': True, 'engine': 'faster-qwen3-tts', 'voices': list(voices)}).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)

        def do_POST(self):
            if not self.trusted():
                self.send_error(403); return
            if self.path != '/tts/stream':
                self.send_error(404); return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 16384:
                    raise ValueError('请求长度不合法')
                payload = json.loads(self.rfile.read(length))
                text, voice = validate(payload, voices)
            except (ValueError, TypeError) as error:
                self.send_error(400, str(error).encode('ascii', 'replace').decode()); return
            # One GPU generation at a time; response ends if the client disconnects.
            with lock:
                self.send_response(200)
                self.send_header('Content-Type', 'application/x-dfy-pcm16')
                self.send_header('X-PCM-Sample-Rate', '24000')
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                try:
                    for audio, rate, _ in model.generate_voice_clone_streaming(text=text, language='Chinese',
                        ref_text=voices[voice]['text'], voice_clone_prompt=prompts[voice], chunk_size=8, max_new_tokens=600):
                        if rate != 24000:
                            raise ValueError('Qwen返回了非24kHz音频')
                        pcm = (np.clip(np.asarray(audio), -1, 1) * 32767).astype('<i2').tobytes()
                        self.wfile.write(struct.pack('<I', len(pcm)) + pcm); self.wfile.flush()
                    self.wfile.write(struct.pack('<I', 0)); self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass
                except Exception as error:
                    # No terminal frame: client rejects partial synthesis as incomplete.
                    print('TTS失败:', repr(error), flush=True)

    print('Qwen已就绪: http://127.0.0.1:' + str(args.port), flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()

if __name__ == '__main__':
    main()
