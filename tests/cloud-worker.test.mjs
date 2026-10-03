import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFile,readdir} from 'node:fs/promises';
import {digest,createBackup} from '../js/snapshot.mjs';
await build({entryPoints:['cloudflare/worker.ts'],bundle:true,format:'esm',platform:'node',outfile:'.test-build/worker.mjs'});
const api=(await import('../.test-build/worker.mjs')).default;
const origin='https://fridge-ai-helper-backups.dengana-10011212.workers.dev';
const key='s'.repeat(43);
function snapshot(revision=1){return {app:'fridge-ai-helper',schemaVersion:1,exportedAt:new Date().toISOString(),revision,activeFridgeId:'home',fridges:[{id:'home',name:'自宅',createdAt:new Date().toISOString()}],ingredients:[]};}
async function env(through=Infinity){
  const sql=new DatabaseSync(':memory:');for(const f of (await readdir('cloudflare/migrations')).sort().filter(f=>Number(f.slice(0,4))<=through))sql.exec(await readFile('cloudflare/migrations/'+f,'utf8'));
  let fail=false;
  const prepare=(q)=>({q,params:[],bind(...p){this.params=p;return this;},async first(){return sql.prepare(this.q).get(...this.params)||null;},async all(){return {results:sql.prepare(this.q).all(...this.params)};}});
  return {DB:{prepare,async batch(statements){if(fail&&statements.some(s=>s.q.startsWith('INSERT INTO backups'))){fail=false;throw Error('injected failure');}sql.exec('BEGIN');try{const r=statements.map(s=>sql.prepare(s.q).run(...s.params));sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}},BACKUP_TOKEN_SHA256:await digest(key),sql,fail(){fail=true;}};
}
async function call(e,path,method='GET',body,{cookie,token,from=origin}={}){
  const headers={Origin:from,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.10'};if(cookie)headers.Cookie=cookie;if(token)headers.Authorization='Bearer '+token;
  return api.fetch(new Request(origin+'/v1/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),e);
}
async function login(e){const r=await call(e,'session','POST',{deviceName:'テスト端末'},{token:key});assert.equal(r.status,200);return {cookie:r.headers.get('Set-Cookie').split(';')[0],data:await r.json()};}
test('すべての記録APIで未認証を拒否し、別アプリのキーとCookie・別Originを拒否',async()=>{
  const e=await env(),id=crypto.randomUUID();
  for(const [path,method,body] of [['backups','GET'],['backups/'+id,'GET'],['backups/'+id,'PUT',{}],['backups/'+id,'DELETE']])assert.equal((await call(e,path,method,body)).status,401);
  assert.equal((await call(e,'session','POST',{deviceName:'test'},{token:'k'.repeat(43)})).status,401);
  assert.equal((await call(e,'backups','GET',undefined,{cookie:'__Host-karaoke-session='+'x'.repeat(43)})).status,401);
  assert.equal((await call(e,'backups','GET',undefined,{token:key,from:'https://yuuuh26.github.io'})).status,403);
  e.sql.close();
});
test('HttpOnly Cookie・管理用キー・端末名変更・取消・キー変更を検証',async()=>{
  const e=await env(),first=await login(e),second=await login(e);
  const r=await call(e,'session','GET',undefined,{cookie:first.cookie});assert.match(r.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=Strict/);assert.doesNotMatch(r.headers.get('Set-Cookie'),/Domain=/);
  assert.equal((await call(e,'sessions/revoke','POST',{all:true},{cookie:first.cookie})).status,401);
  assert.equal((await call(e,'sessions/rename','POST',{sessionId:first.data.sessionId,deviceName:'変更後'},{token:key})).status,200);
  assert.equal((await (await call(e,'session','GET',undefined,{cookie:first.cookie})).json()).deviceName,'変更後');
  assert.equal((await call(e,'sessions/revoke','POST',{sessionId:first.data.sessionId},{token:key})).status,200);
  assert.equal((await call(e,'backups','GET',undefined,{cookie:first.cookie})).status,401);
  const rotate=await call(e,'sessions/rotate','POST',{}, {token:key});const newKey=(await rotate.json()).recoveryKey;assert.equal(newKey.length,43);
  assert.equal((await call(e,'session','GET',undefined,{cookie:second.cookie})).status,401);
  assert.equal((await call(e,'session','POST',{deviceName:'test'},{token:key})).status,401);
  assert.equal((await call(e,'session','POST',{deviceName:'test'},{token:newKey})).status,200);
  assert.equal(e.sql.prepare('SELECT count(*) as n FROM auth_sessions WHERE token_sha256 LIKE ?').get('%'+first.cookie.split('=')[1]+'%').n,0);
  e.sql.close();
});
test('保存を再取得して検証し、履歴を3件に整理、再送は重複なし、失敗・破損では旧3件を保持',async()=>{
  const e=await env(),{cookie}=await login(e),backups=[];
  for(let i=1;i<=6;i++){const b=await createBackup(snapshot(i));backups.push(b);assert.equal((await call(e,'backups/'+b.backup_id,'PUT',b,{cookie})).status,200);assert.equal((await (await call(e,'backups/'+b.backup_id,'GET',undefined,{cookie})).json()).sha256,b.sha256);}
  let rows=(await (await call(e,'backups','GET',undefined,{cookie})).json()).backups;assert.equal(rows.length,3);assert.equal(rows[0].source_revision,6);
  assert.equal((await call(e,'backups/'+backups[5].backup_id,'PUT',backups[5],{cookie})).status,200);
  assert.equal(e.sql.prepare('SELECT count(*) n FROM backups').get().n,3);
  const bad=await createBackup(snapshot(7));bad.sha256='0'.repeat(64);assert.equal((await call(e,'backups/'+bad.backup_id,'PUT',bad,{cookie})).status,400);assert.equal(e.sql.prepare('SELECT count(*) n FROM backups').get().n,3);
  const newOne=await createBackup(snapshot(7));e.fail();assert.equal((await call(e,'backups/'+newOne.backup_id,'PUT',newOne,{token:key})).status,503);assert.equal(e.sql.prepare('SELECT count(*) n FROM backups').get().n,3);
  // Protected retained records cannot be pruned by an arbitrary statement.
  assert.throws(()=>e.sql.prepare('DELETE FROM backups WHERE backup_id=?').run(backups[5].backup_id),/protected backup/);
  e.sql.close();
});
test('認証試行回数を制限し、設定がない場合は閉じる',async()=>{
  const e=await env();for(let i=0;i<20;i++)assert.equal((await call(e,'session','POST',{deviceName:'test'},{token:'x'.repeat(43)})).status,401);
  assert.equal((await call(e,'session','POST',{deviceName:'test'},{token:key})).status,429);
  e.BACKUP_TOKEN_SHA256='';assert.equal((await call(e,'session','POST',{deviceName:'test'},{token:key})).status,503);e.sql.close();
});
test('5世代からの移行は履歴を保持し、新しい保存が成功した時だけ3世代に整理する',async()=>{
  const e=await env(4);
  for(let i=1;i<=5;i++){
    const b=await createBackup(snapshot(i));
    e.sql.prepare('INSERT INTO backups (backup_id,app_id,schema_version,created_at,received_at,device_id,record_count,source_revision,sha256,byte_length,chunk_count) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(b.backup_id,b.app_id,b.schema_version,b.created_at,b.created_at,b.device_id,b.record_count,b.source_revision,b.sha256,b.byte_length,1);
    e.sql.prepare('INSERT INTO backup_chunks VALUES (?,?,?)').run(b.backup_id,0,b.backup_json);
    e.sql.prepare('INSERT INTO backup_retention VALUES (?,?,?,?)').run(b.backup_id,b.app_id,b.created_at,i);
  }
  e.sql.exec(await readFile('cloudflare/migrations/0005_three_generations.sql','utf8'));
  const count=()=>e.sql.prepare('SELECT count(*) n FROM backups').get().n;
  assert.equal(count(),5);
  const next=await createBackup(snapshot(6));
  e.fail();assert.equal((await call(e,'backups/'+next.backup_id,'PUT',next,{token:key})).status,503);assert.equal(count(),5);
  assert.equal((await call(e,'backups/'+next.backup_id,'PUT',next,{token:key})).status,200);
  assert.deepEqual(e.sql.prepare('SELECT source_revision FROM backups ORDER BY source_revision DESC').all().map(r=>r.source_revision),[6,5,4]);
  assert.equal(e.sql.prepare('SELECT count(*) n FROM backup_chunks').get().n,3);
  e.sql.close();
});
