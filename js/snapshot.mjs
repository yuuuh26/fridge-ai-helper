import {validateBackupPayload} from '../backup.js?v=18';
export const APP_ID='fridge-ai-helper';
// Food inventories are text only. Bound snapshots to 2 MiB and split DB rows.
export const MAX_BYTES=2*1024*1024;
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function digest(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export function validateData(s){
  validateBackupPayload(s);
  const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
  const short=(v,max)=>typeof v==='string'&&v.length<=max;
  for(const f of s.fridges){
    if(!short(f.id,160)||!short(f.name,160)||!date(f.createdAt))throw Error('冷蔵庫の日時・名前を確認してください');
    for(const v of f.seasonings||[])if(!short(v.id,160)||!short(v.name,160))throw Error('調味料の形式を確認してください');
  }
  for(const i of s.ingredients){
    if(!short(i.id,160)||!short(i.name,500)||!short(i.normalizedName,500)||!date(i.createdAt)||(i.updatedAt!==undefined&&!date(i.updatedAt))||(i.quantity!==undefined&&!short(i.quantity,100))||(i.category!==undefined&&!short(i.category,100)))throw Error('食材の形式・日時を確認してください');
  }
  if(!integer(s.revision??0))throw Error('更新番号が不正です');
  if(new TextEncoder().encode(JSON.stringify(s)).length>MAX_BYTES)throw Error('バックアップは2MBまでです');
  return {...s,revision:s.revision??0};
}
export function parseSnapshot(text){if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_BYTES)throw Error('バックアップは2MBまでです');return validateData(JSON.parse(text));}
export async function createBackup(snapshot,deviceId=null){
  const s=validateData(snapshot),backup_json=JSON.stringify(s);
  return {backup_id:crypto.randomUUID(),app_id:APP_ID,schema_version:1,created_at:new Date().toISOString(),device_id:deviceId,record_count:s.ingredients.length,source_revision:s.revision,backup_json,sha256:await digest(backup_json),byte_length:new TextEncoder().encode(backup_json).length};
}
export async function validateBackup(v){
  if(!v||!uuid.test(v.backup_id)||v.app_id!==APP_ID||v.schema_version!==1||!iso(v.created_at)||(v.device_id!==null&&!uuid.test(v.device_id))||!integer(v.record_count)||!integer(v.source_revision)||!integer(v.byte_length)||!/^[0-9a-f]{64}$/.test(v.sha256))throw Error('バックアップ情報が不正です');
  const s=parseSnapshot(v.backup_json);
  if(s.ingredients.length!==v.record_count||s.revision!==v.source_revision||new TextEncoder().encode(v.backup_json).length!==v.byte_length||await digest(v.backup_json)!==v.sha256)throw Error('バックアップの照合に失敗しました');
  return s;
}
