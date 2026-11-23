'use strict';
/* 保存（localStorage、キーは juku_ で始める）・記録・集計 */

const KEYS = {
  questions: 'juku_questions',   // id → 問題
  progress: 'juku_progress',     // id → {n:回答回数, c:正解回数, last:最後の結果, box, due, s/f/l}
  log: 'juku_log',               // 日付 → 科目 → {n, c}
  sessions: 'juku_sessions',     // 選び方 → 前回の {n, c}
  select: 'juku_select',         // 前回の選び方
  settings: 'juku_settings',
};

function load(key, def) {
  try {
    const s = localStorage.getItem(key);
    if (s == null) return def;
    const v = JSON.parse(s);
    return v == null ? def : v;
  } catch (e) { return def; }
}
function store(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
}
function unstore(key) {
  try { localStorage.removeItem(key); } catch (e) { /* 何もしない */ }
}

/* ----- 読みこんだ記録を、安全な形にそろえる（バックアップの復元でも使う） ----- */
const int0 = v => Math.max(0, Math.floor(Number(v) || 0));
function cleanProgress(src) {
  const out = {};
  for (const id of Object.keys(asObj(src))) {
    const p = src[id];
    if (!isObj(p)) continue;
    const n = int0(p.n), e = { n, c: Math.min(n, int0(p.c)), box: Math.min(5, int0(p.box)) };
    if (typeof p.last === 'boolean') e.last = p.last;
    if (typeof p.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.due)) e.due = p.due;
    if (Number.isFinite(p.at)) e.at = p.at;
    for (const k of ['s', 'f', 'l']) if (typeof p[k] === 'string') e[k] = p[k];
    out[id] = e;
  }
  return out;
}
function cleanLog(src) {
  const out = {};
  for (const d of Object.keys(asObj(src))) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !isObj(src[d])) continue;
    out[d] = {};
    for (const s of Object.keys(src[d])) {
      const e = src[d][s];
      if (isObj(e)) { const n = int0(e.n); out[d][s] = { n, c: Math.min(n, int0(e.c)) }; }
    }
  }
  return out;
}
function cleanRuns(src) {
  const out = {};
  for (const k of Object.keys(asObj(src))) {
    const e = src[k];
    if (isObj(e) && int0(e.n) > 0) out[k] = { n: int0(e.n), c: Math.min(int0(e.n), int0(e.c)), at: Number(e.at) || 0 };
  }
  return out;
}

/* ----- 状態 ----- */
let questions = asObj(load(KEYS.questions, {}));
for (const id of Object.keys(questions)) {
  const q = questions[id];
  const okQ = isObj(q) && q.id === id && TYPES.includes(q.type) && typeof q.question === 'string' &&
    typeof q.subject === 'string' && typeof q.field === 'string' && typeof q.lesson === 'string' &&
    (q.type !== 'choice' || (Array.isArray(q.choices) && Number.isInteger(q.answer)));
  if (!okQ) delete questions[id];
}
let progress = cleanProgress(load(KEYS.progress, {}));
let dlog = cleanLog(load(KEYS.log, {}));
let lastRuns = cleanRuns(load(KEYS.sessions, {}));
const settings = Object.assign({ furigana: true, size: 'normal', sound: false }, asObj(load(KEYS.settings, {})));
const sel = Object.assign({ subject: null, fields: null, lessons: null, mode: 'all', count: '10', order: 'random' },
  asObj(load(KEYS.select, {})));

function saveSettings() { store(KEYS.settings, settings); }
function saveSel() { store(KEYS.select, sel); }
function saveQuestions() { return store(KEYS.questions, questions); }
function saveRecords() {
  const a = store(KEYS.progress, progress), b = store(KEYS.log, dlog), c = store(KEYS.sessions, lastRuns);
  if (!(a && b && c)) toast('記録を保存できませんでした（保存する場所がいっぱいかもしれません）');
}

/* ----- 回答の記録（ライトナー方式の箱も更新） ----- */
function record(q, ok) {
  const t = today();
  const p = progress[q.id] || { n: 0, c: 0, box: 0 };
  p.n += 1;
  if (ok) p.c += 1;
  p.last = ok;
  p.at = Date.now();
  p.box = ok ? Math.min(5, p.box + 1) : 1;           // 正解で1つ上、不正解で箱1
  p.due = addDays(t, INTERVALS[p.box - 1]);
  p.s = q.subject; p.f = q.field; p.l = q.lesson;    // 問題を消しても、集計できるように
  progress[q.id] = p;
  const d = dlog[t] || (dlog[t] = {});
  const e = d[q.subject] || (d[q.subject] = { n: 0, c: 0 });
  e.n += 1;
  if (ok) e.c += 1;
  saveRecords();
}
function isDue(q) {
  const p = progress[q.id];
  return !!(p && p.n > 0 && p.due && p.due <= today());
}

/* ----- 集計 ----- */
function metaOf(id) {
  const q = questions[id];
  if (q) return { s: q.subject, f: q.field, l: q.lesson };
  const p = progress[id] || {};
  return { s: p.s, f: p.f, l: p.l };
}
// keyFn ごとに {n, c} を合計した Map を返す
function aggregate(keyFn, filter) {
  const m = new Map();
  for (const id of Object.keys(progress)) {
    const p = progress[id];
    if (!(p.n > 0)) continue;
    const mt = metaOf(id);
    if (mt.s == null) continue;
    if (filter && !filter(mt)) continue;
    const k = keyFn(mt);
    const a = m.get(k) || { n: 0, c: 0 };
    a.n += p.n; a.c += p.c;
    m.set(k, a);
  }
  return m;
}
function dayStat(date, subj) {
  const d = dlog[date], r = { n: 0, c: 0 };
  if (!d) return r;
  for (const s of Object.keys(d)) {
    if (subj && s !== subj) continue;
    r.n += d[s].n; r.c += d[s].c;
  }
  return r;
}
function rangeStat(days, subj) {
  const t = today(), r = { n: 0, c: 0 };
  for (let i = 0; i < days; i++) { const s = dayStat(addDays(t, -i), subj); r.n += s.n; r.c += s.c; }
  return r;
}
// 連続して学習した日数（今日まだなら、昨日までの連続でOK）
function streak(subj) {
  let d = today(), k = 0;
  if (dayStat(d, subj).n === 0) d = addDays(d, -1);
  while (dayStat(d, subj).n > 0 && k < 3650) { k++; d = addDays(d, -1); }
  return k;
}
