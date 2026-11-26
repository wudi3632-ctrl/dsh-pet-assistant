import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, openSync, closeSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { findElectron, readSettings } from './runtime.mjs';
import {findDSHCLI} from './dsh-paths.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const host = option('host')||'dsh';
if (args.includes('--help')) {
  console.log('node scripts/install.mjs [--host=dsh] [--no-start] [--no-shortcut] [--skip-runtime-install] [--dsh-profile=C:/path]');
  process.exit(0);
}
if (process.platform !== 'win32') throw new Error('当前桌面安装器支持Windows。');
if(host!=='dsh')throw new Error('本项目已改为DSH专用插件，仅支持 --host=dsh');
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('需要Node.js 22或更新版本。');
const settings = readSettings(root);
let electron = findElectron(root, settings);
if (!electron && !args.includes('--skip-runtime-install')) {
  // Fixed command: no paths or user text interpolated into the shell.
  execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm install --no-audit --no-fund'], { cwd: root, stdio: 'inherit', windowsHide: true });
  electron = findElectron(root, settings);
}
if (!electron) throw new Error('未找到Electron。运行npm install或设置DFY_ELECTRON后重试。');
const catalog = JSON.parse(readFileSync(join(root, 'public/assets/motions.json'), 'utf8'));
const missing = catalog.motions.filter(m => m.enabled && !existsSync(resolve(root, 'public', '.' + m.src)));
if (missing.length) throw new Error('动画素材缺失：' + missing.map(m => m.id).join(', ') + '。需要完整仓库/Release素材，不能只下载源代码清单。');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const configPath = join(root, 'settings.local.json');
if (existsSync(configPath)) copyFileSync(configPath, `${configPath}.before-install-${stamp}.bak`);
settings.defaultBackend='dsh';settings.lockHost='dsh';settings.integration='dsh-plugin';delete settings.codex;delete settings.workbuddy;
settings.electron = electron;
settings.cwd ||= join(homedir(), 'dashifeiyu-pet-workspace');
mkdirSync(settings.cwd, { recursive: true });
writeFileSync(configPath, JSON.stringify(settings, null, 2) + '\n');
const profile = option('dsh-profile') || join(process.env.DSH_HOME||join(homedir(),'.dsh'), 'profiles/desktop');
const patch=join(profile,'cordis.patch.yml');
const begin='# === dashifeiyu original pet bridge BEGIN ===',end='# === dashifeiyu original pet bridge END ===';
if(existsSync(patch)){
  const original=readFileSync(patch,'utf8'),start=original.indexOf(begin),stop=original.indexOf(end);
  if((start<0)!==(stop<0)||(start>=0&&stop<start))throw Error('旧桥接配置标记不完整，保留原文件');
  if(start>=0){copyFileSync(patch,`${patch}.before-native-pet-${stamp}.bak`);writeFileSync(patch,original.slice(0,start)+original.slice(stop+end.length));}
}
const cli=args.includes('--skip-plugin-registration')?null:findDSHCLI(root,settings,option('dsh-cli'));
let pluginRegistered=false;
if(!args.includes('--skip-plugin-registration')){
  if(!cli)throw Error('未找到DSH官方安装命令。请打开DSH后重试，或指定 --dsh-cli=C:/path/dsh.cmd');
  const quote=s=>"'"+s.replaceAll("'","''")+"'";
  execFileSync('powershell.exe',['-NoProfile','-Command',`$env:DSH_HOME=${quote(dirname(dirname(profile)))}; & ${quote(cli)} plugin --profile ${quote(basename(profile))} add ${quote('link:'+root)}; exit $LASTEXITCODE`],{windowsHide:true,stdio:'inherit',timeout:180000});
  const installed=JSON.parse(readFileSync(join(profile,'package.json'),'utf8'));
  pluginRegistered=Boolean(installed.dependencies?.['dsh-dashifeiyu-pet'])&&installed.dsh?.profile?.bundles?.includes('dsh-dashifeiyu-pet');
  if(!pluginRegistered)throw Error('DSH命令完成，但插件未进入profile依赖与bundle列表');
}
const bridge=pluginRegistered?'独立DSH插件已安装；重载插件/界面后运行 npm run doctor 检查客户端连接':'仅生成安装文件，未注册插件';
// Visible desktop shortcut; launch without leaving a console window.
const vbsQuote = s => '"' + s.replaceAll('"', '""') + '"';
const command = `"${process.execPath}" "${join(root, 'scripts/desktop.mjs')}" --host=${host} --show`;
const launcher = join(root, `start-${host}.vbs`);
writeFileSync(launcher, `Set s = CreateObject("WScript.Shell")\r\ns.Run ${vbsQuote(command)}, 0, False\r\n`);
if (!args.includes('--no-shortcut')) {
  const psQuote = s => "'" + s.replaceAll("'", "''") + "'";
  const script = `$w=New-Object -ComObject WScript.Shell; $p=Join-Path ([Environment]::GetFolderPath('Desktop')) ${psQuote('大肥鱼-' + host + '.lnk')}; $s=$w.CreateShortcut($p); $s.TargetPath=Join-Path $env:WINDIR 'System32/wscript.exe'; $s.Arguments=${psQuote('"' + launcher + '"')}; $s.WorkingDirectory=${psQuote(root)}; $s.Save()`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true });
}
console.log(JSON.stringify({configured:true,pluginRegistered,host,root,electron,bridge,transport:'dsh-session-bridge',launcher,speech:'复用已有ASR/TTS；未下载模型'},null,2));
if (!args.includes('--no-start')) {
  const log = join(root, 'artifacts'); mkdirSync(log, { recursive: true });
  const fd = openSync(join(log, 'desktop-launch.log'), 'a');
  const child = spawn(process.execPath, [join(root, 'scripts/desktop.mjs'), `--host=${host}`, '--show'], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', fd, fd] });
  child.on('error', e => console.error(e.message)); child.unref(); closeSync(fd);
}
