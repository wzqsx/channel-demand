/** 简易 IndexedDB KV：大表库存不能放 localStorage（约 5MB 上限） */

const DB_NAME = 'channel-demand-kv';
const DB_VER = 1;
const STORE = 'kv';

type MemoryFallback = Map<string, string>;
const memory: MemoryFallback = new Map();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('NO_IDB'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IDB open failed'));
  });
}

export async function idbGet(key: string): Promise<string | null> {
  const work = async () => {
    try {
      const db = await openDb();
      return await new Promise<string | null>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => {
          const v = req.result;
          resolve(typeof v === 'string' ? v : v == null ? null : String(v));
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return memory.has(key) ? memory.get(key)! : null;
    }
  };
  return Promise.race([
    work(),
    new Promise<string | null>(resolve => setTimeout(() => resolve(memory.get(key) ?? null), 3000)),
  ]);
}

export async function idbSet(key: string, value: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).put(value, key);
    });
    memory.set(key, value);
  } catch {
    memory.set(key, value);
  }
}

export async function idbDel(key: string): Promise<void> {
  memory.delete(key);
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).delete(key);
    });
  } catch {
    /* memory already cleared */
  }
}

export function yieldToMain(): Promise<void> {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
}
