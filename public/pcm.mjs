// Incremental decoder: network chunks need not coincide with PCM frames.
export class PCMFrames {
  constructor() { this.pending=new Uint8Array();this.total=0;this.terminal=false; }
  push(chunk) {
    this.total+=chunk.length;
    if(this.total>16*1024*1024)throw new Error('TTS音频超过限制');
    const bytes=new Uint8Array(this.pending.length+chunk.length);bytes.set(this.pending);bytes.set(chunk,this.pending.length);
    const frames=[];let offset=0;
    while(offset+4<=bytes.length&&!this.terminal){
      const size=new DataView(bytes.buffer).getUint32(offset,true);
      if(size===0){this.terminal=true;offset+=4;break;}
      if(size%2||size>8*1024*1024)throw new Error('Qwen音频帧损坏');
      if(offset+4+size>bytes.length)break;
      const view=new DataView(bytes.buffer,offset+4,size),pcm=new Float32Array(size/2);
      for(let i=0;i<pcm.length;i++)pcm[i]=view.getInt16(i*2,true)/32768;
      frames.push(pcm);offset+=4+size;
    }
    this.pending=bytes.slice(offset);
    if(this.terminal&&this.pending.length)throw new Error('Qwen音频尾部损坏');
    return frames;
  }
  finish(){if(!this.terminal||this.pending.length||this.total<=4)throw new Error('Qwen音频不完整');}
}
