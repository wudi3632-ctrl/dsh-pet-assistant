import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FramedPcmCollector, writePcmCache } from './pcm-cache.ts';

function frame(payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length);
  return Buffer.concat([header, payload]);
}

test('collector builds a mono PCM16 WAV only after a terminal frame', async () => {
  const collector = new FramedPcmCollector();
  const wire = Buffer.concat([frame(Buffer.from([0, 0, 255, 127])), Buffer.alloc(4)]);
  for (let offset = 0; offset < wire.length; offset += 3) collector.push(wire.subarray(offset, offset + 3));
  const wav = collector.wav(24_000);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt32LE(24), 24_000);
  assert.equal(wav.readUInt32LE(40), 4);

  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-pcm-cache-'));
  const target = join(root, 'voice.wav');
  try {
    await writePcmCache(target, wav);
    assert.deepEqual(await readFile(target), wav);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('collector rejects truncated streams', () => {
  const collector = new FramedPcmCollector();
  collector.push(frame(Buffer.from([0, 0])));
  assert.throws(() => collector.wav(24_000), /ended early/);
});
