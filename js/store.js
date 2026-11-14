// Saved data lives on this device: small settings in localStorage, games and analysis in IndexedDB.
const P = "chesstrainer.";
export const pref = {
  get(k, d = null) { try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch {} },
};

let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open("chesstrainer", 1);
    r.onupgradeneeded = () => { const d = r.result; for (const s of ["kv", "games", "analysis"]) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function tx(store, mode, fn) {
  return db().then(d => new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => res(out && "result" in out ? out.result : out);
    t.onerror = () => rej(t.error);
  }));
}
export const idb = {
  get: (store, k) => tx(store, "readonly", s => s.get(k)),
  set: (store, k, v) => tx(store, "readwrite", s => s.put(v, k)),
  del: (store, k) => tx(store, "readwrite", s => s.delete(k)),
  all: (store) => tx(store, "readonly", s => s.getAll()),
  keys: (store) => tx(store, "readonly", s => s.getAllKeys()),
  setMany: (store, entries) => tx(store, "readwrite", s => { for (const [k, v] of entries) s.put(v, k); }),
  clear: (store) => tx(store, "readwrite", s => s.clear()),
};
