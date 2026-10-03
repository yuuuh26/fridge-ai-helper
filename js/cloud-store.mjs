import {openDatabase,CLOUD_DEFAULTS,replaceDatabaseSnapshot} from '../db.js?v=18';
import {validateData} from './snapshot.mjs';
const done=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error||Error('端末保存に失敗しました'));});
export async function readRecord(key){const db=await openDatabase();return new Promise((resolve,reject)=>{const r=db.transaction('cloud_meta').objectStore('cloud_meta').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function meta(){return (await readRecord('state'))||{...CLOUD_DEFAULTS};}
export async function updateMeta(fn){
  const db=await openDatabase(),tx=db.transaction('cloud_meta','readwrite'),s=tx.objectStore('cloud_meta'),r=s.get('state');
  r.onsuccess=()=>s.put({...fn(r.result||{...CLOUD_DEFAULTS}),key:'state'});
  await done(tx);if(typeof window!=='undefined')window.dispatchEvent(new window.Event('fridge-cloud-state'));
}
export async function capture(){
  const db=await openDatabase(),tx=db.transaction(['fridges','ingredients','cloud_meta'],'readonly');
  const f=tx.objectStore('fridges').getAll(),i=tx.objectStore('ingredients').getAll(),m=tx.objectStore('cloud_meta').get('state');
  await done(tx);
  return validateData({app:'fridge-ai-helper',schemaVersion:1,exportedAt:new Date().toISOString(),activeFridgeId:m.result?.activeFridgeId||null,fridges:f.result,ingredients:i.result,revision:m.result?.revision||0});
}
export async function replaceData(snapshot,expectedRevision){
  validateData(snapshot);await replaceDatabaseSnapshot(snapshot,expectedRevision);
  try{localStorage.setItem('fridge-ai-helper-active-fridge-v2',snapshot.activeFridgeId||snapshot.fridges[0].id);}catch{}
  await window.FridgeCloud.refreshData();
}
