const DB_NAME = 'fridge-ai-helper';
const DB_VERSION = 2;
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
    const transaction = database.transaction(stores, 'readwrite');
    try {
      operation(transaction);
    } catch (error) {
      transaction.abort();
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve();
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
  return runTransaction(INGREDIENTS, transaction => transaction.objectStore(INGREDIENTS).put(ingredient));
}

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

export function replaceDatabaseSnapshot(snapshot) {
  return runTransaction([FRIDGES, INGREDIENTS], transaction => {
    const fridgeStore = transaction.objectStore(FRIDGES);
    const ingredientStore = transaction.objectStore(INGREDIENTS);

    fridgeStore.clear();
    ingredientStore.clear();
    snapshot.fridges.forEach(item => fridgeStore.add({ ...item }));
    snapshot.ingredients.forEach(item => ingredientStore.add({ ...item }));
  });
}

export function saveFridge(fridge) {
  return runTransaction(FRIDGES, transaction => transaction.objectStore(FRIDGES).put(fridge));
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
