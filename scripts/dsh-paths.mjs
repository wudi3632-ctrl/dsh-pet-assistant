import {existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
export function findDSHCLI(root,settings={},explicit){
 const candidates=[explicit,process.env.DFY_DSH_CLI,settings.dshCLI];
 if(explicit)return existsSync(explicit)?resolve(explicit):null;
 try{candidates.push(...execFileSync('where.exe',['dsh.cmd'],{encoding:'utf8',windowsHide:true,timeout:5000}).trim().split(/\r?\n/));}catch{}
 try{
  const data=execFileSync('powershell.exe',['-NoProfile','-Command',"@(Get-CimInstance Win32_Process -Filter \"Name='DeepSeek Harness.exe'\" | Select-Object -ExpandProperty ExecutablePath -Unique) | ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true,timeout:10000});
  const paths=JSON.parse(data||'[]');for(const exe of Array.isArray(paths)?paths:[paths])if(exe)candidates.push(join(dirname(exe),'resources/runtime/cli/bin/dsh.cmd'));
 }catch{}
 candidates.push(join(root,'../dsh-app/resources/runtime/cli/bin/dsh.cmd'));
 return candidates.filter(Boolean).find(p=>existsSync(p))||null;
}
