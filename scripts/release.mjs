// Local, reviewable package only. Does not publish to npm or push to GitHub.
import {mkdirSync,mkdtempSync,readFileSync,copyFileSync,renameSync,writeFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dist=join(root,'dist');mkdirSync(dist,{recursive:true});
const npm=process.platform==='win32'?['cmd.exe',['/d','/s','/c','npm pack --json --pack-destination dist']]:['npm',['pack','--json','--pack-destination','dist']];
const [pack]=JSON.parse(execFileSync(npm[0],npm[1],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024}));
const bad=pack.files.filter(f=>/(^|\/)(settings\.local\.json|\.runtime|\.env|legacy|node_modules|artifacts|__pycache__)(\/|$)|public\/assets\/characters|\.(?:bak|pyc)$/.test(f.path));
if(bad.length)throw Error('分发包含本机文件：'+bad.map(f=>f.path).join(','));
const temp=mkdtempSync(join(dist,'verify-'));execFileSync('tar',['-xzf',join(dist,pack.filename),'-C',temp]);
const name=pack.name+'-'+pack.version;renameSync(join(temp,'package'),join(temp,name));
copyFileSync(join(root,'package-lock.json'),join(temp,name,'package-lock.json')); 
const zip=join(dist,name+'-windows-source.zip');execFileSync('tar',['-a','-cf',zip,'-C',temp,name]);
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const record={name,tarball:pack.filename,zip,files:pack.files.length,bytes:pack.size,sha256:{[pack.filename]:hash(join(dist,pack.filename)),[zip.split(/[\\/]/).at(-1)]:hash(zip)},excluded:'本机设置、会话、模型、参考录音、导入角色包、旧插件实现、账号凭据'};
writeFileSync(join(dist,'release-manifest.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record,null,2));
