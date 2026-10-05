(function (root) {
  'use strict';
  root.YousaoManagerUI = {
    create(ctx) {
      const { Store, Drive, el, field, viewHead, sheetTitle, secTitle, taskRow, openSheet, closeSheet, openProjectSheet, go, toast, todayStr, parse, addDays, ymd, fmtShort } = ctx;
      const Data = root.YousaoManager;
      let files = { backup: [], manager: [] }, selected = { backup: '', manager: '' }, managerLink = '', busy = false, status = '';
      function button(text, fn, cls = 'btn') {
        const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b;
      }
      function downloadJSON(o, name) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(o, null, 2)], { type: 'application/json' }));
        const a = el('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
      function backupNow() { downloadJSON(Store.exportData(), 'yousao-before-sync-' + todayStr() + '.json'); }
      async function run(fn) {
        if (busy) return;
        busy = true;
        const node = document.querySelector('#cloud-status');
        if (node) node.textContent = '正在處理…';
        document.querySelectorAll('[data-cloud-action]').forEach(b => b.disabled = true);
        try { await fn(); }
        catch (e) { status = e.message || '操作失敗，資料未套用'; toast(status); }
        finally {
          busy = false;
          document.querySelectorAll('[data-cloud-action]').forEach(b => b.disabled = b.dataset.cloudLocked === '1');
          const n = document.querySelector('#cloud-status'); if (n) n.textContent = status;
        }
      }
      function cloudButton(text, fn, cls) { const b = button(text, () => run(fn), cls); b.dataset.cloudAction = ''; b.disabled = busy; return b; }
      function note(text) { return el('p', 'hint', text); }
      function budget() { try { return Number(localStorage.getItem('yousao.creativeBudget')) || 0; } catch (e) { return 0; } }
      function viewStudio(main) {
        main.appendChild(viewHead('角色工作室', '先把這週能完成的作品排好，再讓靈感自由散步。'));
        const now = todayStr(), end = ymd(addDays(parse(now), 6));
        const projects = Store.list('projects').filter(p => p.realm === 'night');
        const tasks = Store.list('tasks').filter(t => t.realm === 'night');
        const week = tasks.filter(t => !t.done && t.date && t.date >= now && t.date <= end);
        const minutes = week.reduce((n, t) => n + (t.minutes || 0), 0), limit = budget(), unestimated = week.filter(t => !t.minutes).length;
        const hero = el('section', 'manager-panel');
        hero.appendChild(secTitle('接下來七天'));
        hero.appendChild(el('p', 'manager-big', week.length + ' 件待辦 · 已估 ' + minutes + ' 分鐘'));
        if (unestimated) hero.appendChild(note('另有 ' + unestimated + ' 件尚未估時；總量可能更高。'));
        if (limit) hero.appendChild(note(minutes > limit ? '比你設定的 ' + limit + ' 分鐘多 ' + (minutes - limit) + ' 分鐘，可把次要工作移到下週。' : '時間預算 ' + limit + ' 分鐘，已排 ' + Math.round(minutes / limit * 100) + '%。'));
        const input = el('input'); input.type = 'number'; input.min = '15'; input.max = '10080'; input.step = '15'; input.placeholder = '例如 240'; input.value = limit || '';
        const form = el('form', 'qadd'); form.append(field('七天創作時間預算（分鐘）', input, 'creative-budget'), button('存下', () => {})); form.lastChild.type = 'submit';
        form.addEventListener('submit', e => {
          e.preventDefault(); if (!form.reportValidity()) return;
          try { localStorage.setItem('yousao.creativeBudget', input.value || '0'); go('studio'); } catch (e) { toast('無法保存時間預算'); }
        });
        hero.appendChild(form); main.appendChild(hero);
        const actions = el('div', 'bar');
        actions.append(button('＋ 新增角色專案', () => openProjectSheet(null, true), 'btn primary'), button('交給經紀人排程', () => go('cloud'), 'btn soft'));
        main.appendChild(actions);
        const overdue = tasks.filter(t => !t.done && t.date && t.date < now);
        if (overdue.length) main.appendChild(note('有 ' + overdue.length + ' 件已過期；先確認是否仍要做，再重新排日期。'));
        const grid = el('section', 'grid');
        projects.sort((a, b) => ({ high: 0, normal: 1, low: 2 }[a.priority || 'normal'] - { high: 0, normal: 1, low: 2 }[b.priority || 'normal'])).forEach(p => {
          const card = el('article', 'pcard'), ts = tasks.filter(t => t.projectId === p.id);
          card.append(el('h3', null, p.characterName || p.title), note(p.characterName ? p.title : '尚未填寫角色名稱'));
          card.appendChild(el('span', 'tag', Data.STAGES[p.stage] || '尚未設定製作階段'));
          card.appendChild(note('完成 ' + ts.filter(t => t.done).length + '／' + ts.length + ' · ' + ({ high: '優先推進', normal: '一般優先度', low: '先收著' }[p.priority || 'normal'])));
          if (p.note) card.appendChild(el('p', null, p.note));
          const next = ts.filter(t => !t.done).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))[0];
          if (next) card.appendChild(note('下一步：' + next.title + (next.date ? '（' + fmtShort(next.date) + '）' : '（未排日期）')));
          card.appendChild(button('編輯角色專案', () => openProjectSheet(p.id), 'link-btn')); grid.appendChild(card);
        });
        if (projects.length) main.appendChild(grid);
        else main.appendChild(note('先新增一位這週想推進的角色，或從經紀人提案匯入草案。'));
        main.appendChild(secTitle('本週創作待辦'));
        if (week.length) { const box = el('div', 'card-box'); week.sort((a, b) => a.date.localeCompare(b.date)).forEach(t => box.appendChild(taskRow(t, { showDate: true, showNote: true }))); main.appendChild(box); }
        else main.appendChild(note('本週尚未安排創作待辦。'));
      }
      function openSettings() {
        const wrap = el('form', 'form'), config = Drive.config();
        wrap.append(sheetTitle('Google 連線設定'), note('初次設定完成後，直接按連線即可。這些是網站識別資料；請勿填入 Client Secret 或存取權杖。'));
        const client = el('input'); client.value = config.clientId; client.placeholder = '…apps.googleusercontent.com'; client.autocomplete = 'off';
        wrap.appendChild(field('OAuth 用戶端 ID', client, 'google-client-id'));
        const details = el('details'); details.appendChild(el('summary', null, '選取既有工作檔的設定（選填）'));
        const key = el('input'); key.value = config.pickerApiKey; key.autocomplete = 'off';
        const number = el('input'); number.value = config.projectNumber; number.inputMode = 'numeric';
        details.append(field('限制來源的 Picker API 金鑰', key, 'google-picker-key'), field('Google Cloud 專案編號', number, 'google-project-number')); wrap.appendChild(details);
        const setup = el('details'); setup.appendChild(el('summary', null, '初次設定步驟'));
        const steps = el('ol');
        ['在 Google Cloud 建立專案，啟用 Google Drive API。', 'Google Auth Platform：建立應用程式，設定個人使用的同意畫面；測試模式加入你的 Google 帳號。', '建立「網頁應用程式」OAuth 用戶端；授權 JavaScript 來源填 ' + location.origin + '（不含 /yousao 路徑）。', '私人備份使用 drive.appdata；創作工作檔使用 drive.file。貼上用戶端 ID 後存下。', '若要選取 GPT 已建立的工作檔：同專案啟用 Google Picker API，建立 API 金鑰、限制為 Google Picker API 與本網站來源，並填入金鑰和專案編號。'].forEach(t => steps.appendChild(el('li', null, t)));
        setup.appendChild(steps); const link = el('a', null, '開啟 Google Cloud'); link.href = 'https://console.cloud.google.com/apis/credentials'; link.target = '_blank'; link.rel = 'noopener noreferrer'; setup.appendChild(link); wrap.appendChild(setup);
        const actions = el('div', 'actions'); actions.append(button('取消', closeSheet)); const save = el('button', 'btn primary', '存下設定'); save.type = 'submit'; actions.appendChild(save); wrap.appendChild(actions);
        wrap.addEventListener('submit', e => {
          e.preventDefault(); try { Drive.configure({ clientId: client.value.trim(), pickerApiKey: key.value.trim(), projectNumber: number.value.trim() }); files = { backup: [], manager: [] }; selected = { backup: '', manager: '' }; managerLink = ''; closeSheet(); go('cloud'); toast('已存下連線設定'); } catch (e) { toast(e.message); }
        }); openSheet(wrap, { kind: 'form' }, '#google-client-id');
      }
      function safeLink(url) {
        try { const u = new URL(url); return u.protocol === 'https:' && ['drive.google.com', 'docs.google.com'].includes(u.hostname) ? u.href : ''; } catch (e) { return ''; }
      }
      function rememberLink(meta) { managerLink = safeLink(meta.webViewLink || ''); }
      async function refresh(kind) {
        files[kind] = await Drive.list(kind);
        if (files[kind].length === 1) selected[kind] = files[kind][0].id;
        else if (!files[kind].some(f => f.id === selected[kind])) selected[kind] = '';
        status = files[kind].length ? '已找到 ' + files[kind].length + ' 份檔案；多份檔案請自行選取。' : '尚未找到工作檔；可以建立，或選取既有工作檔。';
        go('cloud');
      }
      function openUploadPreview(kind, existing, version) {
        const before = Store.exportData(), outgoing = kind === 'backup' ? before : Store.managerSnapshot();
        const unresolved = kind === 'manager' && version?.proposal && Store.previewManager(version).items.some(x => x.state !== 'same');
        const wrap = el('div', 'form');
        wrap.appendChild(sheetTitle(kind === 'backup' ? '上傳私人備份' : '上傳創作進度'));
        if (kind === 'backup') wrap.appendChild(note('包含六個集合、朝暮事務與心情紀錄；會存到只有本 App 可讀的私人區域。'));
        else wrap.appendChild(note('僅上傳暮的專案與待辦。現有提案會在你採用後，用目前進度重新建立。'));
        wrap.appendChild(note('本機：' + Object.keys(outgoing.projects).length + ' 個專案／' + Object.keys(outgoing.tasks).length + ' 件待辦。'));
        if (existing) {
          wrap.appendChild(note('將更新「' + existing.name + '」，雲端時間：' + existing.modifiedTime));
          if (unresolved) { wrap.appendChild(note('這份雲端工作檔仍有未採用提案；請先預覽。若只要保留本機進度，可建立一份新檔。')); }
        } else wrap.appendChild(note('將建立一份新檔；現有雲端檔案會保留。'));
        const backedUp = el('input'); backedUp.type = 'checkbox';
        const check = el('label', 'manager-check'); check.append(backedUp, document.createTextNode('我已下載改動前的 JSON 備份'));
        wrap.append(button('先下載本機備份', () => { backupNow(); backedUp.checked = true; }), check);
        const actions = el('div', 'actions'); actions.append(button('取消', closeSheet));
        const push = cloudButton('確認上傳', async () => {
          if (!backedUp.checked) throw new Error('請先下載本機備份');
          if (unresolved) throw new Error('請先預覽與採用雲端提案，或建立新檔保留原提案');
          if (!Data.equal(Store.exportData().projects, before.projects) || !Data.equal(Store.exportData().tasks, before.tasks) || (kind === 'backup' && Data.COLS.some(c => !Data.equal(Store.exportData()[c], before[c])))) throw new Error('預覽後本機已變更，請重新開啟上傳');
          const result = await Store.pushRemote(Drive, kind, { id: existing?.id || null, expectedModifiedTime: existing?.modifiedTime || null });
          selected[kind] = result.meta.id; if (kind === 'manager') rememberLink(result.meta);
          closeSheet(); status = '已上傳。'; await refresh(kind); toast('已上傳');
        }, 'btn primary');
        if (unresolved) { push.disabled = true; push.dataset.cloudLocked = '1'; }
        actions.appendChild(push); wrap.appendChild(actions); openSheet(wrap, { kind: 'form' });
      }
      async function prepareUpload(kind, fresh = false) {
        if (fresh) { openUploadPreview(kind, null); return; }
        const id = selected[kind]; if (!id) throw new Error('請選取工作檔，或按「建立新檔」');
        const result = await Store.pullRemote(Drive, kind, id);
        openUploadPreview(kind, result.meta, result.data);
      }
      function openBackupPreview(result) {
        const incoming = result.data, before = Store.exportData();
        const wrap = el('div', 'form'); wrap.append(sheetTitle('下載備份預覽'), note('確認後會以這份備份取代本機六個集合。朝暮事務與心情紀錄都會改動，請先保存本機備份。'));
        Data.COLS.forEach(c => wrap.appendChild(note(({ projects: '專案', tasks: '待辦', habits: '習慣', checks: '打卡', moods: '心情', inbox: '靈感' }[c]) + '：本機 ' + Object.keys(before[c]).length + ' → 雲端 ' + Object.keys(incoming[c]).length)));
        const downloaded = el('input'); downloaded.type = 'checkbox'; const check = el('label', 'manager-check'); check.append(downloaded, document.createTextNode('我已保存本機備份，確認取代全部資料'));
        wrap.append(button('下載改動前備份', () => { backupNow(); downloaded.checked = true; }), check);
        const actions = el('div', 'actions'); actions.append(button('取消', closeSheet), button('確認取代本機資料', () => {
          try {
            if (!downloaded.checked) throw new Error('請先保存本機備份並確認取代');
            if (Data.COLS.some(c => !Data.equal(Store.exportData()[c], before[c]))) throw new Error('預覽後本機資料已變更，請重新下載');
            Store.replaceData(incoming); closeSheet(); toast('已還原；改動前的復原點也已保留');
          } catch (e) { toast(e.message); }
        }, 'btn primary')); wrap.appendChild(actions); openSheet(wrap, { kind: 'form' });
      }
      const LABELS = { title: '名稱', characterName: '角色', date: '日期', start: '開始', due: '截止', stage: '階段', priority: '優先度', minutes: '預估分鐘', weeklyMinutes: '每週目標分鐘', note: '備註', status: '狀態', done: '完成', star: '重要', projectId: '所屬專案' };
      function display(k, v, data) {
        if (k === 'stage') return Data.STAGES[v] || '未設定';
        if (k === 'projectId') return data.projects[v]?.title || v || '未指定';
        if (k === 'done' || k === 'star') return v ? '是' : '否';
        return v === undefined || v === '' ? '未設定' : String(v);
      }
      function openManagerPreview(input) {
        let preview; try { preview = Store.previewManager(input); } catch (e) { toast(e.message); return; }
        const wrap = el('div', 'form'); wrap.append(sheetTitle('經紀人提案預覽'), note(preview.proposal.author + '：' + preview.proposal.summary));
        const checks = [], current = Store.managerSnapshot();
        preview.items.forEach(x => {
          const card = el('article', 'manager-change');
          const label = el('label', 'manager-check'), check = el('input'); check.type = 'checkbox'; check.value = x.key; check.checked = ['new', 'change'].includes(x.state); check.disabled = ['same', 'conflict'].includes(x.state);
          const state = { new: '新增', change: '更新', same: '已一致', conflict: '有衝突' }[x.state];
          label.append(check, document.createTextNode(state + ' · ' + x.after.title)); card.appendChild(label); checks.push(check);
          if (x.reason) card.appendChild(note(x.reason));
          const changes = Object.entries(LABELS).filter(([k]) => !Data.equal(x.before?.[k], x.after[k]));
          changes.forEach(([k, text]) => card.appendChild(note(text + '：' + display(k, x.before?.[k], current) + ' → ' + display(k, x.after[k], { projects: { ...current.projects, ...Object.fromEntries(preview.items.filter(p => p.col === 'projects').map(p => [p.id, p.after])) } }))));
          wrap.appendChild(card);
        });
        if (!preview.items.length) wrap.appendChild(note('提案沒有任何排程項目。'));
        const consent = el('input'); consent.type = 'checkbox'; const lab = el('label', 'manager-check'); lab.append(consent, document.createTextNode('已保存備份，採用上方勾選的改動'));
        wrap.append(button('下載改動前備份', () => { backupNow(); consent.checked = true; }), lab);
        const act = el('div', 'actions'); act.append(button('取消', closeSheet), button('採用勾選的排程', () => {
          try { if (!consent.checked) throw new Error('請先下載本機備份'); const n = Store.applyManager(input, checks.filter(c => c.checked && !c.disabled).map(c => c.value), preview); closeSheet(); go('studio'); toast('已採用 ' + n + ' 筆，記得上傳創作進度'); } catch (e) { toast(e.message); }
        }, 'btn primary')); wrap.appendChild(act); openSheet(wrap, { kind: 'form' });
      }
      function openImport() {
        const wrap = el('div', 'form'); wrap.append(sheetTitle('匯入經紀人工作檔'), note('可以選取下載的 JSON，或貼上 GPT／晏提供的完整工作檔。這一步只開啟預覽。'));
        const input = el('textarea', 'backup-box'); input.setAttribute('aria-label', '經紀人工作檔 JSON'); input.placeholder = '貼上 yousao.manager 工作檔';
        const file = el('input'); file.type = 'file'; file.accept = '.json,application/json';
        file.addEventListener('change', async () => { try { if (file.files[0].size > 5 * 1024 * 1024) throw new Error('工作檔超過 5 MB'); input.value = await file.files[0].text(); } catch (e) { toast(e.message); } });
        wrap.append(field('選取 JSON 檔案', file, 'manager-import-file'), input);
        const act = el('div', 'actions'); act.append(button('取消', closeSheet), button('預覽提案', () => { try { openManagerPreview(JSON.parse(input.value)); } catch (e) { toast('請提供完整、有效的 JSON 工作檔'); } }, 'btn primary')); wrap.appendChild(act); openSheet(wrap, { kind: 'form' });
      }
      function handoff() {
        const wrap = el('div', 'form'); wrap.appendChild(sheetTitle('交給 GPT／晏'));
        const text = '請當我的角色創作經紀人，先讀取最新的酌有韶工作檔，根據進度與我本週可用時間安排。\n' + (managerLink ? '工作檔：' + managerLink + '\n' : '請搜尋 Google Drive 的「酌有韶-角色創作排程.json」，或讀取我附上的 JSON。\n') + '時間預算：' + (budget() ? budget() + ' 分鐘／七天' : '尚未設定，請先確認') + '\n讀取 projects / tasks 原始紀錄，保留其 ID。輸出 app=yousao.manager、v=1 的工作檔，只修改 proposal。proposal 要含 id、author、summary、projects[]、tasks[]；每項為 {id, expected, record}。新增的 expected=null；更新的 expected 必須是剛讀到的完整原始紀錄，record 填新值與必要的 title、realm=night。階段可用 concept/profile/opening/visual/test/release；日期 YYYY-MM-DD；minutes 為整數。保留原 projects/tasks、未知欄位與未涉及的提案，勿取消已完成待辦。更新雲端前再次檢查原檔並保留備份。有寫入工具就更新同一私有檔案，只有讀取工具則回傳完整 JSON 讓我匯入。不要把創作資料、個人資料或權杖寫進公開 GitHub。排程只是提案，由我在 App 預覽採用。';
        const box = el('textarea', 'backup-box'); box.readOnly = true; box.value = text; box.setAttribute('aria-label', '經紀人交接文字'); wrap.appendChild(box);
        wrap.append(button('複製交接文字', async () => { try { await navigator.clipboard.writeText(text); toast('已複製'); } catch (e) { box.focus(); box.select(); toast('請選取後複製'); } }), button('關閉', closeSheet)); openSheet(wrap, { kind: 'form' });
      }
      function viewCloud(main) {
        main.appendChild(viewHead('雲端與經紀人', '手動上傳進度，讓 GPT 與晏接手安排；提案由你決定何時採用。'));
        const settings = el('section', 'manager-panel'); settings.append(secTitle('Google 連線'), note(Drive.config().clientId ? '網站識別已設定。Google 授權會在按連線時開啟。' : '你的 AI 可使用已連線的 Google Drive；這個獨立網站仍需完成一次 Google 網站授權設定。'), button('連線設定', openSettings, 'btn soft'));
        main.appendChild(settings);
        const stat = el('p', 'hint', status); stat.id = 'cloud-status'; stat.setAttribute('role', 'status'); main.appendChild(stat);
        ['manager', 'backup'].forEach(kind => {
          const panel = el('section', 'manager-panel');
          panel.append(secTitle(kind === 'manager' ? '創作工作檔 · 經紀人共用' : '私人備份 · 全部資料'), note(kind === 'manager' ? '只包含暮的專案與待辦，不帶出朝的事務、習慣或心情。檔案仍是私有，GPT／晏需連線同一 Google 帳號才能讀取。' : '六個集合完整保存到隱藏區；經紀人無法讀取。'));
          const row = el('div', 'actions');
          row.append(cloudButton(Drive.isConnected(kind) ? '重新連線／換帳號' : '連線 Google', async () => { await Drive.connect(kind); files = { manager: [], backup: [] }; selected = { manager: '', backup: '' }; managerLink = ''; await refresh(kind); }, 'btn soft'));
          row.append(cloudButton('讀取檔案清單', () => refresh(kind)));
          if (kind === 'manager') row.append(cloudButton('選取雲端工作檔', async () => { const id = await Drive.pickManager(); const result = await Store.pullRemote(Drive, kind, id); if (!files.manager.some(f => f.id === id)) files.manager.push(result.meta); selected.manager = id; rememberLink(result.meta); status = '已選取工作檔。'; go('cloud'); }));
          panel.appendChild(row);
          const sel = el('select'), none = el('option', null, '請選取工作檔'); none.value = ''; sel.appendChild(none);
          files[kind].forEach(f => { const o = el('option', null, f.name + ' · ' + (f.modifiedTime || '')); o.value = f.id; sel.appendChild(o); }); sel.value = selected[kind];
          sel.addEventListener('change', () => { selected[kind] = sel.value; if (kind === 'manager') { managerLink = ''; const f = files.manager.find(f => f.id === sel.value); if (f) rememberLink(f); } });
          panel.appendChild(field('雲端檔案', sel, 'cloud-file-' + kind));
          const ops = el('div', 'actions'); ops.append(cloudButton('建立新檔', () => prepareUpload(kind, true)), cloudButton(kind === 'manager' ? '上傳創作進度' : '上傳完整備份', () => prepareUpload(kind), 'btn primary'), cloudButton(kind === 'manager' ? '下載／預覽提案' : '下載／預覽備份', async () => {
            if (!selected[kind]) throw new Error('請先選取工作檔');
            const result = await Store.pullRemote(Drive, kind, selected[kind]);
            if (kind === 'manager') { rememberLink(result.meta); openManagerPreview(result.data); } else openBackupPreview(result);
          })); panel.appendChild(ops); main.appendChild(panel);
        });
        const tools = el('section', 'manager-panel'); tools.append(secTitle('不等授權，也能開始排程'), note('先把工作檔交給我們；下載或貼回提案後，就能在 App 預覽採用。'));
        const row = el('div', 'actions'); row.append(button('匯出創作工作檔', () => downloadJSON(Store.managerSnapshot(), Drive.names.manager)), button('匯入經紀人提案', openImport, 'btn primary'), button('複製經紀人交接', handoff)); tools.appendChild(row);
        const restore = button('還原上次改動前的復原點', () => { try { const data = Store.recoveryData(); if (!data) throw new Error('尚無復原點'); openBackupPreview({ data }); } catch (e) { toast(e.message); } }); tools.appendChild(restore); main.appendChild(tools);
        Drive.prepare().catch(e => { status = e.message; const n = document.querySelector('#cloud-status'); if (n) n.textContent = status; });
      }
      return { viewStudio, viewCloud, openManagerPreview, openImport, backupNow };
    }
  };
})(globalThis);
