/** Incremental validation and WAV assembly for CosyVoice framed PCM16. */
import { rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/** Collects validated PCM payloads while preserving arbitrary network chunking. */
export class FramedPcmCollector {
  declare private pending: Buffer;
  declare private expected: number | null;
  declare private readonly pcm: Buffer[];
  declare private terminal: boolean;

  constructor() {
    this.pending = Buffer.alloc(0);
    this.expected = null;
    this.pcm = [];
    this.terminal = false;
  }

  push(value: Uint8Array): boolean {
    if (this.terminal) {
      if (value.byteLength > 0) throw new Error('PCM bytes after terminal frame');
      return true;
    }
    const incoming = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    this.pending = this.pending.length === 0 ? Buffer.from(incoming) : Buffer.concat([this.pending, incoming]);
    while (true) {
      if (this.expected === null) {
        if (this.pending.length < 4) break;
        this.expected = this.pending.readUInt32LE(0);
        this.pending = this.pending.subarray(4);
        if (this.expected === 0) {
          if (this.pending.length !== 0) throw new Error('PCM bytes after terminal frame');
          this.expected = null;
          this.terminal = true;
          return true;
        }
        if (this.expected > MAX_FRAME_BYTES || this.expected % 2 !== 0) {
          throw new Error('invalid PCM frame length');
        }
      }
      if (this.pending.length < this.expected) break;
      this.pcm.push(Buffer.from(this.pending.subarray(0, this.expected)));
      this.pending = this.pending.subarray(this.expected);
      this.expected = null;
    }
    return false;
  }

  wav(sampleRate: number): Buffer {
    if (!this.terminal || this.expected !== null || this.pending.length !== 0 || this.pcm.length === 0) {
      throw new Error('PCM stream ended early');
    }
    const payload = Buffer.concat(this.pcm);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(36 + payload.length, 4);
    header.write('WAVE', 8, 'ascii');
    header.write('fmt ', 12, 'ascii');
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36, 'ascii');
    header.writeUInt32LE(payload.length, 40);
    return Buffer.concat([header, payload]);
  }
}

/** Publish a complete cache entry atomically; partial files never become hits. */
export async function writePcmCache(target: string, wav: Buffer): Promise<void> {
  const temp = `${target}.${randomUUID()}.part`;
  try {
    await writeFile(temp, wav);
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}
