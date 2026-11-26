export class MicrophoneLease {
  constructor(){this.version=0;this.release=null;}
  async acquire(){
    this.close();const version=this.version;
    if(!navigator.locks)throw new Error('当前环境不支持麦克风独占协调，请使用桌面版或本机Chrome');
    return new Promise((resolve,reject)=>{
      navigator.locks.request('dashifeiyu-microphone',{ifAvailable:true},lock=>{
        if(version!==this.version){resolve(false);return;}
        if(!lock){reject(new Error('另一个大肥鱼窗口正在使用麦克风，请先在那个窗口关闭语音'));return;}
        return new Promise(release=>{this.release=release;resolve(true);});
      }).catch(reject);
    });
  }
  close(){this.version++;this.release?.();this.release=null;}
}
