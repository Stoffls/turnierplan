// Turnierplan – Datenspeicher
// Mit Firebase-Konfiguration: Online (Firestore), alle Geräte sehen dieselben Daten live.
// Ohne Konfiguration: Demo-Modus, Daten nur in diesem Browser.

const FB_VERSION = '12.19.0';

function clean(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export async function createStore(config) {
  if (config && config.apiKey && config.projectId) return firebaseStore(config);
  return localStore();
}

async function firebaseStore(config) {
  const appMod = await import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-app.js`);
  const fs = await import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-firestore.js`);
  const app = appMod.initializeApp(config);
  const db = fs.getFirestore(app);
  const tRef = (id) => fs.doc(db, 'turniere', id);
  const sRef = fs.doc(db, 'app', 'einstellungen');

  return {
    mode: 'online',
    subscribeList(cb, onErr) {
      return fs.onSnapshot(fs.collection(db, 'turniere'), (snap) => cb(snap.docs.map((d) => ({ ...d.data(), id: d.id }))), onErr);
    },
    subscribe(id, cb, onErr) {
      return fs.onSnapshot(tRef(id), (s) => cb(s.exists() ? { ...s.data(), id: s.id } : null), onErr);
    },
    async create(t) {
      await fs.setDoc(tRef(t.id), clean(t));
    },
    async update(id, fn) {
      return fs.runTransaction(db, async (tx) => {
        const s = await tx.get(tRef(id));
        if (!s.exists()) throw new Error('Dieses Turnier gibt es nicht mehr.');
        const t = { ...s.data(), id };
        fn(t);
        tx.set(tRef(id), clean(t));
        return t;
      });
    },
    async remove(id) {
      await fs.deleteDoc(tRef(id));
    },
    subscribeSettings(cb, onErr) {
      return fs.onSnapshot(sRef, (s) => cb(s.exists() ? s.data() : { admins: [] }), onErr);
    },
    async updateSettings(fn) {
      return fs.runTransaction(db, async (tx) => {
        const s = await tx.get(sRef);
        const data = s.exists() ? s.data() : { admins: [] };
        fn(data);
        tx.set(sRef, clean(data));
        return data;
      });
    },
  };
}

function localStore() {
  const KEY = 'turnierplan_demo_v1';
  let memory = null;
  const read = () => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* Speicher gesperrt: im Arbeitsspeicher weiter */ }
    return memory || { turniere: {}, settings: { admins: [] } };
  };
  const write = (data) => {
    memory = data;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* nur im Arbeitsspeicher */ }
    emit();
  };
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  try { window.addEventListener('storage', (e) => { if (e.key === KEY) emit(); }); } catch (e) { /* egal */ }
  const listen = (fn) => { listeners.add(fn); queueMicrotask(fn); return () => listeners.delete(fn); };

  return {
    mode: 'demo',
    subscribeList(cb) {
      return listen(() => cb(Object.values(read().turniere).map(clean)));
    },
    subscribe(id, cb) {
      return listen(() => { const t = read().turniere[id]; cb(t ? clean(t) : null); });
    },
    async create(t) {
      const d = read(); d.turniere[t.id] = clean(t); write(d);
    },
    async update(id, fn) {
      const d = read();
      if (!d.turniere[id]) throw new Error('Dieses Turnier gibt es nicht mehr.');
      const t = clean(d.turniere[id]);
      fn(t);
      d.turniere[id] = clean(t);
      write(d);
      return t;
    },
    async remove(id) {
      const d = read(); delete d.turniere[id]; write(d);
    },
    subscribeSettings(cb) {
      return listen(() => cb(clean(read().settings || { admins: [] })));
    },
    async updateSettings(fn) {
      const d = read();
      const s = clean(d.settings || { admins: [] });
      fn(s);
      d.settings = clean(s);
      write(d);
      return s;
    },
  };
}
