import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalSpeech } from '../speech/local.mjs';
import { readSettings, findElectron } from './runtime.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const settings=readSettings(root);
const manifest=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')); 
const catalog = JSON.parse(readFileSync(resolve(root, 'public/assets/motions.json'), 'utf8'));
const missing = catalog.motions.filter(m => m.enabled && !existsSync(resolve(root, 'public', '.' + m.src))).map(m => m.id);
let bridge;
try { bridge = await (await fetch((settings.agent || 'http://127.0.0.1:57833') + '/health', {signal:AbortSignal.timeout(1500)})).json(); } catch { bridge = {available:false}; }
const speech = createLocalSpeech();
console.log(JSON.stringify({package:manifest.name,version:manifest.version,node:process.versions.node,electron:findElectron(root,settings)||null,defaultBackend:'dsh',lockedHost:'dsh',integration:'dsh-plugin',animations:{total:catalog.motions.length,missing},dsh:bridge,localASR:speech.available,speech:speech.status(),speechSetup:'py -3.11 scripts/setup-speech.py',tts:settings.tts?.provider==='qwen'?{provider:'qwen',url:settings.tts.baseURL,voice:settings.tts.voice}:{provider:null,optional:true,help:'未配置TTS；可使用文字/气泡，配置见INSTALL.md第5节'},authentication:'任务成功仍需独立核验实际结果'},null,2));
if (missing.length || !findElectron(root, settings)) process.exitCode=1;
