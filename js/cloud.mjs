import {parseSnapshot,createBackup,validateBackup,digest} from './snapshot.mjs';
import {capture,meta,updateMeta,replaceData,readRecord} from './cloud-store.mjs';
const CLOUD_URL='https://fridge-ai-helper-backups.dengana-10011212.workers.dev/';
const hosted=location.origin===new URL(CLOUD_URL).origin;
const el=id=>document.getElementById(id);
let connected=false,timer,running=false,session,historyRows=[],failures=0;
const fmt=v=>v?new Intl.DateTimeFormat('ja-JP',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Tokyo'}).format(new Date(v)):'まだ保存していません';
async function api(path,method='GET',body,key){
  const headers={};if(body!==undefined)headers['Content-Type']='application/json';if(key)headers.Authorization='Bearer '+key;
  const r=await fetch('/v1/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(25000)});
  const data=await r.json();if(!r.ok){const e=Error(data.error||'通信できませんでした');e.status=r.status;throw e;}return data;
}
function status(message){el('cloudStatus').textContent=message;}
async function renderStatus(){
  const m=await meta();el('cloudLastSaved').textContent=fmt(m.lastSaved);el('cloudPending').textContent=m.revision>m.sentRevision?'あり（端末に保存済み）':'なし';
  el('cloudConnection').textContent=connected?`接続済み：${session?.deviceName||'この端末'}`:'未接続';
  el('cloudLogin').hidden=connected;el('cloudLogout').hidden=!connected;
}
function schedule(delay=3000){clearTimeout(timer);timer=setTimeout(()=>send(false).catch(report),delay);renderStatus().catch(report);}
function report(e){status(e.message||'通信失敗：端末データを保持しています');}
async function send(manual){
  if(!hosted){status('クラウド版で接続してください');return;}
  if(!connected){status('未接続：端末に保存済み');return;}
  if(running)return;
  if(!navigator.onLine){status('オフライン：接続後に再送します');return;}
  if(!navigator.locks){status('このブラウザは自動保存に未対応です。Chromeで開いてください');return;}
  running=true;
  try{await navigator.locks.request('fridge-ai-helper-cloud-send',{ifAvailable:true},async lock=>{
    if(!lock){schedule(2500);return;}
    let m=await meta();
    if(m.needsReview&&!manual){status('既存のクラウド履歴あり：復元または手動保存を選んでください');return;}
    if(manual&&m.needsReview){const s=await capture();if(s.ingredients.length===0&&s.revision===0&&historyRows.length){status('空の初期データは送信しません。履歴から復元してください');return;}if(!await window.FridgeCloud.confirmAction('現在の端末データを保存しますか？',`食材${s.ingredients.length}件・冷蔵庫${s.fridges.length}件を新しいバックアップとして保存します。クラウドは最新3世代を保持します。`,'保存する'))return;await updateMeta(v=>({...v,needsReview:false}));m=await meta();}
    if(m.revision<=m.sentRevision&&!m.pending&&m.lastSaved){status('クラウド保存済み：変更はありません');return;}
    if(!m.pending){
      const snapshot=await capture();
      if(!manual&&snapshot.ingredients.length===0&&snapshot.revision===0){status('接続済み：変更後に自動保存します');return;}
      if(manual&&snapshot.ingredients.length===0&&snapshot.revision===0&&historyRows.length){status('空の初期データは送信しません。履歴から復元してください');return;}
      const b=await createBackup(snapshot,session?.sessionId||null);await updateMeta(v=>({...v,pending:b}));m=await meta();
    }
    const pending=m.pending;status('送信中… 端末に保存済み');
    await api('backups/'+pending.backup_id,'PUT',pending);
    const saved=await api('backups/'+pending.backup_id);await validateBackup(saved);
    if(saved.sha256!==pending.sha256||saved.backup_json!==pending.backup_json)throw Error('保存内容の照合に失敗しました。端末データを保持しています');
    await updateMeta(v=>({...v,sentRevision:Math.max(v.sentRevision,pending.source_revision),pending:v.pending?.backup_id===pending.backup_id?null:v.pending,lastSaved:new Date().toISOString()}));
    failures=0;status('クラウド保存済み');await renderStatus();
    const after=await meta();if(after.revision>after.sentRevision)schedule();
  });}catch(e){
    if(e.status===401){connected=false;status('認証が解除されました：再接続してください');await renderStatus();}
    else{status('通信失敗：端末に保存済み。再試行します');if(++failures<=5)schedule(Math.min(60000,3000*2**failures));}
    throw e;
  }finally{running=false;}
}
async function connect(){
  const key=el('recoveryKey').value.trim(),name=el('deviceName').value.trim();el('recoveryKey').value='';
  try{
    session=await api('session','POST',{deviceName:name},key);connected=true;
    const list=await api('backups');historyRows=list.backups;
    // The initial connection never uploads empty local data or displaces an existing history.
    await updateMeta(v=>({...v,needsReview:historyRows.length>0,checkedExisting:true}));
    await renderStatus();status(historyRows.length?'接続済み：履歴から復元、または手動保存を選んでください':'接続済み：変更後に自動保存します');
    if(!historyRows.length){const s=await capture();if(s.ingredients.length||s.revision>0)schedule();}
  }catch(e){report(e);}
}
function download(snapshot,label='backup'){
  const blob=new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`fridge-ai-helper-${label}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function restore(snapshot,label){
  const current=await capture();
  if(!await window.FridgeCloud.confirmAction('端末のデータを置き換えますか？',`${label}：食材${snapshot.ingredients.length}件・冷蔵庫${snapshot.fridges.length}件。現在の食材${current.ingredients.length}件・冷蔵庫${current.fridges.length}件を端末内に退避します。`,'復元する'))return;
  // Revision checked inside the replacement transaction, including edits from another tab.
  await replaceData(snapshot,current.revision);await updateMeta(v=>({...v,needsReview:false}));
  window.FridgeCloud.showToast('復元しました','変更は端末に保存済みです');schedule();
}
async function loadHistory(){
  const list=await api('backups');historyRows=list.backups;const root=el('cloudHistory');root.replaceChildren();
  if(!historyRows.length){root.textContent='保存履歴はありません';return;}
  for(const row of historyRows){
    const div=document.createElement('div');div.className='cloud-history-row';
    const label=document.createElement('span');label.textContent=`${fmt(row.received_at)} · 食材${row.record_count}件`;
    const button=document.createElement('button');button.className='secondary-button';button.textContent='復元';
    button.onclick=()=>guard(async()=>{const v=await api('backups/'+row.backup_id),s=await validateBackup(v);await restore(s,fmt(row.created_at));});
    div.append(label,button);root.append(div);
  }
}
async function guard(fn){try{await fn();}catch(e){report(e);}}
function managementKey(){const k=el('managementKey').value.trim();el('managementKey').value='';return k;}
async function devices(){
  const key=managementKey();const data=await api('sessions','POST',{},key),root=el('cloudDevices');root.replaceChildren();
  // Key is used for this request only and never captured in event callbacks.
  for(const s of data.sessions){
    const div=document.createElement('div');div.className='cloud-device-row';
    const label=document.createElement('span');label.textContent=`${s.deviceName}${s.current?'（この端末）':''}\n作成 ${fmt(s.createdAt)} / 利用 ${fmt(s.lastUsedAt)}`;
    const rename=document.createElement('button');rename.textContent='名前を変更';rename.className='secondary-button';
    rename.onclick=()=>guard(async()=>{const name=prompt('新しい端末名',s.deviceName);if(!name)return;const k=managementKey();await api('sessions/rename','POST',{sessionId:s.id,deviceName:name},k);status('端末名を変更しました');if(s.current){session.deviceName=name;await renderStatus();}});
    const revoke=document.createElement('button');revoke.textContent='取消';revoke.className='danger-button';
    revoke.onclick=()=>guard(async()=>{const k=managementKey();await api('sessions/revoke','POST',{sessionId:s.id},k);status('この端末の認証を取り消しました');div.remove();if(s.current){connected=false;await renderStatus();}});
    div.append(label,rename,revoke);root.append(div);
  }
}
async function init(){
  el('cloudHostedControls').hidden=!hosted;el('cloudMigration').hidden=hosted;
  if(!hosted)status('移行用：全データを書き出してクラウド版へ読み込んでください');
  el('cloudLoginButton').onclick=()=>guard(connect);
  el('cloudSave').onclick=()=>guard(()=>send(true));
  el('cloudExport').onclick=()=>guard(async()=>download(await capture()));
  el('cloudSafetyExport').onclick=()=>guard(async()=>{const s=await readRecord('safety');if(!s)throw Error('復元前の退避データはありません');download(s.data,'before-restore');});
  el('cloudImport').onchange=event=>guard(async()=>{const f=event.target.files?.[0];event.target.value='';if(!f)return;if(f.size>2*1024*1024)throw Error('ファイルは2MBまでです');const s=parseSnapshot(await f.text());await restore(s,f.name);});
  el('cloudHistoryButton').onclick=()=>guard(loadHistory);
  el('cloudLogout').onclick=()=>guard(async()=>{await api('session/logout','POST',{});connected=false;await renderStatus();status('ログアウト：端末データは保存済み');});
  el('cloudDevicesButton').onclick=()=>guard(devices);
  el('cloudRevokeAll').onclick=()=>guard(async()=>{const k=managementKey();if(!await window.FridgeCloud.confirmAction('全端末の認証を取り消しますか？','この端末も再接続が必要になります。','取り消す'))return;await api('sessions/revoke','POST',{all:true},k);connected=false;el('cloudDevices').replaceChildren();await renderStatus();status('全端末の認証を取り消しました');});
  el('cloudRotate').onclick=()=>guard(async()=>{
    const k=managementKey();if(!await window.FridgeCloud.confirmAction('復旧キーを変更しますか？','新しいキーを1回だけ表示し、全端末の認証を取り消します。新しいキーを保存してください。','変更する'))return;
    const data=await api('sessions/rotate','POST',{},k);connected=false;await renderStatus();
    el('newKey').value=data.recoveryKey;el('newKeyDialog').showModal();status('キーを変更しました。新しいキーで再接続してください');
  });
  el('newKeyCopy').onclick=()=>guard(async()=>{await navigator.clipboard.writeText(el('newKey').value);el('newKeyCopy').textContent='コピー済み';});
  el('newKeyClose').onclick=()=>{el('newKey').value='';el('newKeyDialog').close();};
  el('newKeyDialog').onclose=()=>{el('newKey').value='';};
  window.addEventListener('fridge-change',()=>schedule());
  window.addEventListener('fridge-cloud-state',()=>renderStatus().catch(report));
  window.addEventListener('online',()=>{failures=0;if(connected)schedule(0);else if(hosted)checkSession();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){checkSession();}else if(connected)send(false).catch(report);});
  await renderStatus();if(hosted)await checkSession();
  
  window.__FRIDGE_CLOUD_READY__=true;
}
async function checkSession(){
  if(!hosted)return;
  try{session=await api('session');connected=true;let m=await meta();if(!m.checkedExisting){const list=await api('backups');historyRows=list.backups;await updateMeta(v=>({...v,needsReview:historyRows.length>0,checkedExisting:true}));m=await meta();}await renderStatus();status(m.needsReview?'既存のクラウド履歴あり：復元または手動保存を選んでください':'接続済み');if(m.pending||m.revision>m.sentRevision)schedule();}
  catch(e){connected=false;await renderStatus();status(e.status===401?'未接続：復旧キーで接続してください':'通信失敗：端末データを保持しています');}
}
if(window.__FRIDGE_APP_READY__)init().catch(report);else window.addEventListener('fridge-ready',()=>init().catch(report),{once:true});
