const DB_NAME = 'fridge-ai-helper';
const DB_VERSION = 3;
export const CLOUD_DEFAULTS={key:'state',revision:0,sentRevision:0,lastSaved:null,pending:null};
export function changed(){if(typeof window!=='undefined')window.dispatchEvent(new window.Event('fridge-change'));}
const INGREDIENTS = 'ingredients';
const FRIDGES = 'fridges';
export const HOME_FRIDGE_ID = 'home';
export const MAX_FRIDGES = 5;

let databasePromise;

export function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const database = request.result;
      let ingredients;
      if (event.oldVersion < 1) {
        ingredients = database.createObjectStore(INGREDIENTS, { keyPath: 'id' });
        ingredients.createIndex('createdAt', 'createdAt');
        ingredients.createIndex('normalizedName', 'normalizedName', { unique: true });
      } else {
        ingredients = request.transaction.objectStore(INGREDIENTS);
      }

      if (event.oldVersion < 2) {
        // Keep existing records and selection states in the original fridge.
        ingredients.deleteIndex('normalizedName');
        ingredients.createIndex('fridgeId', 'fridgeId');
        ingredients.createIndex('fridgeAndName', ['fridgeId', 'normalizedName'], { unique: true });
        ingredients.openCursor().onsuccess = cursorEvent => {
          const cursor = cursorEvent.target.result;
          if (!cursor) return;
          cursor.update({ ...cursor.value, fridgeId: HOME_FRIDGE_ID });
          cursor.continue();
        };

        const fridges = database.createObjectStore(FRIDGES, { keyPath: 'id' });
        fridges.put({ id: HOME_FRIDGE_ID, name: '自宅', createdAt: new Date().toISOString() });
      }
      if (event.oldVersion < 3) database.createObjectStore('cloud_meta', {keyPath:'key'});
    };

    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = undefined;
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = undefined;
      reject(request.error || new Error('IndexedDBを開けませんでした'));
    };
    request.onblocked = () => {
      databasePromise = undefined;
      reject(new Error('他のタブでアプリが開かれています。閉じてから再読み込みしてください'));
    };
  });

  return databasePromise;
}

function runTransaction(stores, operation) {
  return openDatabase().then(database => new Promise((resolve, reject) => {
    const transaction = database.transaction([...new Set([].concat(stores,'cloud_meta'))], 'readwrite');
    transaction.dataChanged = true;
    try {
      operation(transaction);
      const metaStore=transaction.objectStore('cloud_meta'),request=metaStore.get('state');
      request.onsuccess=()=>{if(transaction.dataChanged){const m=request.result||CLOUD_DEFAULTS;metaStore.put({...m,revision:m.revision+1});}};
    } catch (error) {
      transaction.abort();
      reject(error);
      return;
    }
    transaction.oncomplete = () => {if(transaction.dataChanged)changed();resolve();};
    transaction.onerror = () => reject(transaction.error || new Error('保存できませんでした'));
    transaction.onabort = () => reject(transaction.error || new Error('保存できませんでした'));
  }));
}

export async function getFridges() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(FRIDGES, 'readonly').objectStore(FRIDGES).getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    request.onerror = () => reject(request.error || new Error('冷蔵庫を読み込めませんでした'));
  });
}

export async function getAllIngredients(fridgeId) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(INGREDIENTS, 'readonly')
      .objectStore(INGREDIENTS).index('fridgeId').getAll(fridgeId);
    request.onsuccess = () => resolve(request.result.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    request.onerror = () => reject(request.error || new Error('食材を読み込めませんでした'));
  });
}

export function saveIngredient(ingredient) {
  return saveChanged(INGREDIENTS,ingredient);
}

function saveChanged(name,value,track=true){return runTransaction(name,tx=>{tx.dataChanged=false;const store=tx.objectStore(name),r=store.get(value.id);r.onsuccess=()=>{if(JSON.stringify(r.result)!==JSON.stringify(value)){tx.dataChanged=track;store.put(value);}};});}

export function removeIngredient(id) {
  return runTransaction(INGREDIENTS, transaction => transaction.objectStore(INGREDIENTS).delete(id));
}

export async function getDatabaseSnapshot() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([FRIDGES, INGREDIENTS], 'readonly');
    const fridgeRequest = transaction.objectStore(FRIDGES).getAll();
    const ingredientRequest = transaction.objectStore(INGREDIENTS).getAll();

    transaction.oncomplete = () => {
      const fridges = (fridgeRequest.result || [])
        .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
      const ingredients = (ingredientRequest.result || [])
        .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
      resolve({ fridges, ingredients });
    };
    transaction.onerror = () => reject(transaction.error || new Error('バックアップ用データを読み込めませんでした'));
    transaction.onabort = () => reject(transaction.error || new Error('バックアップ用データを読み込めませんでした'));
  });
}

export async function replaceDatabaseSnapshot(snapshot,expectedRevision) {
  const database=await openDatabase();
  return new Promise((resolve,reject)=>{
    const tx=database.transaction([FRIDGES,INGREDIENTS,'cloud_meta'],'readwrite'),cm=tx.objectStore('cloud_meta');
    const req=cm.get('state');let message='';
    req.onsuccess=()=>{
      const m=req.result||CLOUD_DEFAULTS;
      if(expectedRevision!==undefined&&m.revision!==expectedRevision){message='確認中に編集されたため復元を中止しました';tx.abort();return;}
      const f=tx.objectStore(FRIDGES).getAll(),i=tx.objectStore(INGREDIENTS).getAll();let count=0;
      const replace=()=>{if(++count!==2)return;
        cm.put({key:'safety',createdAt:new Date().toISOString(),data:{app:'fridge-ai-helper',schemaVersion:1,exportedAt:new Date().toISOString(),activeFridgeId:m.activeFridgeId||null,fridges:f.result,ingredients:i.result,revision:m.revision}});
        tx.objectStore(FRIDGES).clear();tx.objectStore(INGREDIENTS).clear();
        for(const v of snapshot.fridges)tx.objectStore(FRIDGES).add(v);
        for(const v of snapshot.ingredients)tx.objectStore(INGREDIENTS).add(v);
        cm.put({...m,activeFridgeId:snapshot.activeFridgeId||null,revision:m.revision+1,pending:null,needsReview:false});
      };f.onsuccess=replace;i.onsuccess=replace;
    };
    tx.oncomplete=()=>{changed();resolve();};
    tx.onerror=tx.onabort=()=>reject(Error(message||tx.error?.message||'復元できませんでした'));
  });
}

export function saveFridge(fridge,{track=true}={}) {
  return saveChanged(FRIDGES,fridge,track);
}

export function createFridge(fridge, copiedIngredients = []) {
  return runTransaction([FRIDGES, INGREDIENTS], transaction => {
    const store = transaction.objectStore(FRIDGES);
    store.count().onsuccess = event => {
      if (event.target.result >= MAX_FRIDGES) {
        transaction.abort();
        return;
      }
      store.add(fridge);
      const ingredientStore = transaction.objectStore(INGREDIENTS);
      copiedIngredients.forEach(item => ingredientStore.add(item));
    };
  });
}

export function deleteFridge(fridgeId) {
  return runTransaction([FRIDGES, INGREDIENTS], transaction => {
    const fridges = transaction.objectStore(FRIDGES);
    fridges.count().onsuccess = event => {
      if (event.target.result <= 1) {
        transaction.abort();
        return;
      }
      fridges.delete(fridgeId);
      const request = transaction.objectStore(INGREDIENTS).index('fridgeId')
        .openCursor(IDBKeyRange.only(fridgeId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
    };
  });
}
