const DB_NAME = 'fridge-ai-helper';
const DB_VERSION = 1;
const STORE_NAME = 'ingredients';

let databasePromise;

export function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('normalizedName', 'normalizedName', { unique: true });
      }
    };

    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error || new Error('IndexedDBを開けませんでした'));
    request.onblocked = () => reject(new Error('IndexedDBの更新がブロックされています'));
  });

  return databasePromise;
}

function runTransaction(mode, operation) {
  return openDatabase().then(database => new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let result;

    try {
      result = operation(store);
    } catch (error) {
      transaction.abort();
      reject(error);
      return;
    }

    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || new Error('保存できませんでした'));
    transaction.onabort = () => reject(transaction.error || new Error('保存できませんでした'));
  }));
}

export async function getAllIngredients() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    request.onerror = () => reject(request.error || new Error('食材を読み込めませんでした'));
  });
}

export function saveIngredient(ingredient) {
  return runTransaction('readwrite', store => store.put(ingredient));
}

export function removeIngredient(id) {
  return runTransaction('readwrite', store => store.delete(id));
}
