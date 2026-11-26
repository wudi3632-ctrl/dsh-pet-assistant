import { MotionDirector, PetState, actionFor, speechWindow, validateCatalog,wakeWordsFor,wakeEnabledHint } from './core.mjs';
import {faceCenter,mirrorMask} from './facing.mjs';
import { MotionPlayer, SpeechPlayer } from './media.mjs';
import { VoiceInput } from './voice.mjs';
import { withTaskFeedback } from './task-feedback.mjs';
import { replyText,spokenReport } from './reply-text.mjs';
import {panelLayout} from './overlay-layout.mjs';
import {CharacterSound} from './character-sound.mjs';

const $ = id => document.getElementById(id);
const state = new PetState();
let catalog, director, bubbleTimer, taskTimer, turnAbort, turnVersion = 0, demoVersion = 0, preview = false;
const lockedHost='dsh';
$('backend').value='dsh';$('backend').disabled=true;localStorage.setItem('pet-backend','dsh');
let hostBadgeText='检查宿主…',micPhase='off',micDetail='麦克风已关闭',micAction=null;
let deviceSelected=false;
let appearanceVersion=0,currentCharacter='dashifeiyu',viewport=null,layoutFrame;
let characterBounds=null;
let autoFace=false,facing='right';
let voiceProfile={mode:'tts'},ambientTimer;
let dismissedTask='',taskExitTimer,voicePhase='idle',wakeCount=0,lastWakeAt=0;
let lastTimings=null;
function microphoneView(notify=false){
  const pending=['starting','stopping'].includes(micPhase);
  const activeVoice={listening:'正在听你说话',recognizing:'正在识别',ready:'可以继续说'}[voicePhase];
  const text={off:'麦克风关',starting:'麦克风启动中',on:activeVoice||(state.busy?'正在执行':state.speaking?'正在回应':Date.now()<state.activeUntil?'可以继续说':'等你叫'+(voice.wakeWords[0]||'我')),stopping:'麦克风关闭中',failed:'麦克风失败'}[micPhase];
  $('host-badge').textContent=hostBadgeText+' · '+text;
  $('host-badge').dataset.voice=micPhase==='on'?voicePhase:'idle';
  $('host-badge').dataset.microphone=micPhase;$('host-badge').title=micDetail;
  $('mic').disabled=pending;$('listen-now').disabled=pending;$('device').disabled=pending;
  $('mic').textContent={off:'启用语音唤醒',starting:'正在启动麦克风…',on:'关闭语音唤醒',stopping:'正在关闭麦克风…',failed:'重新开启麦克风'}[micPhase];
  $('mic').setAttribute('aria-pressed',String(micPhase==='on'));
  if(notify&&isOverlay)window.petDesktop?.reportMicrophone({phase:micPhase,running:micPhase==='on',detail:micDetail});
}
function selectedBackend() { return $('backend').value; }
async function backendStatus() {
  const info = await request('backends');
  const backend=info.backends.find(b=>b.id==='dsh');
  const label=backend?.available?(backend.busy?'执行中':'任务就绪'):'任务桥未连接';
  $('backend-status').textContent='DSH · '+label+' · '+(backend?.detail||'正在检查');
  $('connection').textContent='DSH桌宠插件 · '+label;
  hostBadgeText='DSH · '+label;$('host-badge').dataset.ready=String(backend?.available===true);microphoneView();
}
const isOverlay = new URLSearchParams(location.search).has('overlay');
if (isOverlay) document.body.classList.add('overlay');
const player = new MotionPlayer($('stage'), label => { $('motion-label').textContent = label; });
function error(message = '') { $('error').hidden = !message; $('error').textContent = message; }
function bubble(text, ms = 2500) {
  clearTimeout(bubbleTimer); const el = $('bubble'); $('bubble-text').textContent = text; el.hidden = !text;
  if (text && ms) bubbleTimer = setTimeout(() => { el.hidden = true; syncRegions(); }, ms);
  syncRegions();
}
async function request(route, body, signal, raw = false) {
  const response = await fetch('/api/' + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-pet-client': '1' }, ...(body ? { body: JSON.stringify(body) } : {}), signal });
  if (!response.ok) { const problem = await response.json().catch(() => ({})); throw new Error(problem.message || `DSH接口 ${response.status}`); }
  if (raw) return response;
  const value = await response.json(); if (value.ok === false) throw new Error(value.message || 'DSH请求失败'); return value;
}
function renderTask() {
  const task = state.task; $('task').hidden = !task||dismissedTask===state.turnId;
  $('last-task').disabled=!task&&!(window.petDesktop&&!isOverlay);
  if (!task) { syncRegions(); return; }
  $('task-title').textContent = task.title;$('task-title').title=task.title; $('task-status').textContent = task.status;
  const tone=task.status==='失败'?'error':task.status==='已取消'?'cancelled':task.phase==='terminal'?'done':task.status==='等待确认'?'approval':'running';
  $('task').dataset.tone=tone;$('task-icon').textContent={running:'·',done:'✓',error:'!',cancelled:'–',approval:'?'}[tone];
  $('steps').replaceChildren(...task.steps.map(s => { const li = document.createElement('li'); li.textContent = s.label; li.dataset.status = s.status; return li; }));
  syncRegions();
}
function dismissTask(){
  clearTimeout(taskTimer);clearTimeout(taskExitTimer);const id=state.turnId;
  $('task').classList.add('leaving');
  taskExitTimer=setTimeout(()=>{if(state.turnId!==id)return;dismissedTask=id;$('task').hidden=true;$('task').classList.remove('leaving');syncRegions();},180);
}
function scheduleTaskDismiss(delay=4500){
  clearTimeout(taskTimer);if(state.task?.phase!=='terminal')return;
  const id=state.turnId;taskTimer=setTimeout(()=>{if(state.turnId!==id||state.busy)return;if(state.speaking||(!$('task').classList.contains('collapsed')&&$('task').matches(':hover,:focus-within'))){scheduleTaskDismiss(1800);return;}dismissTask();},delay);
}
function setTaskExpanded(expanded){$('task').classList.toggle('collapsed',!expanded);$('task-collapse').textContent=expanded?'收起':'详情';$('task-collapse').setAttribute('aria-expanded',String(expanded));$('task-collapse').setAttribute('aria-label',expanded?'收起任务详情':'展开任务详情');syncRegions();}
function emit(event) {
  if(event.type==='voice.disconnected'){micPhase='failed';micDetail='麦克风连接已断开，请重新开启';microphoneView(true);error(micDetail);}
  if (event.backend && event.backend !== selectedBackend()) return;
  if (!state.accept(event)) return;
  if(event.type==='voice.wake'){voicePhase='listening';wakeCount++;lastWakeAt=Date.now();bubble('我在听，继续说～',2000);}
  if(event.type==='voice.started')voicePhase='listening';
  if(event.type==='voice.final')voicePhase='recognizing';
  if(event.type==='voice.ready'){voicePhase='ready';bubble('我在，想让我做什么？',2200);}
  if(['voice.unclear','voice.failed','voice.disconnected','session.expired','turn.accepted','turn.cancelled'].includes(event.type))voicePhase='idle';
  if(event.type==='voice.unclear')bubble('没听清，再说一次～',2200);
  microphoneView();
  if (event.type.startsWith('pointer.')) {
    window.petDesktop?.automation(1500);
    if (event.type === 'pointer.move' && Number.isFinite(event.x) && Number.isFinite(event.y)) {
      const motion = catalog?.motions.find(m => m.id === (event.dx < 0 ? 'pull_left' : 'pull_right'));
      const r = $('stage').getBoundingClientRect(); const a = motion?.handAnchor||{x:event.dx<0?.34:.66,y:.63};
      if (a) window.petDesktop?.pointer({ x: event.x, y: event.y, coordinateSpace: event.coordinateSpace, durationMs: event.durationMs, offsetX: r.x + (facing==='left'?1-a.x:a.x) * r.width, offsetY: r.y + a.y * r.height });
    }
  }
  const motion = actionFor(event);
  if (motion) director?.play(motion, event.type === 'voice.wake' || event.type === 'voice.interrupt' || event.type === 'voice.unclear' ? 'listen' : state.activeUntil ? 'session_wait' : 'idle');
  if (['audio.ended','sound.ended'].includes(event.type)) { voice.cooldown = Date.now() + 350; voice.pre = []; }
  if (event.type === 'session.expired') bubble('');
  if (event.type === 'approval.required') bubble(event.text || 'DSH正在等待你的确认，请在DSH中查看。', 5000);
  if (event.type === 'turn.accepted') {clearTimeout(taskTimer);clearTimeout(taskExitTimer);dismissedTask='';$('task').classList.remove('leaving');setTaskExpanded(false);}
  if (['turn.replied', 'turn.completed', 'turn.failed', 'turn.cancelled'].includes(event.type)) {
    scheduleTaskDismiss(event.type==='turn.failed'?7000:4500);
  }
  renderTask();
}
const speech = new SpeechPlayer(request, emit, (text, progress) => bubble(speechWindow(text, progress) || '…', progress === 1 ? 2200 : 0));
const characterSound=new CharacterSound(emit);
function cue(trigger){if(!$('tts').checked||voiceProfile.mode!=='clip')return Promise.resolve(false);return characterSound.play(trigger).catch(e=>{error(e.message);return false;});}
async function say(text,emotion='neutral',ack=false){
  if(voiceProfile.mode==='clip'){bubble(text.slice(0,64),ack?2200:6500);await cue(ack?'task.ack':'task.result');}
  else await speech.speak(text,emotion);
}
function scheduleAmbient(){
  clearTimeout(ambientTimer);
  if(voiceProfile.mode!=='clip'||(window.petDesktop&&!isOverlay))return;
  ambientTimer=setTimeout(()=>{if(!state.busy&&!state.speaking&&!voice.busy&&!voice.speechAt&&document.visibilityState==='visible')void cue('ambient');scheduleAmbient();},240000+Math.random()*180000);
}
function interrupt() {
  demoVersion++; const wasActive = state.speaking || state.busy;
  turnVersion++; turnAbort?.abort(); speech.stop();characterSound.stop(); bubble('');
  if (state.busy) emit({ type: 'turn.cancelled', turnId: state.turnId });
  if (wasActive) emit({ type: 'voice.interrupt' });
  state.activate();
}
async function submit(text) {
  const value = String(text).trim(); if (!value || value.length > 2000) return;
  interrupt(); preview = false; error();
  const version = turnVersion, turnId = crypto.randomUUID(); turnAbort = new AbortController();
  emit({ type: 'turn.accepted', turnId, text: value, backend: selectedBackend() });
  $('backend').disabled = true;
  emit({ type: 'turn.thinking', turnId });
  const taskStarted=performance.now();lastTimings={...voice.lastMetrics};
  try {
    const result = await withTaskFeedback({
      run:()=>request('turn', { text: value, turnId, backend: selectedBackend(),characterName:$('character-select').selectedOptions[0]?.textContent.split(' · ')[0]||'桌宠' }, turnAbort.signal),
      acknowledge:()=>{if(version!==turnVersion)return;if($('tts').checked)return say('收到啦。','neutral',true);bubble('收到啦。',1800);},
      current:()=>version===turnVersion,
    });
    if (version !== turnVersion) return;
    lastTimings.taskMs=Math.round(performance.now()-taskStarted);
    // The legacy endpoint confirms a reply, not independently verified Windows success.
    emit({ type: 'turn.replied', turnId });
    if (!replyText(result.text)) throw new Error('DSH没有返回正文');
    const reply = spokenReport(result.text);
    if ($('tts').checked) {
      try { await say(reply, result.emotion || 'neutral'); }
      catch (e) { if (version === turnVersion) { error('TTS失败：' + e.message); bubble(reply.slice(0, 64), 6000); } }
    } else { director.play('session_wait'); bubble(reply.slice(0, 64), 6000); }
  } catch (e) {
    if (version === turnVersion) {
      emit({ type: 'turn.failed', turnId }); error(e.message);
      const feedback='这次没能完成，请查看错误信息。';bubble(feedback,4000);
      if($('tts').checked)try{await say(feedback,'neutral');}catch{}
    }
  } finally { if (version === turnVersion) { lastTimings.totalTaskAndAudioMs=Math.round(performance.now()-taskStarted);$('backend').disabled = Boolean(lockedHost); state.busy = false; state.activate();$('voice-status').textContent=(voice.running||micPhase==='on')?'可继续对话':'麦克风未开启'; } void backendStatus().catch(() => {}); }
}
const voice = new VoiceInput({ request, state, emit, submit, interrupt,
  report: text => { $('voice-status').textContent = text; },
  level: value => { $('input-level').style.setProperty('--level', `${value * 100}%`);$('host-badge').style.setProperty('--input-level',String(Math.min(1,value))); },
  threshold: () => Number($('threshold').value),
});
async function assets() {
  const version=++appearanceVersion;
  const info=await request('characters');
  const character=info.characters.find(c=>c.id===info.selected)||info.characters[0];
  const response = await fetch(character.catalog, { cache: 'no-store' });
  const next=validateCatalog(await response.json());if(version!==appearanceVersion)return;
  if(character.id!==currentCharacter||JSON.stringify(character.sound)!==JSON.stringify(voiceProfile)){
    speech.stop();characterSound.stop();if(state.speaking)emit({type:'audio.ended'});
    voiceProfile=character.sound||{mode:'tts'};characterSound.configure(voiceProfile);scheduleAmbient();
  }
  const motion=director?.requestedId||'idle';catalog=next;currentCharacter=character.id;characterBounds=null;
  voice.setWakeWords(wakeWordsFor(character));
  $('wake-help').textContent='唤醒词：'+voice.wakeWords.join('、')+'。连续会话空闲30秒后等待唤醒。';
  $('message').placeholder='对'+character.name+'说点什么…';
  document.querySelector('label[for="message"]').textContent='对'+character.name+'说';
  document.querySelector('h1').textContent=character.name+'的小角落';
  autoFace=character.name==='小鸡毛';
  director?.dispose(); director = new MotionDirector(catalog, motion => player.show(motion));
  $('character-select').replaceChildren(...info.characters.map(c=>new Option(`${c.name} · ${c.motions} 个动作`,c.id)));$('character-select').value=character.id;
  $('character-status').textContent=character.name+(voiceProfile.mode==='clip'?' · 本地狗叫，稀疏播放':' · TTS语音');
  $('stage').setAttribute('aria-label',character.name+'桌宠形象');
  $('motion-select').replaceChildren(...catalog.motions.map(m => { const option = document.createElement('option'); option.value = m.id; option.textContent = `${m.category} / ${m.label}${m.enabled ? '' : '（占位）'}`; return option; }));
  $('asset-status').textContent = `${catalog.motions.length}项动作，${catalog.motions.filter(m => m.enabled).length}项已启用动画。`;
  if(!director.play(motion))director.play('idle');syncRegions();
}
function openAppearance(){$('settings').open=true;$('settings-toggle').setAttribute('aria-expanded','true');$('character-select').scrollIntoView({block:'center'});$('character-select').focus();}
$('character-select').onchange=async()=>{const select=$('character-select');select.disabled=true;try{await request('characters/select',{id:select.value});await assets();}catch(e){select.value=currentCharacter;error(e.message);}finally{select.disabled=false;}};
$('import-character').onclick=()=>$('character-file').click();
$('character-file').onchange=async()=>{
  const file=$('character-file').files[0];if(!file)return;
  $('import-character').disabled=true;$('character-select').disabled=true;$('character-status').textContent='正在校验并导入…';
  try{if(file.size>160*1024*1024)throw Error('动作包超过160MB');const res=await fetch('/api/characters/import',{method:'POST',headers:{'x-pet-client':'1','content-type':'application/zip'},body:file});const info=await res.json();if(!res.ok||!info.ok)throw Error(info.message||'导入失败');await assets();}
  catch(e){error('动作包导入失败：'+e.message);$('character-status').textContent='导入失败，原形象已保留';}
  finally{$('import-character').disabled=false;$('character-select').disabled=false;$('character-file').value='';}
};
async function devices() {
  const selected = $('device').value;
  const list = await navigator.mediaDevices?.enumerateDevices() || [];
  $('device').replaceChildren(new Option('系统默认输入', ''), ...list.filter(d => d.kind === 'audioinput').map(d => new Option(d.label || '输入设备 ' + d.deviceId.slice(0, 6), d.deviceId)));
  const remote=!selected&&!deviceSelected?list.find(d=>d.kind==='audioinput'&&/UU.*(?:远程|虚拟|virtual)/iu.test(d.label)):null;
  $('device').value = remote?.deviceId||selected;
}
async function startMic() {
  return setMicrophone(true,$('device').value);
}
async function setMicrophone(enabled,deviceId=''){
  if(micAction)return micAction;
  voicePhase='idle';
  error();micPhase=enabled?'starting':'stopping';micDetail=enabled?'正在申请麦克风并加载录音':'正在关闭录音';microphoneView();
  if(deviceId){$('device').value=deviceId;deviceSelected=true;}
  // The settings window controls the overlay's microphone. It never starts a second capture.
  if(window.petDesktop&&!isOverlay){window.petDesktop.setMicrophone(enabled,deviceId);return;}
  microphoneView(true);
  micAction=(async()=>{
    try{
      if(enabled){await voice.start(deviceId);if(!voice.running)throw Error('未取得麦克风，请关闭其他桌宠窗口的录音后重试');}
      else await voice.stop();
      micPhase=voice.running?'on':'off';micDetail=voice.running?'唤醒已开启 · '+(voice.deviceLabel||'系统默认输入'):'麦克风已关闭';
      $('voice-status').textContent=voice.running?'等待唤醒：'+voice.wakeWords.join('、')+' · '+(voice.deviceLabel||'系统默认输入'):micDetail;
      if(!state.busy&&!state.speaking)bubble(voice.running?wakeEnabledHint(voice.wakeWords):'语音唤醒已关闭。',3000);
      void devices().catch(()=>{});
    }catch(e){micPhase='failed';micDetail='麦克风启动失败：'+e.message;error(micDetail);$('voice-status').textContent=micDetail;}
    finally{micAction=null;microphoneView(true);}
  })();
  return micAction;
}
$('mic').onclick = () => { if(!['starting','stopping'].includes(micPhase))void setMicrophone(micPhase!=='on',$('device').value); };
$('listen-now').onclick = async () => { if(window.petDesktop&&!isOverlay){window.petDesktop.listenNow();return;}if (!voice.running) await startMic(); if (voice.running) { interrupt(); state.activate(); emit({ type: 'voice.wake' }); $('voice-status').textContent = '请说话'; } };
$('device').onchange = () => { deviceSelected=true;if (micPhase==='on') void startMic(); };
if(window.petDesktop&&!isOverlay){
  const mirror=value=>{micPhase=value.phase;micDetail=value.detail;microphoneView();$('voice-status').textContent=micDetail;};
  window.petDesktop.onMicrophone(mirror);void window.petDesktop.getMicrophoneState().then(mirror).catch(e=>error(e.message));
}
$('chat').onsubmit = event => { event.preventDefault(); const text = $('message').value; $('message').value = ''; void submit(text); };
$('interrupt').onclick = interrupt;
$('settings-toggle').onclick = () => { $('settings').open = !$('settings').open; $('settings-toggle').setAttribute('aria-expanded', String($('settings').open)); };
$('preview-motion').onclick = () => { if (state.busy || state.speaking) return error('请先打断当前回合再检查动作'); preview = true; director.play($('motion-select').value); };
$('reload-assets').onclick = () => assets().catch(e => error(e.message));
$('backend').onchange = () => { if (state.busy || state.speaking) interrupt(); localStorage.setItem('pet-backend', selectedBackend()); state.task = null; renderTask(); void backendStatus().catch(e => error(e.message)); };
$('refresh-backends').onclick = () => backendStatus().catch(e => error(e.message));
$('task-collapse').onclick = () => {setTaskExpanded($('task').classList.contains('collapsed'));scheduleTaskDismiss(7000);};
$('task-close').onclick=dismissTask;
function showLastTask(){if(!state.task){bubble('还没有任务记录～',1800);return;}clearTimeout(taskExitTimer);dismissedTask='';$('task').classList.remove('leaving');setTaskExpanded(true);renderTask();scheduleTaskDismiss(10000);}
$('last-task').onclick=()=>{if(window.petDesktop&&!isOverlay)window.petDesktop.lastTask();else showLastTask();};
$('demo').onclick = async () => {
  interrupt(); preview = false; const version = demoVersion;
  const id = crypto.randomUUID();
  const events = [{ type: 'voice.wake' }, { type: 'voice.started' }, { type: 'voice.final' },
    { type: 'turn.accepted', turnId: id, text: '演示：打开记事本并输入介绍' },
    { type: 'task.plan', turnId: id, steps: [{ id: 'open', label: '打开记事本（演示）' }, { id: 'type', label: '输入介绍（演示）' }] },
    { type: 'tool.started', turnId: id }, { type: 'tool.progress', turnId: id, stepId: 'open', status: 'completed' },
    { type: 'pointer.move', dx: 100, turnId: id }, { type: 'pointer.arrived', dx: 100, turnId: id },
    { type: 'pointer.click', turnId: id }, { type: 'tool.progress', turnId: id, stepId: 'type', status: 'completed' },
    { type: 'turn.completed', turnId: id }, { type: 'audio.started', emotion: 'happy' }];
  for (const event of events) { if (version !== demoVersion) return; emit(event); await new Promise(r => setTimeout(r, 650)); }
  const text = '动作与任务状态演示完成啦！这只是演出测试，没有实际操作电脑。';
  for (let i = 1; i <= Array.from(text).length; i++) { if (version !== demoVersion) return; bubble(speechWindow(text, i / Array.from(text).length), 0); await new Promise(r => setTimeout(r, 65)); }
  emit({ type: 'audio.ended' }); bubble(text, 2500);
};
function syncRegions() {
  if (!window.petDesktop) return;
  const stageRect=$('stage').getBoundingClientRect();
  const nextFacing=autoFace&&isOverlay&&Number.isFinite(viewport?.centerX)?faceCenter(stageRect.x+stageRect.width/2,viewport.centerX,facing):'right';
  if(nextFacing!==facing){facing=nextFacing;characterBounds=null;}
  $('stage').style.transform=facing==='left'?'scaleX(-1)':'';
  $('stage').dataset.facing=facing;
  const nodes = [$('stage'), ...(!$('task').hidden ? [$('task')] : [])];
  const regions=nodes.map(el => {
    const r = el.getBoundingClientRect(); const region = {kind:el.id,x: r.x, y: r.y, width: r.width, height: r.height };
    if (el.id === 'stage') {
      try {
        const video = el.querySelector('video.active');
        if (video?.videoWidth) {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
          const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(video, 0, 0, 32, 32);
          const data = context.getImageData(0, 0, 32, 32).data;
          region.mask = Array.from({ length: 1024 }, (_, i) => data[i * 4 + 3] > 16 ? 1 : 0);
          if(facing==='left')region.mask=mirrorMask(region.mask);
          if(!characterBounds&&video.currentSrc.endsWith(director?.current?.src||'!')){
            const cells=region.mask.flatMap((v,i)=>v?[i]:[]);if(cells.length){const xs=cells.map(i=>i%32),ys=cells.map(i=>Math.floor(i/32));characterBounds={x:Math.min(...xs)/32,y:Math.min(...ys)/32,width:(Math.max(...xs)-Math.min(...xs)+1)/32,height:(Math.max(...ys)-Math.min(...ys)+1)/32};}
          }
        }
      } catch { /* rectangular hit fallback for unreadable media */ }
    }
    return region;
  });
  if(isOverlay)placePanels();
  // Layout may move the task card; refresh its interaction bounds afterwards.
  for(const region of regions)if(region.kind==='task'){const r=$('task').getBoundingClientRect();Object.assign(region,{x:r.x,y:r.y,width:r.width,height:r.height});}
  window.petDesktop.regions(regions);
}
function placePanels(){
  if(!isOverlay)return;
  const stage=$('stage').getBoundingClientRect(),v=viewport||{left:0,top:0,right:innerWidth,bottom:innerHeight};
  const pet=characterBounds?{x:stage.x+characterBounds.x*stage.width,y:stage.y+characterBounds.y*stage.height,width:characterBounds.width*stage.width,height:characterBounds.height*stage.height}:stage;
  const box=el=>({width:el.offsetWidth||parseFloat(getComputedStyle(el).width)||280,height:el.offsetHeight||44});
  const placement=panelLayout(pet,v,box($('bubble')),box($('task')),box($('host-badge')));
  for(const [id,key] of [['bubble','bubble'],['task','task'],['host-badge','badge']]){const el=$(id),p=placement[key];el.style.left=p.x+'px';el.style.top=p.y+'px';}
  $('bubble').dataset.above=String(placement.bubble.above);
  $('bubble').style.width=placement.bubble.width+'px';
  $('bubble').style.setProperty('--tail-x',Math.max(14,Math.min(placement.bubble.width-18,pet.x+pet.width/2-placement.bubble.x))+'px');
}
if(isOverlay&&window.petDesktop){const update=value=>{if(!value)return;viewport=value;cancelAnimationFrame(layoutFrame);layoutFrame=requestAnimationFrame(syncRegions);};window.petDesktop.onViewport(update);void window.petDesktop.getViewport().then(update);}
let drag;
$('stage').onpointerdown = e => {
  if (e.button !== 0) return;
  e.preventDefault();window.getSelection()?.removeAllRanges();
  drag = { x: e.screenX, y: e.screenY, moved: false }; $('stage').setPointerCapture(e.pointerId);
  window.petDesktop?.dragging(true);
};
$('stage').onpointermove = e => {
  if (!drag) return;
  if (Math.abs(e.screenX - drag.x) + Math.abs(e.screenY - drag.y) > 4) { if (!drag.moved) director.play('lift', 'held'); drag.moved = true; window.petDesktop?.drag(e.screenX - drag.x, e.screenY - drag.y); drag.x = e.screenX; drag.y = e.screenY; }
};
$('stage').onpointerup = () => { if (drag) {director.play(drag.moved ? 'land' : 'pet', state.activeUntil ? 'session_wait' : 'idle');if(!state.busy&&!voice.busy&&!voice.speechAt)void cue(drag.moved?'land':'pet');} drag = null; window.petDesktop?.dragging(false); syncRegions(); };
$('stage').onpointercancel = () => { drag = null; window.petDesktop?.dragging(false); director.play('land'); };
$('stage').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); director.play('pet');if(!state.busy&&!voice.busy&&!voice.speechAt)void cue('pet'); } };
window.petDesktop?.onCommand(command => {
  if(command==='last-task'){showLastTask();return;}
  if(command==='open-appearance'){openAppearance();return;}
  if(command?.type==='microphone-set'){void setMicrophone(command.enabled,command.deviceId||$('device').value);return;}
  if (command === 'microphone') $('mic').click();
  if (command === 'listen') $('listen-now').click();
  if (command === 'interrupt') interrupt();
});
window.addEventListener('resize', syncRegions);
window.addEventListener('storage', event => {
  if (event.key !== 'pet-backend' || event.newValue!=='dsh') return;
  if (state.busy || state.speaking) return;
  $('backend').value = event.newValue; state.task = null; renderTask(); void backendStatus().catch(() => {});
});
const stream = new EventSource('/api/events');
stream.onmessage = event => { try { const value = JSON.parse(event.data);if(value.type==='appearance.changed'){void assets().catch(e=>error(e.message));return;} if (value.type === 'assistant.delta') return; emit(value); } catch { /* malformed event does not break UI */ } };
setInterval(() => { if (!preview && state.tick()) { director.play('session_end'); bubble(''); $('voice-status').textContent = (voice.running||micPhase==='on') ? '等待唤醒' : '麦克风未开启'; } }, 250);
window.addEventListener('beforeunload', () => { stream.close(); director?.dispose(); speech.stop();characterSound.stop();clearTimeout(ambientTimer); void voice.stop(); turnAbort?.abort(); });
await assets().catch(e => error(e.message));
renderTask();
if(new URLSearchParams(location.search).get('panel')==='appearance')openAppearance();
await devices().catch(() => {});
try { const health = await request('health'); if(!health.tts&&voiceProfile.mode==='tts')$('tts').checked=false; $('connection').textContent = `${health.host||selectedBackend()} · ${health.connected?'宿主已连接':'宿主未就绪'} · ${health.localSpeech?'本地唤醒/ASR可用':'识别未配置'} · TTS：${health.tts||'待检查'}`; }
catch (e) { $('connection').textContent = e.message; }
syncRegions();
if (isOverlay) setInterval(syncRegions, 250);
void backendStatus().catch(() => {});
// Native host activation can happen after this window opens. No model calls.
setInterval(()=>{if(lockedHost)void backendStatus().catch(()=>{});},5000);
// Deliberate integration seam for real DSH events; no fabricated tool completion.
window.dashifeiyuPet = { emit, interrupt, getState: () => ({ status: state.status, turnId: state.turnId, busy: state.busy, speaking: state.speaking, listening:voice.running,lastTimings,voiceMetrics:voice.lastMetrics,voicePhase,wakeCount,lastWakeAt,wakeWords:voice.wakeWords,facing, soundMode:voiceProfile.mode,character:currentCharacter,motion: director?.current?.id, task: state.task }) };
