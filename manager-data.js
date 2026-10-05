/* Shared data contract for the PWA and human/AI creative managers. No credentials. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.YousaoManager = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const COLS = ['projects', 'tasks', 'habits', 'checks', 'moods', 'inbox'];
  const STAGES = { concept: '概念與定位', profile: '人設定稿', opening: '開場與劇情', visual: '立繪與生圖', test: '互動測試', release: '發布與整理' };
  const plain = o => !!o && typeof o === 'object' && !Array.isArray(o) && (Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null);
  const clone = o => JSON.parse(JSON.stringify(o));
  const strip = r => { const { id, ...rest } = r; return clone(rest); };
  const validId = s => typeof s === 'string' && s.length > 0 && s.length <= 128 && !['__proto__', 'constructor', 'prototype'].includes(s);
  const canonical = o => JSON.stringify(sort(o));
  function sort(o) {
    if (Array.isArray(o)) return o.map(sort);
    if (!plain(o)) return o;
    return Object.fromEntries(Object.keys(o).sort().map(k => [k, sort(o[k])]));
  }
  const equal = (a, b) => canonical(a) === canonical(b);
  function validDate(s) {
    if (s === '') return true;
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + 'T12:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  function assert(ok, message) { if (!ok) throw new Error(message); }
  function validateBackup(o) {
    assert(plain(o) && (!o.app || o.app === 'yousao') && [1, 2].includes(o.v), '不是酌有韶的完整備份');
    COLS.forEach(c => {
      assert(plain(o[c]), '備份缺少集合：' + c);
      Object.entries(o[c]).forEach(([id, r]) => {
        assert(validId(id) && plain(r), '備份紀錄格式不正確');
        if (r.realm != null) assert(['day', 'night', 'both'].includes(r.realm), '領域代號不正確');
        if (['projects', 'tasks', 'habits'].includes(c)) assert(typeof r.title === 'string', '缺少項目名稱');
      });
    });
    return clone(o);
  }
  function snapshot(data) {
    const projects = Object.fromEntries(Object.entries(data.projects || {}).filter(([, p]) => p.realm === 'night'));
    const tasks = Object.fromEntries(Object.entries(data.tasks || {}).filter(([, t]) => t.realm === 'night' && (!t.projectId || projects[t.projectId])));
    return { app: 'yousao.manager', v: 1, exportedAt: new Date().toISOString(), projects: clone(projects), tasks: clone(tasks), proposal: null };
  }
  const FIELDS = {
    projects: ['title', 'realm', 'status', 'characterName', 'stage', 'priority', 'weeklyMinutes', 'note', 'start', 'due', 'createdAt', 'updatedAt'],
    tasks: ['title', 'realm', 'projectId', 'stage', 'minutes', 'note', 'date', 'done', 'star', 'doneAt', 'createdAt']
  };
  function validateRecord(c, r) {
    assert(plain(r) && r.realm === 'night', '提案只能修改暮的創作項目');
    assert(typeof r.title === 'string' && r.title.trim().length > 0 && r.title.length <= (c === 'projects' ? 80 : 120), '項目名稱太長或空白');
    Object.keys(r).forEach(k => assert(FIELDS[c].includes(k), '提案包含不支援的欄位：' + k));
    ['start', 'due', 'date'].forEach(k => { if (r[k] != null) assert(validDate(r[k]), '日期格式不正確：' + k); });
    if (r.start && r.due) assert(r.start <= r.due, '截止日不能早於開始日');
    if (r.stage != null && r.stage !== '') assert(Object.hasOwn(STAGES, r.stage), '未知的製作階段');
    if (r.status != null) assert(['doing', 'todo', 'paused', 'chore', 'new'].includes(r.status), '未知的專案狀態');
    if (r.priority != null) assert(['high', 'normal', 'low'].includes(r.priority), '優先度不正確');
    ['minutes', 'weeklyMinutes'].forEach(k => { if (r[k] != null) assert(Number.isInteger(r[k]) && r[k] >= 0 && r[k] <= 10080, '時間估算不正確'); });
    ['createdAt', 'doneAt'].forEach(k => { if (r[k] != null) assert(Number.isFinite(r[k]) && r[k] >= 0, '時間戳記不正確'); });
    ['done', 'star'].forEach(k => { if (r[k] != null) assert(typeof r[k] === 'boolean', '完成與重要標記必須是布林值'); });
    if (r.characterName != null) assert(typeof r.characterName === 'string' && r.characterName.length <= 80, '角色名稱不正確');
    if (r.note != null) assert(typeof r.note === 'string' && r.note.length <= 2000, '備註太長');
    if (r.projectId != null && r.projectId !== '') assert(validId(r.projectId), '專案編號不正確');
  }
  function validateWorkspace(o) {
    assert(plain(o) && o.app === 'yousao.manager' && o.v === 1, '不是經紀人工作檔（yousao.manager v1）');
    ['projects', 'tasks'].forEach(c => {
      assert(plain(o[c]), '工作檔缺少創作資料');
      Object.entries(o[c]).forEach(([id, r]) => assert(validId(id) && plain(r) && r.realm === 'night', '工作檔只能包含暮的創作資料'));
    });
    if (o.proposal == null) return clone(o);
    const p = o.proposal;
    assert(plain(p) && validId(p.id) && typeof p.author === 'string' && p.author.length <= 80 && typeof p.summary === 'string' && p.summary.length <= 2000, '提案資訊不完整');
    ['projects', 'tasks'].forEach(c => {
      assert(Array.isArray(p[c]) && p[c].length <= 500, '提案項目格式不正確或超過 500 筆');
      const seen = new Set();
      p[c].forEach(x => {
        assert(plain(x) && validId(x.id) && !seen.has(x.id), '提案編號重複或不正確'); seen.add(x.id);
        assert(x.expected === null || plain(x.expected), '提案需附 expected 原始紀錄；新增請填 null');
        validateRecord(c, x.record);
      });
    });
    return clone(o);
  }
  function preview(data, input) {
    const workspace = validateWorkspace(input), p = workspace.proposal;
    assert(p, '工作檔目前沒有提案；請先請 GPT 或晏安排');
    const items = [];
    ['projects', 'tasks'].forEach(c => p[c].forEach(x => {
      const before = data[c]?.[x.id] || null;
      const after = { ...(before || {}), ...x.record };
      let state = before ? 'change' : 'new', reason = '';
      if (before && equal(before, after)) state = 'same';
      else if ((before && before.realm !== 'night') || !equal(before, x.expected)) { state = 'conflict'; reason = '本機資料已變更，需重新讀取後排程'; }
      else if (c === 'tasks' && before?.done && x.record.done === false) { state = 'conflict'; reason = '已完成的待辦不能由提案改回未完成'; }
      items.push({ key: c + ':' + x.id, col: c, id: x.id, before, after, state, reason });
    }));
    items.filter(x => x.col === 'tasks' && x.after.projectId && x.state !== 'conflict').forEach(x => {
      const id = x.after.projectId;
      const incoming = items.find(p => p.col === 'projects' && p.id === id);
      const project = incoming && incoming.state !== 'conflict' ? incoming.after : data.projects?.[id];
      if (!project || project.realm !== 'night') { x.state = 'conflict'; x.reason = '所屬創作專案不存在或不能採用'; }
    });
    return { workspace, proposal: p, items };
  }
  return { COLS, STAGES, clone, strip, equal, validDate, validateBackup, validateWorkspace, snapshot, preview };
});
