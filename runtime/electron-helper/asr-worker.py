"""Persistent sherpa-onnx streaming Paraformer + keyword-spotting worker."""
import argparse
import base64
import io
import json
import sys
import time
import wave
from pathlib import Path

try:
    import numpy as np
    import sherpa_onnx
except ImportError as error:
    raise RuntimeError(
        "numpy and sherpa-onnx are required; run this worker with DSH_PET_ASR_PYTHON"
    ) from error


def reply(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def wav_samples(data):
    with wave.open(io.BytesIO(data), "rb") as handle:
        if handle.getnchannels() != 1 or handle.getsampwidth() != 2 or handle.getframerate() != 16000:
            raise ValueError("expected mono 16-bit 16 kHz WAV")
        return np.frombuffer(handle.readframes(handle.getnframes()), dtype="<i2").astype(np.float32) / 32768.0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    # Compatibility with a host process that was started before the sherpa upgrade.
    parser.add_argument("--model")
    args = parser.parse_args()
    root = Path(args.root).expanduser().resolve()
    asr = root / "streaming-paraformer-bilingual-int8"
    kws = root / "sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20"
    recognizer = sherpa_onnx.OnlineRecognizer.from_paraformer(
        tokens=str(asr / "tokens.txt"), encoder=str(asr / "encoder.int8.onnx"),
        decoder=str(asr / "decoder.int8.onnx"), num_threads=2, sample_rate=16000,
        feature_dim=80, enable_endpoint_detection=True, rule1_min_trailing_silence=2.0,
        rule2_min_trailing_silence=0.8, rule3_min_utterance_length=15.0,
        decoding_method="greedy_search", provider="cpu",
    )
    spotter = sherpa_onnx.KeywordSpotter(
        tokens=str(kws / "tokens.txt"),
        encoder=str(kws / "encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx"),
        decoder=str(kws / "decoder-epoch-13-avg-2-chunk-16-left-64.onnx"),
        joiner=str(kws / "joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx"),
        keywords_file=str(root / "keywords-dsh-pet.txt"), num_threads=2,
        sample_rate=16000, feature_dim=80, max_active_paths=4,
        keywords_score=1.5, keywords_threshold=0.25, num_trailing_blanks=1, provider="cpu",
    )
    sessions = {}
    sys.stderr.write("ready sherpa-onnx paraformer-int8+kws\n")
    sys.stderr.flush()
    for line in sys.stdin:
        request = None
        try:
            request = json.loads(line)
            request_id = int(request["id"])
            op = str(request.get("op") or "transcribe")
            started = time.perf_counter()
            if op == "transcribe":
                samples = wav_samples(base64.b64decode(request["audio"], validate=True))
                stream = recognizer.create_stream()
                for offset in range(0, len(samples), 1600):
                    stream.accept_waveform(16000, samples[offset:offset + 1600])
                    while recognizer.is_ready(stream):
                        recognizer.decode_stream(stream)
                stream.accept_waveform(16000, np.zeros(12800, dtype=np.float32))
                stream.input_finished()
                while recognizer.is_ready(stream):
                    recognizer.decode_stream(stream)
                text = recognizer.get_result(stream).strip()
                reply({"id": request_id, "ok": True, "text": text,
                       "decode_ms": round((time.perf_counter() - started) * 1000, 1)})
            elif op == "kws":
                session_id = str(request.get("session") or "default")
                if request.get("reset"):
                    sessions.pop(session_id, None)
                    reply({"id": request_id, "ok": True, "keyword": ""})
                    continue
                item = sessions.get(session_id)
                if item is None:
                    item = [spotter.create_stream(), time.monotonic()]
                    sessions[session_id] = item
                samples = np.frombuffer(base64.b64decode(request["audio"], validate=True), dtype="<i2").astype(np.float32) / 32768.0
                item[0].accept_waveform(16000, samples)
                while spotter.is_ready(item[0]):
                    spotter.decode_stream(item[0])
                keyword = spotter.get_result(item[0])
                item[1] = time.monotonic()
                if keyword:
                    spotter.reset_stream(item[0])
                now = time.monotonic()
                for key in [key for key, value in sessions.items() if now - value[1] > 30]:
                    sessions.pop(key, None)
                reply({"id": request_id, "ok": True, "keyword": keyword,
                       "decode_ms": round((time.perf_counter() - started) * 1000, 1)})
            else:
                raise ValueError("unsupported op")
        except Exception as error:
            reply({"id": request.get("id") if isinstance(request, dict) else 0,
                   "ok": False, "message": str(error)})


if __name__ == "__main__":
    main()
