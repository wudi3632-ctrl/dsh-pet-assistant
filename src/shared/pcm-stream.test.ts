import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FramedPcmParser, playFramedPcmResponse } from './pcm-stream.ts';

function framed(...payloads: Uint8Array[]): Uint8Array {
  const size = payloads.reduce((sum, item) => sum + 4 + item.length, 4);
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);
  let offset = 0;
  for (const payload of payloads) {
    view.setUint32(offset, payload.length, true);
    offset += 4;
    result.set(payload, offset);
    offset += payload.length;
  }
  view.setUint32(offset, 0, true);
  return result;
}

test('framed PCM parser accepts headers and payloads split at arbitrary bytes', () => {
  const parser = new FramedPcmParser();
  const bytes = framed(new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6]));
  const frames: Uint8Array[] = [];
  let terminal = false;
  for (const byte of bytes) {
    const parsed = parser.push(new Uint8Array([byte]));
    frames.push(...parsed.frames);
    terminal ||= parsed.terminal;
  }
  assert.deepEqual(frames.map((item) => [...item]), [
    [1, 2, 3, 4],
    [5, 6],
  ]);
  assert.equal(terminal, true);
});

test('framed PCM parser rejects odd frame sizes and bytes after terminal', () => {
  const odd = new Uint8Array(7);
  new DataView(odd.buffer).setUint32(0, 3, true);
  assert.throws(() => new FramedPcmParser().push(odd), /invalid PCM frame/);
  const parser = new FramedPcmParser();
  parser.push(framed(new Uint8Array([0, 0])));
  assert.throws(() => parser.push(new Uint8Array([1])), /after terminal/);
});

test('stable player schedules first audio after the advertised prebuffer and can stop cleanly', async () => {
  const previous = (globalThis as { AudioContext?: unknown }).AudioContext;
  const starts: number[] = [];
  const gains: number[] = [];
  class FakeAudioContext {
    currentTime = 0;
    state = 'running';
    destination = {};
    resume = async () => undefined;
    close = async () => undefined;
    createGain() {
      return { gain: { value: 1 }, connect: () => gains.push(1) };
    }
    createBuffer(_channels: number, samples: number, rate: number) {
      return { duration: samples / rate, getChannelData: () => new Float32Array(samples) };
    }
    createBufferSource() {
      return {
        buffer: null,
        connect: () => undefined,
        start: (at: number) => starts.push(at),
        stop: () => undefined,
      };
    }
  }
  (globalThis as { AudioContext?: unknown }).AudioContext = FakeAudioContext;
  try {
    const response = new Response(framed(new Uint8Array([0, 0])).buffer as ArrayBuffer, {
      headers: {
        'X-PCM-Sample-Rate': '1000',
        'X-PCM-Recommended-Buffer-Ms': '80',
      },
    });
    let started = 0;
    let stop: (() => void) | undefined;
    const metrics = await playFramedPcmResponse(response, {
      volume: 0.5,
      startedAt: performance.now(),
      onStart: () => {
        started += 1;
      },
      registerStop: (value) => {
        stop = value;
      },
    });
    assert.equal(started, 1);
    assert.ok(starts[0] >= 0.08);
    assert.equal(metrics.underruns, 0);
    assert.ok(stop);
    stop?.();
  } finally {
    (globalThis as { AudioContext?: unknown }).AudioContext = previous;
  }
});
