// 大きなファイル（自分の音源・背景画像）を IndexedDB に保存する小さな道具

const DB_NAME = 'pomoroad';
const STORES = ['files'];
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction('files', mode);
    const store = t.objectStore('files');
    const req = fn(store);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const putFile = (key, blob) => tx('readwrite', (s) => s.put(blob, key));
export const getFile = (key) => tx('readonly', (s) => s.get(key));
export const deleteFile = (key) => tx('readwrite', (s) => s.delete(key));
