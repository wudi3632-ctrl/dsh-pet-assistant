import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('Windows installer preserves settings, backs up DSH patch and is idempotent for DSH only', { skip:process.platform!=='win32' }, () => {
  const root=mkdtempSync(join(tmpdir(),'dfy-install-'));
  for(const d of ['scripts','backends','public/assets','dsh-bridge','profile']) mkdirSync(join(root,d),{recursive:true});
  for(const f of ['scripts/install.mjs','scripts/runtime.mjs','scripts/dsh-paths.mjs']) copyFileSync(new URL('../'+f,import.meta.url),join(root,f));
  writeFileSync(join(root,'public/assets/motions.json'),JSON.stringify({motions:[{id:'idle',enabled:true,src:'/assets/idle.webm'}]}));
  writeFileSync(join(root,'public/assets/idle.webm'),'fixture');
  writeFileSync(join(root,'settings.local.json'),JSON.stringify({backend:'http://127.0.0.1:60059',cwd:join(root,'workspace'),other:'keep'}));
  const patch=join(root,'profile/cordis.patch.yml');
  writeFileSync(patch,'# unrelated\n- id: existing\n  name: existing-plugin\n');
  const run=host=>JSON.parse(execFileSync(process.execPath,[join(root,'scripts/install.mjs'),`--host=${host}`,'--no-start','--no-shortcut','--skip-runtime-install','--skip-host-runtime-install','--skip-plugin-registration',`--dsh-profile=${join(root,'profile')}`],{env:{...process.env,DFY_ELECTRON:process.execPath},encoding:'utf8',stdio:'pipe'}));
  assert.equal(run('dsh').configured,true);
  const first=readFileSync(patch,'utf8');
  assert.ok(first.includes('name: existing-plugin'));
  assert.equal(first.includes('dashifeiyu-original-pet-bridge'),false);
  run('dsh'); assert.equal(readFileSync(patch,'utf8'),first);
  assert.ok(first.includes('name: existing-plugin'));
  const installed=JSON.parse(readFileSync(join(root,'settings.local.json')));assert.equal(installed.defaultBackend,'dsh');assert.equal(installed.other,'keep');
  for(const unsupported of ['workbuddy','codex'])assert.throws(()=>run(unsupported));
  // Invalid host must not alter configuration.
  const before=readFileSync(join(root,'settings.local.json'),'utf8');
  assert.throws(()=>run('unknown'));
  assert.equal(readFileSync(join(root,'settings.local.json'),'utf8'),before);
});

test('official CLI registration handles Chinese paths, spaces and apostrophes in an isolated profile', {skip:process.platform!=='win32'},()=>{
 const root=mkdtempSync(join(tmpdir(),"pet 安装 ' ")),profile=join(root,'profiles','test-profile');
 for(const d of ['scripts','public/assets', 'profiles/test-profile'])mkdirSync(join(root,d),{recursive:true});
 for(const f of ['install.mjs','runtime.mjs','dsh-paths.mjs'])copyFileSync(new URL('../scripts/'+f,import.meta.url),join(root,'scripts',f));
 writeFileSync(join(root,'public/assets/motions.json'),JSON.stringify({motions:[]}));
 writeFileSync(join(root,'settings.local.json'),JSON.stringify({cwd:join(root,'workspace'),custom:'preserved'}));
 const mock=join(root,'mock-cli.mjs'),cli=join(root,'dsh.cmd');
 writeFileSync(mock,`import {mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';const a=process.argv.slice(2),profile=join(process.env.DSH_HOME,'profiles',a[a.indexOf('--profile')+1]);mkdirSync(profile,{recursive:true});writeFileSync(join(profile,'package.json'),JSON.stringify({dependencies:{'dsh-dashifeiyu-pet':a.at(-1)},dsh:{profile:{bundles:['dsh-dashifeiyu-pet']}}}));`);
 writeFileSync(cli,`@echo off\r\n"${process.execPath}" "%~dp0mock-cli.mjs" %*\r\nexit /b %errorlevel%\r\n`);
 const output=JSON.parse(execFileSync(process.execPath,[join(root,'scripts/install.mjs'),'--no-start','--no-shortcut','--skip-runtime-install',`--dsh-cli=${cli}`,`--dsh-profile=${profile}`],{env:{...process.env,DFY_ELECTRON:process.execPath},encoding:'utf8',stdio:'pipe'}));
 assert.equal(output.pluginRegistered,true);const registered=JSON.parse(readFileSync(join(profile,'package.json')));
 assert.equal(registered.dependencies['dsh-dashifeiyu-pet'],'link:'+root);
 assert.equal(JSON.parse(readFileSync(join(root,'settings.local.json'))).custom,'preserved');
});
