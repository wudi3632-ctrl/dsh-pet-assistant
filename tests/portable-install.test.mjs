import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';
import {speechFiles,speechPaths} from '../speech/paths.mjs';
import {findDSHCLI} from '../scripts/dsh-paths.mjs';
test('portable speech requires every runtime file; explicit configuration has priority',()=>{
 const root=mkdtempSync(join(tmpdir(),'pet-portable-')),model=join(root,'.runtime/speech'),python=join(model,'.venv/Scripts/python.exe');
 mkdirSync(dirname(python),{recursive:true});writeFileSync(python,'fixture');
 assert.equal(speechPaths(root,{},{}).missing.length,7);
 for(const f of speechFiles){const target=join(model,f);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,'fixture');}
 assert.equal(speechPaths(root,{},{}).available,true);
 assert.equal(speechPaths(root,{speech:{root:join(root,'custom')}},{}).available,false);
 assert.equal(speechPaths(root,{}, {DFY_ASR_ROOT:model,DFY_ASR_PYTHON:python}).available,true);
});
test('explicit invalid DSH CLI is not silently replaced with another installation',()=>{
 assert.equal(findDSHCLI(tmpdir(),{},join(tmpdir(),'missing-dsh-cli.cmd')),null);
});
