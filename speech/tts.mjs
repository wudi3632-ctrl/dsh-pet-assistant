export function framedPCMToWav(data, sampleRate = 24000) {
  const parts = []; let offset = 0, total = 0, terminal = false;
  while (offset + 4 <= data.length) {
    const size = data.readUInt32LE(offset); offset += 4;
    if (size === 0) { terminal = true; break; }
    if (size % 2 || size > 8*1024*1024 || offset + size > data.length) throw new Error('Qwen音频帧损坏');
    parts.push(data.subarray(offset,offset+size)); total+=size; offset+=size;
  }
  if (!terminal || !total || offset !== data.length || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new Error('Qwen音频不完整');
  const header = Buffer.alloc(44); header.write('RIFF');header.writeUInt32LE(36+total,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(sampleRate,24);header.writeUInt32LE(sampleRate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(total,40);
  return Buffer.concat([header,...parts]);
}
export async function streamQwen(config, payload, signal) {
  const base = new URL(config.baseURL || 'http://127.0.0.1:9883');
  if (!['127.0.0.1','localhost','[::1]'].includes(base.hostname) || !['http:','https:'].includes(base.protocol)) throw new Error('TTS服务必须是本机HTTP地址');
  if (typeof payload.text!=='string'||!payload.text.trim()||payload.text.length>500) throw new Error('TTS文本应为1至500字');
  const emotion = ({soft:'gentle',shy:'gentle',surprise:'happy',pout:'angry'})[payload.emotion] || payload.emotion || 'neutral';
  const response = await fetch(new URL('/tts/stream',base),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:payload.text,voice:config.voice||'default',emotion,speed:config.speed||'normal'}),signal:AbortSignal.any([signal,AbortSignal.timeout(90000)]),redirect:'error'});
  if (!response.ok || !response.headers.get('content-type')?.includes('application/x-dfy-pcm16')) throw new Error('Qwen语音服务返回异常：'+response.status);
  return response;
}
export async function synthesizeQwen(config, payload, signal) {
  const response = await streamQwen(config,payload,signal);
  const chunks=[]; let size=0;
  for await(const chunk of response.body) {size+=chunk.length;if(size>16*1024*1024) throw new Error('TTS音频超过限制');chunks.push(chunk);}
  return framedPCMToWav(Buffer.concat(chunks),Number(response.headers.get('x-pcm-sample-rate')||24000));
}
