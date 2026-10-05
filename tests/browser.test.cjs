/* Run with the repository served at http://127.0.0.1:8765. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const Data = require('../manager-data.js');
const fs = require('node:fs');
const origin = process.env.YOUS_AO_TEST_ORIGIN || 'http://127.0.0.1:8765';
const out = process.env.YOUS_AO_QA_DIR || '/tmp/yousao-qa';
fs.mkdirSync(out, { recursive: true });
const base = { app: 'yousao', v: 2, ...Object.fromEntries(Data.COLS.map(c => [c, {}])) };
base.projects.p = { title: '測試角色專案', realm: 'night', status: 'doing', characterName: '測試角色', stage: 'profile', priority: 'high', note: '測試進度' };
base.projects.day = { title: '朝的私人工作', realm: 'day', status: 'todo' };
base.tasks.t = { title: '整理人設矛盾', realm: 'night', projectId: 'p', date: '2026-10-06', done: false, minutes: 45 };
base.moods.today = { note: '私人心情不可上傳' };
const workspace = Data.snapshot(base);
workspace.proposal = { id: 'integration-plan', author: 'GPT', summary: '安排角色開場', projects: [], tasks: [{ id: 'new-task', expected: null, record: { title: '撰寫初次相遇', realm: 'night', projectId: 'p', date: '2026-10-08', minutes: 30, done: false, stage: 'opening' } }] };
async function nav(page, view) {
  await page.getByRole('button', { name: '開啟選單', exact: true }).click();
  await page.locator('#nav button[data-view="' + view + '"]').click();
  await page.locator('#main').getByRole('heading', { name: { studio: '角色工作室', cloud: '雲端與經紀人' }[view], level: 2, exact: true }).waitFor();
  await page.locator('#drawer').evaluate(node => Promise.all(node.getAnimations().map(a => a.finished)));
}
async function screenshot(page, name) {
  await page.locator('#toast').waitFor({ state: 'hidden', timeout: 5000 });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out + '/' + name, fullPage: true, animations: 'disabled' });
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.YOUS_AO_CHROMIUM || chromium.executablePath() });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Taipei', acceptDownloads: true });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(data => {
      if (!localStorage.getItem('yousao.v1')) {
        localStorage.setItem('yousao.v1', JSON.stringify({ ...data, v: 1 }));
        localStorage.setItem('yousao.mode', 'night'); localStorage.setItem('yousao.view', 'studio');
      }
    }, base);
    await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'text/javascript', body: `window.google = { accounts: { oauth2: { initTokenClient: opts => ({ requestAccessToken: () => opts.callback({ access_token: 'TEST_IN_MEMORY_TOKEN', expires_in: 3600, scope: opts.scope }) }), hasGrantedAllScopes: (r,s) => r.scope.includes(s) } } };` }));
    await page.route('https://www.googleapis.com/**', async route => {
      const url = new URL(route.request().url()), meta = { id: 'test-file', name: '酌有韶-角色創作排程.json', mimeType: 'application/json', modifiedTime: '2026-10-05T12:00:00Z', webViewLink: 'https://drive.google.com/file/d/test-file/view' };
      let body;
      if (url.searchParams.has('q')) body = { files: [meta] };
      else if (url.searchParams.get('alt') === 'media') body = workspace;
      else body = meta;
      await route.fulfill({ contentType: 'application/json', headers: { ETag: '"test-version"' }, body: JSON.stringify(body) });
    });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: '角色工作室', level: 2, exact: true }).waitFor();
    await screenshot(page, 'studio-desktop.png');
    await page.getByRole('button', { name: '編輯角色專案' }).click();
    await page.locator('#p-character').fill('測試角色二');
    await page.locator('#p-stage').selectOption('opening');
    await page.locator('#sheet').getByRole('button', { name: '存下', exact: true }).click();
    await page.getByRole('heading', { name: '測試角色二', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('yousao.v1')).projects.p.stage), 'opening');
    await nav(page, 'cloud');
    await page.getByRole('heading', { name: '雲端與經紀人', level: 2, exact: true }).waitFor();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '匯出創作工作檔', exact: true }).click();
    const downloaded = await downloadPromise, downloadedPath = await downloaded.path();
    const exported = JSON.parse(fs.readFileSync(downloadedPath, 'utf8'));
    assert.deepEqual(Object.keys(exported.projects), ['p']); assert.equal(exported.moods, undefined);
    await page.getByRole('button', { name: '匯入經紀人提案', exact: true }).click();
    await page.getByRole('textbox', { name: '經紀人工作檔 JSON' }).fill(JSON.stringify(workspace));
    await page.getByRole('button', { name: '預覽提案', exact: true }).click();
    await page.getByRole('heading', { name: '經紀人提案預覽', exact: true }).waitFor();
    await page.getByRole('button', { name: '採用勾選的排程', exact: true }).click();
    assert.equal(await page.evaluate(() => Boolean(JSON.parse(localStorage.getItem('yousao.v1')).tasks['new-task'])), false);
    const backupPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '下載改動前備份', exact: true }).click(); await backupPromise;
    await page.getByRole('button', { name: '採用勾選的排程', exact: true }).click();
    await page.getByRole('heading', { name: '角色工作室', level: 2, exact: true }).waitFor();
    let state = await page.evaluate(() => JSON.parse(localStorage.getItem('yousao.v1')));
    assert.equal(state.tasks['new-task'].minutes, 30); assert.equal(state.moods.today.note, '私人心情不可上傳'); assert.equal(state.projects.day.title, '朝的私人工作');
    await nav(page, 'cloud'); await page.getByRole('button', { name: '連線設定', exact: true }).click();
    await page.locator('#google-client-id').fill('123-integration.apps.googleusercontent.com');
    await page.getByRole('button', { name: '存下設定', exact: true }).click();
    await page.getByRole('button', { name: '連線 Google', exact: true }).first().click();
    await page.locator('#cloud-file-manager').selectOption('test-file');
    await page.getByRole('button', { name: '下載／預覽提案', exact: true }).click();
    await page.getByRole('heading', { name: '經紀人提案預覽', exact: true }).waitFor();
    assert.equal(await page.locator('.manager-check input[value="tasks:new-task"]').isDisabled(), true);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('TEST_IN_MEMORY_TOKEN')), false);
    await page.setViewportSize({ width: 390, height: 844 });
    await screenshot(page, 'cloud-mobile.png');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await nav(page, 'studio');
    await screenshot(page, 'studio-mobile.png');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })); });
    await context.setOffline(true); await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '角色工作室', level: 2, exact: true }).waitFor();
    state = await page.evaluate(() => JSON.parse(localStorage.getItem('yousao.v1'))); assert.equal(state.tasks['new-task'].minutes, 30);
    assert.deepEqual(errors, []);
    console.log('PASS desktop/mobile forms, private-data export, proposal preview/apply, OAuth/Drive mock, idempotence, token privacy, layout and offline restart.');
    await context.close();
  } catch (e) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) await page.screenshot({ path: out + '/failure.png', fullPage: true }).catch(() => {});
    throw e;
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
