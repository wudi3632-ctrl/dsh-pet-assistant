import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { createBridge } = require(resolve('runtime/electron-helper/main/bridge.js')) as {
  createBridge(options: Record<string, unknown>): {
    startCallback(): import('node:http').Server;
    handle(request: Request): Promise<Response>;
  };
};

test('desktop bridge forwards callback bytes before the stream completes', async () => {
  const prefix = 'test-bridge:';
  const bridge = createBridge({ isBridge: true, prefix, origin: '', token: '' });
  const server = bridge.startCallback();
  if (!server.listening) await once(server, 'listening');
  const originalWrite = process.stdout.write.bind(process.stdout);
  let firstWriteAt = 0;
  let finishWrite: (() => void) | undefined;
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    const line = String(chunk);
    if (!line.startsWith(prefix)) return true;
    const message = JSON.parse(line.slice(prefix.length)) as { id: number; cb: string };
    const target = new URL(message.cb);
    target.pathname = '/stream';
    target.search = `?id=${message.id}`;
    const outgoing = request(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-dfy-pcm16',
        'x-dsh-pet-status': '200',
        'x-dsh-pet-headers': Buffer.from(
          JSON.stringify({ 'x-pcm-sample-rate': '24000', 'x-pcm-recommended-buffer-ms': '1200' }),
        ).toString('base64url'),
      },
    });
    outgoing.write(Buffer.from([2, 0, 0, 0, 1, 2]));
    firstWriteAt = Date.now();
    finishWrite = () => outgoing.end(Buffer.alloc(4));
    return true;
  }) as typeof process.stdout.write;
  try {
    const response = await bridge.handle(
      new Request('dsh-pet-bridge://dsh-pet/dsh-pet-7340/voice/speak/stream', {
        method: 'POST',
        body: '{}',
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-pcm-sample-rate'), '24000');
    const reader = response.body?.getReader();
    assert.ok(reader);
    const first = await reader.read();
    assert.equal(first.done, false);
    assert.ok(Date.now() - firstWriteAt < 1_000, 'first bytes must not wait for stream completion');
    finishWrite?.();
    const chunks = [first.value];
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
    }
    assert.deepEqual([...Buffer.concat(chunks.map((item) => Buffer.from(item ?? [])))], [2, 0, 0, 0, 1, 2, 0, 0, 0, 0]);
  } finally {
    process.stdout.write = originalWrite;
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
});
