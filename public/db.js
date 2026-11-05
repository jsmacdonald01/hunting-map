// Tiny on-device storage for pins, walking paths and downloaded counties.
const DB_NAME = 'hunting-map';
const STORES = ['pins', 'tracks', 'counties'];
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => STORES.forEach(s => req.result.objectStoreNames.contains(s) || req.result.createObjectStore(s, { keyPath: 'id' }));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const db = {
  all: store => run(store, 'readonly', s => s.getAll()),
  get: (store, id) => run(store, 'readonly', s => s.get(id)),
  put: (store, value) => run(store, 'readwrite', s => s.put(value)),
  del: (store, id) => run(store, 'readwrite', s => s.delete(id)),
};
