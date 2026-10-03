import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {webcrypto} from 'node:crypto';
import {build} from 'esbuild';
const code=await build({stdin:{contents:"import './app.js';import './js/cloud.mjs';import * as db from './db.js?v=17';import * as store from './js/cloud-store.mjs';window.TestApp={db,store};",resolveDir:process.cwd()},bundle:true,format:'iife',write:false});
const html=await readFile('index.html','utf8'),app=code.outputFiles[0].text;
const now=new Date().toISOString();
const item={id:'item-test',fridgeId:'home',name:'玉ねぎ',normalizedName:'玉ねぎ',selectionState:'required',isFrozen:true,unit:'回分',quantity:'2',category:'vegetable',createdAt:now,updatedAt:now};
async function settle(fn,ms=9000){const until=Date.now()+ms;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Timed out');}
function network(){const rows=new Map(),puts=[];return {rows,puts,fail:false,online:true,hold:null,unauthorized:false,lock:false,async fetch(url,init){
  if(url==='/v1/session')return new Response(JSON.stringify({connected:true,deviceName:'テスト端末',sessionId:'10000000-0000-4000-8000-000000000000'}));
  if(url==='/v1/backups')return new Response(JSON.stringify({backups:[...rows.values()]}));
  if(init.method==='PUT'){const b=JSON.parse(init.body);puts.push(b);if(this.unauthorized)return new Response('{"error":"認証が解除されました：再接続してください"}',{status:401});if(this.fail)return new Response('{"error":"失敗"}',{status:503});rows.set(b.backup_id,b);if(this.hold)await this.hold;return new Response('{}');}
  return new Response(JSON.stringify(rows.get(url.split('/').at(-1))));
}};}
async function harness(factory,n,fn){
  const dom=new JSDOM(html,{url:'https://fridge-ai-helper-backups.dengana-10011212.workers.dev/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  Object.defineProperty(w,'crypto',{value:webcrypto});Object.assign(w,{indexedDB:factory,IDBKeyRange,TextEncoder,TextDecoder,AbortSignal});w.fetch=(...args)=>n.fetch(...args);
  w.navigator.locks={request:async(name,options,cb)=>{if(n.lock)return cb(null);n.lock=true;try{return await cb({});}finally{n.lock=false;}}};Object.defineProperty(w.navigator,'onLine',{get:()=>n.online});
  w.confirm=()=>true;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  try{w.eval(app);await settle(()=>w.__FRIDGE_CLOUD_READY__);await fn(w);}finally{(await w.TestApp.db.openDatabase()).close();dom.window.close();}
}
test('参照・タブ切替で送信せず、食材・選択状態・少量編集を保存し、送信中の編集も残す',async()=>{
  const f=new IDBFactory(),n=network();await harness(f,n,async w=>{
    await new Promise(r=>setTimeout(r,3300));assert.equal(n.puts.length,0);
    await w.TestApp.db.saveIngredient(item);await settle(()=>n.puts.length===1&&w.document.getElementById('cloudPending').textContent==='なし');
    const before=await w.TestApp.store.meta();await w.TestApp.db.getDatabaseSnapshot();await w.TestApp.db.saveIngredient(item);assert.equal((await w.TestApp.store.meta()).revision,before.revision);
    let release;n.hold=new Promise(r=>release=r);await w.TestApp.db.saveIngredient({...item,quantity:'3'});await settle(()=>n.puts.length===2);
    await w.TestApp.db.saveIngredient({...item,quantity:'4',selectionState:'optional'});n.hold=null;release();
    await settle(()=>n.puts.length===3&&w.document.getElementById('cloudPending').textContent==='なし');
    assert.equal(JSON.parse(n.puts[2].backup_json).ingredients[0].quantity,'4');assert.equal(JSON.parse(n.puts[2].backup_json).ingredients[0].selectionState,'optional');
  });
});
test('オフライン・失敗・再起動でも同一IDで再送し、取消では再試行停止',async()=>{
  const f=new IDBFactory(),n=network();n.online=false;
  await harness(f,n,async w=>{await w.TestApp.db.saveIngredient(item);await new Promise(r=>setTimeout(r,3300));assert.equal(n.puts.length,0);n.fail=true;n.online=true;w.dispatchEvent(new w.Event('online'));await settle(()=>n.puts.length===1);});
  n.fail=false;await harness(f,n,async w=>{
    await settle(()=>n.puts.length===2&&w.document.getElementById('cloudPending').textContent==='なし');assert.equal(n.puts[1].backup_id,n.puts[0].backup_id);
    n.unauthorized=true;await w.TestApp.db.saveIngredient({...item,quantity:'5'});await settle(()=>n.puts.length===3&&w.document.getElementById('cloudStatus').textContent.includes('再接続'));await new Promise(r=>setTimeout(r,3300));assert.equal(n.puts.length,3);
  });
});
test('全冷蔵庫・調味料・食材・選択の復元と退避、確認中の競合を検出',async()=>{
  const f=new IDBFactory(),n=network();n.online=false;
  await harness(f,n,async w=>{
    await w.TestApp.db.saveIngredient(item);await w.TestApp.db.createFridge({id:'other',name:'実家',createdAt:now,seasonings:[{id:'miso',name:'味噌'}],selectedSeasoningIds:['miso']},[]);
    const original=await w.TestApp.store.capture();assert.equal(original.fridges.length,2);assert.equal(original.ingredients[0].isFrozen,true);
    await w.TestApp.db.saveIngredient({...item,quantity:'9'});
    await assert.rejects(w.TestApp.store.replaceData(original,original.revision),/確認中に編集/);
    const current=await w.TestApp.store.capture();await w.TestApp.store.replaceData(original,current.revision);
    assert.equal((await w.TestApp.store.capture()).ingredients[0].quantity,'2');assert.equal((await w.TestApp.store.readRecord('safety')).data.ingredients[0].quantity,'9');
    assert.equal((await w.TestApp.store.capture()).fridges.find(f=>f.id==='other').selectedSeasoningIds[0],'miso');
  });
});
test('既存クラウドがある新しい空端末は初回接続で履歴を押し出さない',async()=>{
  const n=network();n.rows.set('existing',{backup_id:'existing',record_count:10,created_at:now});
  await harness(new IDBFactory(),n,async w=>{await new Promise(r=>setTimeout(r,3300));assert.equal(n.puts.length,0);assert.equal((await w.TestApp.store.meta()).needsReview,true);w.document.getElementById('cloudSave').click();await new Promise(r=>setTimeout(r,300));assert.equal(n.puts.length,0);});
});
