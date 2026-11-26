import {readFile,mkdir,readdir,writeFile,rename,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {inflateRawSync,crc32} from 'node:zlib';
import {createHash,randomUUID} from 'node:crypto';
const hash=data=>createHash('sha256').update(data).digest('hex');
const aliases={tidy:'tail_wag',yawn:'stretch',sleep_enter:'sit_down',sleep_loop:'sleep',sleep_exit:'sit_up',listen_nod:'listen',think_loop:'think',talk_soft:'talk_comfort',talk_pout:'talk_angry',talk_surprise:'talk_surprised',retry:'recover',attention:'look',bye:'idle',lift:'drag_start',held:'drag_hold',land:'drag_end',delight:'tail_wag'};
export function unpackZIP(data){
  if(data.length>160*1024*1024)throw Error('动作包超过160MB');
  let end=-1;for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--)if(data.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0||data.readUInt16LE(end+4)||data.readUInt16LE(end+6))throw Error('不是支持的单卷ZIP');
  const count=data.readUInt16LE(end+10),files=new Map();let offset=data.readUInt32LE(end+16),total=0;
  if(count>256||count===65535)throw Error('动作包文件过多或使用ZIP64');
  for(let i=0;i<count;i++){
    if(offset+46>data.length||data.readUInt32LE(offset)!==0x02014b50)throw Error('ZIP目录损坏');
    const flags=data.readUInt16LE(offset+8),method=data.readUInt16LE(offset+10),crc=data.readUInt32LE(offset+16),compressed=data.readUInt32LE(offset+20),size=data.readUInt32LE(offset+24),n=data.readUInt16LE(offset+28),extra=data.readUInt16LE(offset+30),comment=data.readUInt16LE(offset+32),local=data.readUInt32LE(offset+42);
    const name=data.subarray(offset+46,offset+46+n).toString('utf8');offset+=46+n+extra+comment;
    if(flags&1||!name||name.includes('\\')||name.startsWith('/')||name.split('/').some(p=>p==='..')||/^[a-z]:/i.test(name))throw Error('ZIP含加密文件或非法路径');
    if(files.has(name))throw Error('ZIP文件重名');
    total+=size;if(size>32*1024*1024||total>256*1024*1024)throw Error('ZIP解压大小超过限制');
    if(name.endsWith('/'))continue;
    if(name!=='manifest.json'&&!/^actions\/[a-z_]+\.webm$/.test(name))continue;
    if(local+30>data.length||data.readUInt32LE(local)!==0x04034b50)throw Error('ZIP文件头损坏');
    const start=local+30+data.readUInt16LE(local+26)+data.readUInt16LE(local+28);
    if(start+compressed>data.length)throw Error('ZIP文件被截断');
    const input=data.subarray(start,start+compressed);
    const output=method===0?Buffer.from(input):method===8?inflateRawSync(input,{maxOutputLength:32*1024*1024}):null;
    if(!output||output.length!==size||crc32(output)!==crc)throw Error('ZIP压缩格式或校验错误');
    files.set(name,output);
  }
  return files;
}
export function normalizePack(manifest,files,id){
  const actions=manifest.actions,p=manifest.profile||{};
  if(!Array.isArray(actions)||actions.length<1||actions.length>120||![p.width,p.height,p.fps].every(n=>Number.isFinite(n)&&n>0)||p.width>2048||p.height>2048||p.fps>60)throw Error('动作包规格或动作列表不合法');
  const ids=new Set(),motions=actions.map(a=>{
    if(!/^[a-z_]+$/.test(a.id)||ids.has(a.id)||a.file!==`actions/${a.id}.webm`||!Number.isFinite(a.frames)||a.frames<=0||a.frames>3600)throw Error('动作ID、路径或帧数不合法');
    ids.add(a.id);const data=files.get(a.file);
    if(!data||data.readUInt32BE(0)!==0x1a45dfa3)throw Error('WebM文件缺失或无效：'+a.id);
    if(a.sha256&&hash(data)!==a.sha256)throw Error('WebM哈希不匹配：'+a.id);
    const hand=a.handAnchor,handAnchor=hand&&[hand.x,hand.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1)?{x:hand.x,y:hand.y}:undefined;
    return {id:a.id,label:String(a.name||a.id).slice(0,80),category:'角色动作',src:`/assets/characters/${id}/${a.file}`,durationMs:a.frames/p.fps*1000,loop:a.loop===true,enabled:true,from:a.start,to:a.end,approved:a.approved===true,review:a.review||{},sha256:hash(data),...(handAnchor?{handAnchor}:{})};
  });
  if(!ids.has('idle'))throw Error('动作包必须包含idle');
  const mapping=Object.fromEntries(Object.entries(aliases).filter(([old,target])=>!ids.has(old)&&ids.has(target)));
  return {version:2,characterId:id,characterName:String(manifest.asset||'新角色').slice(0,50),width:p.width,height:p.height,fps:p.fps,aliases:mapping,motions};
}
export function createCharacterStore(root){
  const directory=join(root,'public/assets/characters'),prefs=join(root,'.runtime/appearance.json');
  let queue=Promise.resolve();
  const serial=fn=>{const task=queue.then(fn);queue=task.catch(()=>{});return task;};
  async function list(){
    const characters=[{id:'dashifeiyu',name:'大肥鱼',catalog:'/assets/motions.json',motions:60,sound:{mode:'tts'}}];
    for(const entry of await readdir(directory,{withFileTypes:true}).catch(()=>[])){
      if(!entry.isDirectory()||!/^pack-[a-f0-9]{12}$/.test(entry.name))continue;
      try{const c=JSON.parse(await readFile(join(directory,entry.name,'catalog.json'),'utf8'));const sound=c.sound?.mode==='clip'&&new RegExp(`^/assets/characters/${entry.name}/[a-z0-9_-]+\\.(?:ogg|wav)$`).test(c.sound.src)?{...c.sound,volume:Math.min(1,Math.max(0,c.sound.volume??.4))}:{mode:'tts'};characters.push({id:entry.name,name:c.characterName,catalog:`/assets/characters/${entry.name}/catalog.json`,motions:c.motions.length,sound});}catch{}
    }
    let selected='dashifeiyu';try{selected=JSON.parse(await readFile(prefs,'utf8')).selected;}catch{}
    if(!characters.some(c=>c.id===selected))selected='dashifeiyu';
    return {ok:true,selected,characters};
  }
  async function save(selected){await mkdir(join(root,'.runtime'),{recursive:true});const temp=prefs+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify({selected}));await rename(temp,prefs);}
  return {list,
    select:id=>serial(async()=>{const info=await list();if(!info.characters.some(c=>c.id===id))throw Error('角色未安装');await save(id);return list();}),
    import:data=>serial(async()=>{
      const files=unpackZIP(data),raw=files.get('manifest.json');if(!raw)throw Error('动作包缺少manifest.json');
      const id='pack-'+hash(raw).slice(0,12),catalog=normalizePack(JSON.parse(raw.toString('utf8')),files,id);
      await mkdir(directory,{recursive:true});const target=join(directory,id),temp=join(directory,'.import-'+randomUUID());
      if(!(await list()).characters.some(c=>c.id===id)){
        await mkdir(join(temp,'actions'),{recursive:true});
        try{for(const motion of catalog.motions){const name=`actions/${motion.id}.webm`;await writeFile(resolve(temp,name),files.get(name));}await writeFile(join(temp,'source-manifest.json'),raw);await writeFile(join(temp,'catalog.json'),JSON.stringify(catalog,null,2));await rename(temp,target);}
        catch(e){const bounded=resolve(temp);if(!bounded.startsWith(resolve(directory)+sep))throw Error('临时目录越界');await rm(bounded,{recursive:true,force:true});throw e;}
      }
      await save(id);return list();
    })
  };
}
