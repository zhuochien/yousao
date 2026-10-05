/* Google Identity Services + Drive adapter. Access tokens remain in memory only. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YousaoDrive = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const SCOPE = { backup: 'https://www.googleapis.com/auth/drive.appdata', manager: 'https://www.googleapis.com/auth/drive.file' };
  const NAME = { backup: 'yousao-backup.json', manager: '酌有韶-角色創作排程.json' };
  const API = 'https://www.googleapis.com/drive/v3/';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/';
  const idPath = id => { if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('雲端檔案編號不正確'); return encodeURIComponent(id); };
  function create({ storage = localStorage, fetcher = fetch, win = window } = {}) {
    let settings = {}, token = null, gisPromise = null, pickerPromise = null, pending = false;
    try { settings = JSON.parse(storage.getItem('yousao.google') || '{}'); } catch (e) {}
    function config() { return { clientId: settings.clientId || '', pickerApiKey: settings.pickerApiKey || '', projectNumber: settings.projectNumber || '' }; }
    function configure(values) {
      if (values.clientId && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(values.clientId)) throw new Error('請貼上 Google 的 OAuth 用戶端 ID');
      if (values.projectNumber && !/^\d+$/.test(values.projectNumber)) throw new Error('專案編號應該是數字');
      const changed = config().clientId !== values.clientId;
      settings = { clientId: values.clientId || '', pickerApiKey: values.pickerApiKey || '', projectNumber: values.projectNumber || '' };
      storage.setItem('yousao.google', JSON.stringify(settings));
      if (changed) token = null;
    }
    function loadScript(url) {
      return new Promise((resolve, reject) => {
        const s = win.document.createElement('script'); s.src = url; s.async = true;
        const timer = setTimeout(() => { s.remove(); reject(new Error('Google 載入逾時，請確認網路後重試')); }, 15000);
        s.onload = () => { clearTimeout(timer); resolve(); };
        s.onerror = () => { clearTimeout(timer); s.remove(); reject(new Error('無法載入 Google，請確認網路或封鎖設定')); };
        win.document.head.appendChild(s);
      });
    }
    function prepare() {
      if (win.google?.accounts?.oauth2) return Promise.resolve();
      if (!gisPromise) gisPromise = loadScript('https://accounts.google.com/gsi/client').catch(e => { gisPromise = null; throw e; });
      return gisPromise;
    }
    function isConnected(kind) { return !!token && token.until > Date.now() && token.scopes.includes(SCOPE[kind]); }
    function connect(kind) {
      if (!settings.clientId) return Promise.reject(new Error('請先在連線設定填入 OAuth 用戶端 ID'));
      if (!win.google?.accounts?.oauth2) return Promise.reject(new Error('Google 還沒載入，請稍後再按連線'));
      if (pending) return Promise.reject(new Error('Google 授權正在進行中'));
      pending = true;
      return new Promise((resolve, reject) => {
        const finish = (err, value) => { pending = false; clearTimeout(timer); if (err) reject(err); else resolve(value); };
        const timer = setTimeout(() => finish(new Error('授權逾時，請重新按連線')), 60000);
        try {
          const client = win.google.accounts.oauth2.initTokenClient({
            client_id: settings.clientId, scope: SCOPE[kind], include_granted_scopes: true,
            callback: response => {
              if (response.error || !response.access_token) return finish(new Error('未完成 Google 授權，資料仍留在本機'));
              if (!win.google.accounts.oauth2.hasGrantedAllScopes(response, SCOPE[kind])) return finish(new Error('尚未授權這項雲端功能'));
              token = { value: response.access_token, until: Date.now() + Math.max(0, Number(response.expires_in) - 60) * 1000, scopes: (response.scope || '').split(' ') };
              finish(null, true);
            },
            error_callback: () => finish(new Error('Google 視窗關閉或被封鎖，請重新按連線'))
          });
          // Must be called synchronously from the user's click, before any network await.
          client.requestAccessToken({ prompt: 'select_account' });
        } catch (e) { finish(new Error('無法開啟 Google 授權，請確認用戶端 ID 與網站來源')); }
      });
    }
    function disconnect() { token = null; }
    async function request(kind, path, options = {}, upload = false, raw = false) {
      if (!isConnected(kind)) throw new Error('Google 連線已到期，請重新按連線');
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
      try {
        const res = await fetcher((upload ? UPLOAD : API) + path, { ...options, headers: { ...options.headers, Authorization: 'Bearer ' + token.value }, signal: controller.signal, cache: 'no-store', redirect: 'error' });
        if (!res.ok) {
          if (res.status === 401) { token = null; throw new Error('Google 連線已到期，請重新按連線'); }
          if (res.status === 412) throw new Error('雲端檔案已被其他人更新，請重新讀取後再決定');
          if (res.status === 403) throw new Error('尚無權讀寫這個檔案：確認 Drive API 已啟用，既有工作檔請用「選取雲端工作檔」授權');
          if (res.status === 404) throw new Error('找不到雲端檔案，可能已移動、刪除或尚未授權');
          if (res.status === 429) throw new Error('Google 請求次數過多，請稍後再試');
          throw new Error('Google 回應失敗（' + res.status + '），資料沒有被套用');
        }
        if (raw) return res;
        if (res.status === 204) return {};
        return await res.json();
      } catch (e) {
        if (e.name === 'AbortError') throw new Error('Google 回應逾時，請重新讀取雲端確認結果');
        if (e instanceof TypeError) throw new Error('無法連到 Google，請確認網路後重試');
        throw e;
      } finally { clearTimeout(timer); }
    }
    async function list(kind) {
      const q = "trashed = false and name = '" + NAME[kind] + "' and mimeType = 'application/json'";
      const query = new URLSearchParams({ q, spaces: kind === 'backup' ? 'appDataFolder' : 'drive', fields: 'nextPageToken,files(id,name,modifiedTime,webViewLink)', pageSize: '100', orderBy: 'modifiedTime desc' });
      const result = await request(kind, 'files?' + query);
      // Never silently choose one of several snapshots / account files.
      return result.files || [];
    }
    async function metadata(kind, id) {
      const res = await request(kind, 'files/' + idPath(id) + '?fields=id,name,mimeType,modifiedTime,webViewLink,trashed', {}, false, true);
      const data = await res.json();
      if (data.trashed || data.mimeType !== 'application/json') throw new Error('請選擇有效的 JSON 工作檔');
      return { ...data, etag: res.headers.get('ETag') };
    }
    async function download(kind, id) {
      const before = await metadata(kind, id);
      const data = await request(kind, 'files/' + idPath(id) + '?alt=media');
      const after = await metadata(kind, id);
      if (before.modifiedTime !== after.modifiedTime) throw new Error('下載期間雲端已更新，請重新下載');
      return { data, meta: after };
    }
    async function upload(kind, data, { id = null, expectedModifiedTime = null } = {}) {
      let guard = null;
      if (id) {
        guard = await metadata(kind, id);
        if (!expectedModifiedTime || guard.modifiedTime !== expectedModifiedTime) throw new Error('雲端已更新或未先讀取，請重新預覽再上傳');
        if (!guard.etag) throw new Error('Google 沒有提供寫入保護標記，請改為建立新工作檔');
      }
      const boundary = 'yousao_' + Math.random().toString(36).slice(2);
      const meta = id ? {} : { name: NAME[kind], mimeType: 'application/json', ...(kind === 'backup' ? { parents: ['appDataFolder'] } : {}) };
      const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(data, null, 2) + '\r\n--' + boundary + '--';
      const result = await request(kind, 'files' + (id ? '/' + idPath(id) : '') + '?uploadType=multipart&fields=id,name,modifiedTime,webViewLink', {
        method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary, ...(guard ? { 'If-Match': guard.etag } : {}) }, body
      }, true);
      return { data, meta: result };
    }
    async function preparePicker() {
      if (win.google?.picker) return;
      if (!pickerPromise) pickerPromise = (async () => {
        if (!win.gapi) await loadScript('https://apis.google.com/js/api.js');
        await new Promise((resolve, reject) => win.gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('無法載入 Google 選檔視窗')), timeout: 15000, ontimeout: () => reject(new Error('選檔視窗載入逾時')) }));
      })().catch(e => { pickerPromise = null; throw e; });
      return pickerPromise;
    }
    async function pickManager() {
      if (!isConnected('manager')) throw new Error('請先連線創作工作檔');
      if (!settings.pickerApiKey || !settings.projectNumber) throw new Error('選取既有檔案需要連線設定內的 Picker API 金鑰與專案編號；也可先匯入下載的 JSON');
      await preparePicker();
      return new Promise((resolve, reject) => {
        const picker = win.google.picker;
        const view = new picker.DocsView(picker.ViewId.DOCS).setMimeTypes('application/json');
        new picker.PickerBuilder().addView(view).setOAuthToken(token.value).setDeveloperKey(settings.pickerApiKey).setAppId(settings.projectNumber).setOrigin(win.location.origin).setLocale('zh-TW').setTitle('選取酌有韶的創作工作檔').setCallback(result => {
          if (result.action === picker.Action.PICKED) resolve(result.docs[0].id);
          else if (result.action === picker.Action.CANCEL) reject(new Error('已取消選取，資料未改動'));
        }).build().setVisible(true);
      });
    }
    return { config, configure, prepare, connect, disconnect, isConnected, list, metadata, download, upload, pickManager, names: NAME };
  }
  return { create, SCOPE, NAME };
});
