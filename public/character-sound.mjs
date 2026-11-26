// Local character effects never request TTS. One clip at a time, shared cooldown.
export class CharacterSound {
  constructor(onEvent,{now=Date.now,audio=src=>new Audio(src)}={}){this.onEvent=onEvent;this.now=now;this.makeAudio=audio;this.last=-Infinity;this.lastTask=-Infinity;this.profile={mode:'tts'};}
  configure(profile={mode:'tts'}){this.stop();this.profile=profile;this.last=-Infinity;this.lastTask=-Infinity;}
  stop(){const current=this.audio;this.audio=null;if(current){current.pause();current.removeAttribute?.('src');current.load?.();this.settle?.(false);this.settle=null;this.onEvent({type:'sound.ended'});}}
  async play(trigger='pet'){
    const p=this.profile,time=this.now(),task=trigger.startsWith('task.');
    if(p.mode!=='clip'||!p.src||this.audio||time-this.last<(p.minGapMs||8000)||(task&&time-this.lastTask<45000)||(trigger==='ambient'&&time-this.last<180000))return false;
    this.last=time;if(task)this.lastTask=time;
    const sound=this.makeAudio(p.src);sound.volume=Math.max(0,Math.min(1,p.volume??.4));this.audio=sound;
    return new Promise((resolve,reject)=>{
      this.settle=resolve;
      const finish=error=>{if(this.audio!==sound)return;this.audio=null;this.settle=null;this.onEvent({type:'sound.ended'});if(error)reject(error);else resolve(true);};
      sound.onplaying=()=>{if(this.audio===sound)this.onEvent({type:'sound.started',trigger});};
      sound.onended=()=>finish();sound.onerror=()=>finish(new Error('角色音效播放失败'));
      sound.play().catch(finish);
    });
  }
}
