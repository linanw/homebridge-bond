import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {BondMetadata} from '../lib/metadata.mjs';

const identity='bridge1234';
function fixture(t) {
  const directory=mkdtempSync(join(tmpdir(),'bond-meta-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  let row={name:'Desk',location:'Studio'};
  const writes=[];
  const options={directory,identity,initial:row,locations:['Studio','Kitchen'],read:async()=>({...row}),
    write:async patch=>{writes.push(patch);Object.assign(row,patch);},observed(){}};
  const meta=new BondMetadata(options);
  const request=patch=>({identity,expectedVersion:meta.projection().state.version,requestKey:randomUUID(),...patch});
  return {meta,request,row,options,writes,dir:join(directory,'bond-homekit',identity)};
}
test('Bond PATCHes only selected fields, re-reads, persists and rejects stale/replayed changes', async t => {
  const {meta,request,row,writes,options}=fixture(t);
  const name=request({name:'New'}), stale=request({name:'Bad'});
  await meta.accept('fabric1',name);
  const afterCrash=new BondMetadata(options);
  await afterCrash.reconcile();
  assert.equal(afterCrash.projection().state.sourceStatus,2);
  assert.equal(afterCrash.projection().state.appleStatus,4);
  await afterCrash.accept('fabric1',name);
  await assert.rejects(afterCrash.accept('fabric1',stale));
  await assert.rejects(afterCrash.accept('fabric1',{...name,name:'Other'}));
  const key=afterCrash.rooms.find(r=>r.label==='Kitchen').key;
  await afterCrash.accept('fabric1',{...request({roomKey:key}),expectedVersion:afterCrash.projection().state.version});
  await afterCrash.reconcile();
  assert.deepEqual(row,{name:'New',location:'Kitchen'});
  assert.deepEqual(writes,[{name:'New'},{location:'Kitchen'}]);
});
test('Apple confirms only after matching accessory, operation and actual HomeKit field readback', async t=>{
  const {meta,request,dir}=fixture(t);
  const key=meta.rooms[0].key;
  const binding={identity,home:randomUUID(),accessory:randomUUID(),rooms:{[key]:randomUUID()}};
  writeFileSync(join(dir,'binding.json'),JSON.stringify(binding));
  await meta.reconcile();
  const op=request({name:'Kitchen fan',roomKey:key});
  await meta.accept('fabric',op); await meta.reconcile();
  assert.equal(meta.projection().state.appleStatus,1);
  const receipt={id:op.requestKey,identity,home:binding.home,accessory:randomUUID(),name:op.name,room:binding.rooms[key]};
  writeFileSync(join(dir,'receipt.json'),JSON.stringify(receipt)); await meta.reconcile();
  assert.equal(meta.projection().state.appleStatus,1);
  receipt.accessory=binding.accessory;receipt.room=randomUUID();
  writeFileSync(join(dir,'receipt.json'),JSON.stringify(receipt));await meta.reconcile();
  assert.equal(meta.projection().state.appleStatus,5);
});
