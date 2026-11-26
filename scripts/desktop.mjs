import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { findElectron, readSettings } from './runtime.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const electron = findElectron(root, readSettings(root));
if (!electron) { console.error('未找到Electron。设置 DFY_ELECTRON 为已有electron.exe的完整路径；浏览器版可用 npm start。'); process.exit(1); }
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [resolve(root, 'desktop/main.cjs'), ...process.argv.slice(2)], { env, stdio: 'inherit', windowsHide: true });
child.on('error', e => { console.error(e.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
