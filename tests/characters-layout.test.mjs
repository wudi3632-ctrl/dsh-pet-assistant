import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {crc32} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createCharacterStore,unpackZIP} from '../characters/store.mjs';
import {MotionDirector} from '../public/core.mjs';
import {panelLayout} from '../public/overlay-layout.mjs';
import geometry from '../desktop/geometry.cjs';
function zip(entries){let offset=0;const local=[],directory=[];for(const [name,data] of entries){const n=Buffer.from(name),h=Buffer.alloc(30),c=Buffer.alloc(46);h.writeUInt32LE(0x04034b50);h.writeUInt32LE(crc32(data),14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(n.length,26);c.writeUInt32LE(0x02014b50);c.writeUInt32LE(crc32(data),16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);local.push(h,n,data);directory.push(c,n);offset+=h.length+n.length+data.length;}const dir=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,dir,end]);}
test('character ZIP import verifies hashes, persists selection and retains original skin',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pet-skin-')),store=createCharacterStore(root),video=Buffer.from([0x1a,0x45,0xdf,0xa3]);
  const manifest={asset:'测试角色',profile:{width:768,height:768,fps:24},actions:['idle','think','drag_hold','talk_comfort'].map(id=>({id,name:id,file:`actions/${id}.webm`,frames:48,loop:true,sha256:createHash('sha256').update(video).digest('hex')}))};
  const pack=zip([['manifest.json',Buffer.from(JSON.stringify(manifest))],...manifest.actions.map(a=>[a.file,video])]);
  const imported=await store.import(pack);assert.equal(imported.characters.length,2);assert.notEqual(imported.selected,'dashifeiyu');
  const catalog=JSON.parse(await readFile(join(root,'public/assets/characters',imported.selected,'catalog.json'),'utf8'));
  let actual;const director=new MotionDirector(catalog,m=>{actual=m;});director.play('think_loop');assert.equal(actual.id,'think');director.play('talk_soft');assert.equal(actual.id,'talk_comfort');director.dispose();
  assert.equal((await createCharacterStore(root).list()).selected,imported.selected);
  await store.select('dashifeiyu');assert.equal((await store.list()).selected,'dashifeiyu');
  assert.equal((await store.import(pack)).characters.length,2);
  manifest.actions[0].sha256='0'.repeat(64);
  await assert.rejects(store.import(zip([['manifest.json',Buffer.from(JSON.stringify(manifest))],...manifest.actions.map(a=>[a.file,video])])),/哈希/);
  assert.throws(()=>unpackZIP(zip([['../escape',video]])),/非法路径/);
});
test('drag clamps visible pet rather than transparent window, including negative monitor coordinates',()=>{
  const pet={x:160,y:200,width:240,height:240},area={x:-1920,y:0,width:1920,height:1040};
  const p=geometry.clampPetPosition(-5000,5000,area,pet);assert.equal(p.x+pet.x,area.x+4);assert.equal(p.y+pet.y+pet.height,1036);
});
test('bubble, task and badge stay visible at all screen corners and bubble flips above pet',()=>{
  const sizes=[{width:280,height:116},{width:208,height:230},{width:270,height:24}];
  for(const viewport of [{left:0,top:0,right:640,bottom:440},{left:160,top:0,right:640,bottom:440},{left:0,top:168,right:400,bottom:680}]){
    const layout=panelLayout({x:160,y:200,width:240,height:240},viewport,...sizes);
    for(const [key,size] of [['bubble',sizes[0]],['task',sizes[1]],['badge',sizes[2]]]){const box=layout[key];assert.ok(box.x>=viewport.left+8,key);assert.ok(box.y>=viewport.top+8,key);assert.ok(box.x+(box.width||size.width)<=viewport.right-8,key);assert.ok(box.y+size.height<=viewport.bottom-8,key);}
    if(viewport.bottom===440){assert.equal(layout.bubble.above,true);assert.ok(layout.bubble.y+116<=layout.badge.y-4);}
  }
});
