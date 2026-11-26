const { app, BrowserWindow, ipcMain, screen, Menu, session, Tray, nativeImage } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {clampPetPosition}=require('./geometry.cjs');
const petWindowSize={width:640,height:680};
let petRect={x:160,y:200,width:240,height:240},petExtent=petRect;
app.setName('dashifeiyu-original-pet');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (process.platform === 'win32') app.disableHardwareAcceleration();
let win, server, base, settingsWindow, regions = [], ignore = false, pointerTimer, automationUntil = 0;
let dragging = false, moveTimer;
let switchQueue=Promise.resolve();
let tray;
let microphoneState={phase:'off',running:false,detail:'麦克风已关闭'};
const microphonePending=()=>['starting','stopping'].includes(microphoneState.phase);
function microphoneMenuItem(){return {label:microphoneState.phase==='starting'?'正在启动麦克风…':microphoneState.phase==='stopping'?'正在关闭麦克风…':microphoneState.running?'关闭语音唤醒':'开启语音唤醒',type:'checkbox',checked:microphoneState.running,enabled:!microphonePending(),click:()=>win?.webContents.send('pet:command',{type:'microphone-set',enabled:!microphoneState.running})};}
function updateTrayMenu(){
  if(!tray)return;
  tray.setToolTip(`大肥鱼 · ${currentHost||'待选择宿主'} · ${microphoneState.detail}`);
  tray.setContextMenu(Menu.buildFromTemplate([microphoneMenuItem(),{label:'显示角色 / 移回主屏中央',click:()=>showPet(true)},{label:'更换桌宠形象…',click:()=>showSettings('appearance')},{label:'设置与动作检查',click:showSettings},{label:'退出大肥鱼',click:()=>app.quit()}]));
}
const currentHost='dsh';
function pageURL(overlay = false) { return base + '/?' + new URLSearchParams({ ...(overlay ? { overlay: '1' } : {}), ...(currentHost ? { backend: currentHost } : {}) }); }
function showPet(recenter = false) {
  if (!win || win.isDestroyed()) return;
  const a = screen.getPrimaryDisplay().workArea;
  if(recenter===true)win.setPosition(Math.round(a.x+a.width/2-petRect.x-petRect.width/2),Math.round(a.y+a.height/2-petRect.y-petRect.height/2));
  win.showInactive(); win.setAlwaysOnTop(true, 'pop-up-menu'); win.moveTop();
}
const owned = event => event.sender === win?.webContents;
function clampPosition(x, y) {
  const area = screen.getDisplayNearestPoint({ x: Math.round(x+petExtent.x+petExtent.width/2), y: Math.round(y+petExtent.y+petExtent.height/2) }).workArea;
  return clampPetPosition(x,y,area,petExtent);
}
function visibleViewport(){const b=win.getBounds(),area=screen.getDisplayMatching({x:b.x+petExtent.x,y:b.y+petExtent.y,width:petExtent.width,height:petExtent.height}).workArea;return {centerX:area.x+area.width/2-b.x,left:Math.max(0,area.x-b.x),top:Math.max(0,area.y-b.y),right:Math.min(b.width,area.x+area.width-b.x),bottom:Math.min(b.height,area.y+area.height-b.y)};}
function showSettings(section='') {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.show(); settingsWindow.focus();if(section==='appearance')settingsWindow.webContents.send('pet:command','open-appearance'); return; }
  settingsWindow = new BrowserWindow({ title: '大肥鱼 · 设置与动作检查', width: 930, height: 850, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  settingsWindow.on('page-title-updated',event=>event.preventDefault());
  settingsWindow.show();settingsWindow.focus();
  settingsWindow.loadURL(pageURL()+(section==='appearance'?'&panel=appearance':'')); settingsWindow.on('closed', () => { settingsWindow = null; });
}
app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  const { createPetServer } = await import(pathToFileURL(path.resolve(__dirname, '../server.mjs')).href);
  server = createPetServer({host:currentHost,desktopStatus:()=>({settingsOpen:Boolean(settingsWindow&&!settingsWindow.isDestroyed()),microphone:microphoneState}),control:action=>action==='stop'?app.quit():action==='settings'?showSettings():showPet()}); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const fs = require('node:fs'); const out = path.resolve(__dirname, '../artifacts'); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'desktop-state.json'), JSON.stringify({ pid: process.pid,root:path.resolve(__dirname,'..'), base, backend: currentHost, startedAt: new Date().toISOString() }, null, 2));
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(permission === 'media' && contents.getURL().startsWith(base + '/') && (!details.mediaTypes?.length || details.mediaTypes.every(t => t === 'audio'))));
  const area = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({ title: '大肥鱼 · 原创桌宠', ...petWindowSize, x: area.x+area.width-petRect.x-petRect.width-16, y: area.y+area.height-petRect.y-petRect.height-16, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false, hasShadow: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const notifyViewport=()=>{if(!win.isDestroyed())win.webContents.send('pet:viewport',visibleViewport());};
  win.on('move',notifyViewport);win.on('resize',notifyViewport);
  screen.on('display-metrics-changed',notifyViewport);
  ipcMain.handle('pet:viewport',event=>owned(event)?visibleViewport():null);
  win.setAlwaysOnTop(true, 'pop-up-menu'); win.setVisibleOnAllWorkspaces(true); win.setIgnoreMouseEvents(true, { forward: true }); ignore = true;
  const pixels = Buffer.alloc(32*32*4);
  for(let y=0;y<32;y++) for(let x=0;x<32;x++) {
    const i=(y*32+x)*4;
    if((x-16)**2+(y-16)**2<210) { pixels[i]=201; pixels[i+1]=122; pixels[i+2]=101; pixels[i+3]=255; }
    if(y>=12&&y<=16&&((x>=9&&x<=11)||(x>=21&&x<=23))) pixels.fill(255,i,i+4);
  }
  const trayIcon = nativeImage.createFromBitmap(pixels,{width:32,height:32});
  tray = new Tray(trayIcon); tray.setToolTip('大肥鱼桌宠 · 双击找回角色');
  tray.on('double-click',()=>showPet(true));
  updateTrayMenu();
  win.webContents.on('render-process-gone', (_e, details) => fs.writeFileSync(path.join(out,'renderer-error.json'), JSON.stringify(details)));
  win.webContents.on('did-fail-load', (_e, code, description) => console.error('页面加载失败',code,description));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(base + '/')) event.preventDefault(); });
  ipcMain.on('pet:regions', (event, value) => {
    if (owned(event) && Array.isArray(value)) {regions = value.slice(0, 6).filter(r => ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k])) && r.width > 0 && r.height > 0).map(r => ({ ...r, mask: Array.isArray(r.mask) && r.mask.length === 1024 ? r.mask.map(v => v === 1 ? 1 : 0) : null }));const stage=regions.find(r=>r.kind==='stage');if(stage){petRect={x:stage.x,y:stage.y,width:stage.width,height:stage.height};petExtent=petRect;if(stage.mask){const cells=stage.mask.flatMap((v,i)=>v?[i]:[]);if(cells.length){const xs=cells.map(i=>i%32),ys=cells.map(i=>Math.floor(i/32));petExtent={x:stage.x+Math.min(...xs)/32*stage.width,y:stage.y+Math.min(...ys)/32*stage.height,width:(Math.max(...xs)-Math.min(...xs)+1)/32*stage.width,height:(Math.max(...ys)-Math.min(...ys)+1)/32*stage.height};}}}}
  });
  ipcMain.on('pet:drag', (event, dx, dy) => {
    if (!owned(event) || !Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 500 || Math.abs(dy) > 500) return;
    const b = win.getBounds(), p = clampPosition(b.x + dx, b.y + dy); win.setPosition(p.x, p.y, false);
  });
  ipcMain.on('pet:settings', event => { if (owned(event)) showSettings(); });
  ipcMain.on('pet:last-task',event=>{if(owned(event)||event.sender===settingsWindow?.webContents)win.webContents.send('pet:command','last-task');});
  ipcMain.on('pet:microphone-set',(event,value)=>{
    if(!owned(event)&&event.sender!==settingsWindow?.webContents)return;
    if(!value||typeof value.enabled!=='boolean'||microphonePending())return;
    win.webContents.send('pet:command',{type:'microphone-set',enabled:value.enabled,deviceId:typeof value.deviceId==='string'?value.deviceId.slice(0,512):''});
  });
  ipcMain.on('pet:microphone-state',(event,value)=>{
    if(!owned(event)||!value||!['off','starting','on','stopping','failed'].includes(value.phase))return;
    microphoneState={phase:value.phase,running:value.phase==='on',detail:String(value.detail||'').slice(0,180)};
    if(settingsWindow&&!settingsWindow.isDestroyed())settingsWindow.webContents.send('pet:microphone-state',microphoneState);
    updateTrayMenu();
  });
  ipcMain.handle('pet:microphone-state',event=>{
    if(!owned(event)&&event.sender!==settingsWindow?.webContents)throw Error('不是桌宠窗口');
    return microphoneState;
  });
  ipcMain.on('pet:listen-now',event=>{
    if(owned(event)||event.sender===settingsWindow?.webContents)win.webContents.send('pet:command','listen');
  });
  ipcMain.on('pet:dragging', (event, value) => { if (owned(event)) { dragging = value === true; if (dragging) { clearInterval(moveTimer); win.setIgnoreMouseEvents(false); ignore = false; } } });
  ipcMain.on('pet:pointer', (event, value) => {
    if (!owned(event) || dragging || !value || !['x', 'y', 'offsetX', 'offsetY'].every(k => Number.isFinite(value[k]))) return;
    clearInterval(moveTimer);
    const cursor = value.coordinateSpace === 'screen-physical' && screen.screenToDipPoint ? screen.screenToDipPoint({ x: Math.round(value.x), y: Math.round(value.y) }) : value;
    const start = win.getBounds(); const target = clampPosition(cursor.x - value.offsetX, cursor.y - value.offsetY);
    const duration = Math.min(1000, Math.max(250, Number(value.durationMs) || 550)); const began = Date.now();
    automationUntil = Date.now() + duration + 1000; win.setIgnoreMouseEvents(true, { forward: true }); ignore = true;
    moveTimer = setInterval(() => {
      if (!win || win.isDestroyed()) return clearInterval(moveTimer);
      const t = Math.min(1, (Date.now() - began) / duration); const eased = t * t * (3 - 2 * t);
      win.setPosition(Math.round(start.x + (target.x - start.x) * eased), Math.round(start.y + (target.y - start.y) * eased), false);
      if (t === 1) clearInterval(moveTimer);
    }, 16);
  });
  ipcMain.on('pet:automation', (event, value) => {
    if (!owned(event)) return;
    automationUntil = Date.now() + Math.max(100, Math.min(10000, Number(value) || 1000));
    win.setIgnoreMouseEvents(true, { forward: true }); ignore = true;
  });
  win.webContents.on('context-menu', () => Menu.buildFromTemplate([
    microphoneMenuItem(),
    { label: '说一句', click: () => win.webContents.send('pet:command', 'listen') },
    { label: '打断', click: () => win.webContents.send('pet:command', 'interrupt') },
    { label: '更换桌宠形象…',click:()=>showSettings('appearance') },
    { label: '设置与动作检查', click: showSettings },
    { type: 'separator' }, { label: '退出大肥鱼', click: () => app.quit() },
  ]).popup({ window: win }));
  await win.loadURL(pageURL(true));
  if (process.argv.includes('--show')) showPet();
  setTimeout(async () => {
    try {
      const state = await win.webContents.executeJavaScript(`({ready:!!window.dashifeiyuPet, videos:[...document.querySelectorAll('video')].map(v=>({active:v.classList.contains('active'),width:v.videoWidth,ready:v.readyState,error:v.error?.message})),bounds:{x:screenX,y:screenY}})`);
      state.window={focusable:win.isFocusable(),focused:win.isFocused()};
      state.microphone=microphoneState;
      fs.writeFileSync(path.join(out,'desktop-render.json'),JSON.stringify(state,null,2));
      fs.writeFileSync(path.join(out,'desktop-current.png'),(await win.webContents.capturePage()).toPNG());
    } catch (e) { console.error('角色显示检查失败',e.message); }
  }, 6000);
  if (process.env.DFY_SMOKE === '1') {
    setTimeout(async () => {
      try {
        const fs = require('node:fs/promises');
        const out = path.resolve(__dirname, '../artifacts'); await fs.mkdir(out, { recursive: true });
        const image = await win.webContents.capturePage();
        await fs.writeFile(path.join(out, 'electron-overlay.png'), image.toPNG());
        console.log('原创桌宠透明窗口截图已保存，桌面冒烟检查通过。');
      } catch (error) { console.error(error.message); process.exitCode = 1; }
      finally { app.quit(); }
    }, 2500);
  }
  pointerTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const p = screen.getCursorScreenPoint(), b = win.getBounds();
    const inside = regions.some(r => {
      const x = p.x - b.x - r.x, y = p.y - b.y - r.y;
      if (x < 0 || y < 0 || x >= r.width || y >= r.height) return false;
      return !r.mask || r.mask[Math.min(31, Math.floor(y / r.height * 32)) * 32 + Math.min(31, Math.floor(x / r.width * 32))] === 1;
    });
    const desired = !dragging && (Date.now() < automationUntil || !inside);
    if (desired !== ignore) { win.setIgnoreMouseEvents(desired, { forward: true }); ignore = desired; }
  }, 40);
  app.on('second-instance',()=>showPet());
}).catch(error => { console.error(error.message); app.quit(); });
app.on('before-quit', () => { clearInterval(pointerTimer); clearInterval(moveTimer); server?.closeAllConnections(); server?.close(); });
app.on('window-all-closed', () => app.quit());
