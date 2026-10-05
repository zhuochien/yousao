const test = require('node:test');
const assert = require('node:assert/strict');
const Data = require('../manager-data.js');
const { create } = require('../app-store.js');
const { create: driveCreate, SCOPE } = require('../google-drive.js');
function memory(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: k => m.get(k) || null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k), m };
}
function empty() { return { app: 'yousao', v: 2, ...Object.fromEntries(Data.COLS.map(c => [c, {}])) }; }
function fixture() {
  const d = empty();
  d.projects.p = { title: '創作', realm: 'night', status: 'doing', unknown: { keep: true } };
  d.projects.day = { title: '工作', realm: 'day' };
  d.tasks.t = { title: '開場', realm: 'night', projectId: 'p', date: '2026-10-07', done: false, minutes: 30 };
  d.tasks.day = { title: '工作機密', realm: 'day' };
  d.tasks.cross = { title: '朝暮錯配', realm: 'night', projectId: 'day' };
  d.moods['2026-10-05'] = { note: '私人心情' };
  return d;
}
function proposal(data, record = { title: '開場', realm: 'night', date: '2026-10-08' }) {
  const w = Data.snapshot(data);
  w.proposal = { id: 'plan-1', author: '經紀人', summary: '調整排程', projects: [], tasks: [{ id: 't', expected: data.tasks.t, record }] };
  return w;
}
async function store(d = fixture(), storage) {
  const s = storage || memory({ 'yousao.v1': JSON.stringify({ ...d, v: 1 }) });
  const api = create({ storage: s, uid: () => 'generated' }); await api.init(); return { api, storage: s };
}
test('existing local data, IDs, unknown fields and realms survive loading and saving', async () => {
  const { api, storage } = await store();
  assert.equal(api.get('projects', 'p').id, 'p'); api.put('tasks', { ...api.get('tasks', 't'), minutes: 45 });
  const persisted = JSON.parse(storage.getItem('yousao.v1'));
  assert.deepEqual(persisted.projects.p.unknown, { keep: true }); assert.equal(persisted.projects.day.realm, 'day'); assert.equal(persisted.v, 1);
});
test('manager snapshot excludes private/day collections and cross-realm task links', () => {
  const w = Data.snapshot(fixture()); assert.deepEqual(Object.keys(w.projects), ['p']); assert.deepEqual(Object.keys(w.tasks), ['t']);
  assert.equal(w.moods, undefined); assert.equal(JSON.stringify(w).includes('私人心情'), false);
});
test('proposal adoption is atomic, preserves unrelated data and writes a recovery point', async () => {
  const { api, storage } = await store(), before = api.exportData(), w = proposal(before), p = api.previewManager(w); let changed = 0; api.onChange(() => changed++);
  assert.equal(api.applyManager(w, ['tasks:t'], p), 1); assert.equal(changed, 1); assert.equal(api.get('tasks', 't').date, '2026-10-08');
  assert.deepEqual(api.exportData().moods, before.moods); assert.deepEqual(api.exportData().projects, before.projects);
  assert.equal(JSON.parse(storage.getItem('yousao.recovery.v1')).tasks.t.date, '2026-10-07');
});
test('local edits since the AI read are conflicts', async () => {
  const { api } = await store(), w = proposal(api.exportData()); api.put('tasks', { ...api.get('tasks', 't'), note: '剛改過' });
  assert.equal(api.previewManager(w).items[0].state, 'conflict');
});
test('edits after preview block adoption and leave data intact', async () => {
  const { api } = await store(), w = proposal(api.exportData()), p = api.previewManager(w); api.put('tasks', { ...api.get('tasks', 't'), date: '2026-10-09' });
  assert.throws(() => api.applyManager(w, ['tasks:t'], p), /資料已變更/); assert.equal(api.get('tasks', 't').date, '2026-10-09');
});
test('completed work cannot be reopened by an AI proposal', async () => {
  const d = fixture(); d.tasks.t.done = true; const { api } = await store(d);
  const w = proposal(api.exportData(), { title: '開場', realm: 'night', done: false }); assert.equal(api.previewManager(w).items[0].state, 'conflict');
});
test('repeated adoption is recognized as already consistent', async () => {
  const { api } = await store(), w = proposal(api.exportData()), p = api.previewManager(w); api.applyManager(w, ['tasks:t'], p);
  assert.equal(api.previewManager(w).items[0].state, 'same');
});
test('new task requires selecting its new project as well', async () => {
  const { api } = await store(), w = api.managerSnapshot();
  w.proposal = { id: 'new-plan', author: 'GPT', summary: '新增', projects: [{ id: 'new-project', expected: null, record: { title: '新角色', realm: 'night', status: 'new' } }], tasks: [{ id: 'new-task', expected: null, record: { title: '新開場', realm: 'night', projectId: 'new-project' } }] };
  const p = api.previewManager(w); assert.throws(() => api.applyManager(w, ['tasks:new-task'], p), /一併勾選/);
  api.applyManager(w, ['projects:new-project', 'tasks:new-task'], p); assert.equal(api.get('tasks', 'new-task').projectId, 'new-project');
});
test('ID collisions with day projects cannot overwrite them', async () => {
  const { api } = await store(), w = api.managerSnapshot(); w.proposal = { id: 'collision', author: 'GPT', summary: '', projects: [{ id: 'day', expected: null, record: { title: '企劃', realm: 'night' } }], tasks: [] };
  assert.equal(api.previewManager(w).items[0].state, 'conflict'); assert.equal(api.get('projects', 'day').title, '工作');
});
test('quota failure does not partly import or mutate the Store', async () => {
  const { api, storage } = await store(), before = api.exportData(), old = storage.getItem('yousao.v1'), setter = storage.setItem;
  storage.setItem = (k, v) => { if (k === 'yousao.v1') throw new Error('quota'); setter(k, v); };
  const w = proposal(before); assert.throws(() => api.applyManager(w, ['tasks:t'], api.previewManager(w)), /沒有套用/);
  assert.deepEqual(api.exportData().tasks, before.tasks); assert.equal(storage.getItem('yousao.v1'), old);
});
test('invalid complete backups are rejected before any mutations', async () => {
  const { api } = await store(), before = api.exportData(); const bad = empty(); delete bad.moods;
  assert.throws(() => api.replaceData(bad), /缺少集合/); assert.deepEqual(api.exportData().tasks, before.tasks);
});
test('backup replace removes obsolete entries; restore uses the previous snapshot', async () => {
  const { api } = await store(), before = api.exportData(); api.replaceData(empty()); assert.equal(api.list('tasks').length, 0);
  api.replaceData(api.recoveryData()); assert.deepEqual(api.exportData().tasks, before.tasks);
});
test('invalid dates, realms, unsupported fields and duplicate IDs are rejected', () => {
  for (const patch of [{ date: '2026-02-30' }, { realm: 'day' }, { minutes: -1 }, { secret: 'never' }]) {
    assert.throws(() => Data.validateWorkspace(proposal(fixture(), { title: '項目', realm: 'night', ...patch })));
  }
  const w = proposal(fixture()); w.proposal.tasks.push(w.proposal.tasks[0]); assert.throws(() => Data.validateWorkspace(w), /重複/);
});
test('expected comparisons are independent of object key order', () => {
  const d = fixture(), w = proposal(d); w.proposal.tasks[0].expected = Object.fromEntries(Object.entries(d.tasks.t).reverse());
  assert.equal(Data.preview(d, w).items[0].state, 'change');
});
function mockDrive(fetcher, scopes = SCOPE.manager) {
  const storage = memory(); let config, callback;
  const win = { google: { accounts: { oauth2: { initTokenClient: options => { config = options; return { requestAccessToken: () => options.callback({ access_token: 'MEMORY_ONLY_TEST_TOKEN', expires_in: 3600, scope: scopes }) }; }, hasGrantedAllScopes: (r, s) => r.scope.split(' ').includes(s) } } } };
  const drive = driveCreate({ storage, fetcher, win }); drive.configure({ clientId: '123-test.apps.googleusercontent.com' });
  return { drive, storage, getConfig: () => config };
}
const response = (o, headers = {}) => new Response(JSON.stringify(o), { status: 200, headers });
test('OAuth asks only for the needed scope and never persists tokens', async () => {
  const { drive, storage, getConfig } = mockDrive(async () => response({ files: [] })); await drive.connect('manager');
  assert.equal(getConfig().scope, SCOPE.manager); assert.equal(drive.isConnected('manager'), true); assert.equal(drive.isConnected('backup'), false);
  assert.equal(JSON.stringify([...storage.m]).includes('MEMORY_ONLY_TEST_TOKEN'), false); drive.disconnect(); assert.equal(drive.isConnected('manager'), false);
});
test('conditional upload checks modifiedTime, sends If-Match, and keeps authorization out of URL/body', async () => {
  const calls = []; const { drive } = mockDrive(async (url, options) => {
    calls.push({ url, options }); return url.includes('/upload/') ? response({ id: 'file_1', modifiedTime: 'later' }) : response({ id: 'file_1', mimeType: 'application/json', modifiedTime: 'before' }, { ETag: '"version1"' });
  }); await drive.connect('manager'); await drive.upload('manager', Data.snapshot(fixture()), { id: 'file_1', expectedModifiedTime: 'before' });
  assert.equal(calls[1].options.headers['If-Match'], '"version1"'); assert.equal(calls[1].options.method, 'PATCH'); assert.equal(calls[1].options.cache, 'no-store');
  assert.equal(calls[1].url.includes('MEMORY_ONLY_TEST_TOKEN'), false); assert.equal(calls[1].options.body.includes('MEMORY_ONLY_TEST_TOKEN'), false);
});
test('remote edits and missing conditional headers never trigger an overwrite', async () => {
  for (const headers of [{ ETag: '"v1"' }, {}]) {
    let writes = 0; const { drive } = mockDrive(async (url, options) => { if (options.method === 'PATCH') writes++; return response({ mimeType: 'application/json', modifiedTime: headers.ETag ? 'changed' : 'before' }, headers); });
    await drive.connect('manager'); await assert.rejects(drive.upload('manager', {}, { id: 'file_1', expectedModifiedTime: 'before' })); assert.equal(writes, 0);
  }
});
test('private backups create in appDataFolder; manager files stay visible and private', async () => {
  for (const kind of ['backup', 'manager']) {
    let options; const { drive } = mockDrive(async (url, o) => { options = o; return response({ id: 'file_1' }); }, SCOPE[kind]);
    await drive.connect(kind); await drive.upload(kind, kind === 'backup' ? empty() : Data.snapshot(fixture()));
    assert.equal(options.body.includes('appDataFolder'), kind === 'backup'); assert.equal(options.body.includes('permissions'), false);
  }
});
