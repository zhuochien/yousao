/* The UI only reads/writes through this Store; Drive is an explicit remote adapter. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./manager-data.js'));
  else root.YousaoStore = factory(root.YousaoManager);
})(typeof globalThis === 'object' ? globalThis : this, function (Data) {
  'use strict';
  function create({ storage = localStorage, claude = null, uid = () => crypto.randomUUID() } = {}) {
    const KEY = 'yousao.v1', RECOVERY = 'yousao.recovery.v1', COLS = Data.COLS;
    const cache = Object.fromEntries(COLS.map(c => [c, new Map()]));
    const listeners = [];
    let mode = 'local', cols = null, chain = Promise.resolve(), persistOk = true, errHandler = () => {};
    const emit = () => listeners.forEach(f => f());
    function rawData(maps = cache) {
      const o = { app: 'yousao', v: 2, exportedAt: new Date().toISOString() };
      COLS.forEach(c => { o[c] = Object.fromEntries([...maps[c]].map(([id, r]) => [id, Data.strip(r)])); });
      return o;
    }
    function encode(maps) {
      const o = rawData(maps); delete o.app; delete o.exportedAt; o.v = 1;
      return JSON.stringify(o);
    }
    function loadLocal() {
      try {
        const raw = storage.getItem(KEY);
        if (raw) {
          const o = Data.validateBackup(JSON.parse(raw));
          COLS.forEach(c => Object.entries(o[c]).forEach(([id, r]) => cache[c].set(id, { ...r, id })));
        }
        storage.setItem(KEY + '.probe', '1'); storage.removeItem(KEY + '.probe');
      } catch (e) { persistOk = false; errHandler(e); }
    }
    function saveLocal() {
      try { storage.setItem(KEY, encode(cache)); persistOk = true; }
      catch (e) { persistOk = false; errHandler(e); }
    }
    async function init() {
      let db = null;
      if (claude && typeof claude.use === 'function') { try { db = await claude.use('db'); } catch (e) {} }
      if (!db) { loadLocal(); return; }
      mode = 'db'; cols = Object.fromEntries(COLS.map(c => [c, db.collection(c)]));
      await new Promise(resolve => {
        const seen = new Set(), timer = setTimeout(resolve, 8000);
        COLS.forEach(c => cols[c].onSnapshot(snap => {
          cache[c] = new Map(snap.docs.map(d => [d.id, { ...d.data(), id: d.id }]));
          seen.add(c); if (seen.size === COLS.length) { clearTimeout(timer); resolve(); } emit();
        }, () => { seen.add(c); if (seen.size === COLS.length) { clearTimeout(timer); resolve(); } }));
      });
    }
    function persist(c, r, isDel) {
      if (mode === 'db') chain = chain.then(() => isDel ? cols[c].doc(r.id).delete() : cols[c].doc(r.id).set(Data.strip(r))).catch(e => errHandler(e));
      else saveLocal();
    }
    function remember() {
      try { storage.setItem(RECOVERY, JSON.stringify(rawData())); }
      catch (e) { throw new Error('無法保存改動前的復原點，請先匯出備份並釋出儲存空間'); }
    }
    function commitMaps(next) {
      if (mode !== 'local') throw new Error('請在 GitHub Pages 版本操作雲端匯入');
      remember();
      try { storage.setItem(KEY, encode(next)); }
      catch (e) { persistOk = false; throw new Error('儲存空間不足，沒有套用改動'); }
      COLS.forEach(c => { cache[c] = next[c]; }); persistOk = true; emit();
    }
    const api = {
      init, cols: COLS, mode: () => mode, persistOk: () => persistOk,
      onChange: f => listeners.push(f), onError: f => { errHandler = f; },
      list: c => [...cache[c].values()], get: (c, id) => cache[c].get(id) || null,
      put(c, rec) {
        const r = { ...rec }; if (!r.id) r.id = uid();
        cache[c].set(r.id, r); persist(c, r, false); emit(); return r;
      },
      del(c, id) { cache[c].delete(id); persist(c, { id }, true); emit(); },
      exportData: () => rawData(),
      importData(o) {
        const data = Data.validateBackup(o);
        if (mode === 'db') {
          let n = 0; COLS.forEach(c => Object.entries(data[c]).forEach(([id, r]) => { api.put(c, { ...r, id }); n++; })); return n;
        }
        const next = Object.fromEntries(COLS.map(c => [c, new Map(cache[c])])); let n = 0;
        COLS.forEach(c => Object.entries(data[c]).forEach(([id, r]) => { next[c].set(id, { ...r, id }); n++; }));
        commitMaps(next); return n;
      },
      replaceData(o) {
        const data = Data.validateBackup(o), next = Object.fromEntries(COLS.map(c => [c, new Map(Object.entries(data[c]).map(([id, r]) => [id, { ...r, id }]))]));
        commitMaps(next);
      },
      recoveryData() { const raw = storage.getItem(RECOVERY); return raw ? Data.validateBackup(JSON.parse(raw)) : null; },
      managerSnapshot: () => Data.snapshot(rawData()),
      previewManager: o => Data.preview(rawData(), o),
      applyManager(o, keys, expectedPreview) {
        const current = api.previewManager(o), selected = current.items.filter(x => keys.includes(x.key));
        if (!selected.length) throw new Error('請先勾選要採用的項目');
        selected.forEach(x => {
          if (x.state === 'conflict') throw new Error('資料已變更，請重新讀取提案');
          const old = expectedPreview.items.find(y => y.key === x.key);
          if (!old || !Data.equal(x.before, old.before)) throw new Error('預覽後資料已變更，請重新讀取提案');
          if (x.col === 'tasks' && x.after.projectId && !cache.projects.has(x.after.projectId) && !selected.some(p => p.col === 'projects' && p.id === x.after.projectId)) throw new Error('請一併勾選這件待辦所屬的新專案');
        });
        const next = Object.fromEntries(COLS.map(c => [c, new Map(cache[c])]));
        selected.forEach(x => next[x.col].set(x.id, { ...x.after, id: x.id }));
        commitMaps(next); return selected.length;
      },
      async pushRemote(adapter, kind, options) { return adapter.upload(kind, kind === 'backup' ? rawData() : api.managerSnapshot(), options); },
      async pullRemote(adapter, kind, id) {
        const result = await adapter.download(kind, id);
        result.data = kind === 'backup' ? Data.validateBackup(result.data) : Data.validateWorkspace(result.data);
        return result;
      }
    };
    return api;
  }
  return { create };
});
