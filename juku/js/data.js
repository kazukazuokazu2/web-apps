'use strict';
/* 画面3：データ（問題ファイルの読みこみ・削除・記録のバックアップ） */

let importMsgs = [];   // {ok, title, lines}
const BACKUP_APP = 'juku-test-taisaku';

function readText(file) {
  if (file.text) return file.text();
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsText(file);
  });
}
// JSON のまちがいの場所を「〇行目」で伝える
function whereInJson(err, text) {
  const msg = String(err && err.message);
  let m = msg.match(/line (\d+)/i);
  if (m) return `（${m[1]}行目のあたり）`;
  m = msg.match(/position (\d+)/i);
  if (m) return `（${text.slice(0, Number(m[1])).split('\n').length}行目のあたり）`;
  return '';
}

// 形式をチェックする。まちがいがあれば errors に、やさしい言葉で入れる
function validateQuestions(text) {
  let data;
  try { data = JSON.parse(text.replace(/^﻿/, '')); } catch (e) {
    return { errors: ['ファイルの書き方にまちがいがあって、読みこめませんでした' + whereInJson(e, text) +
      '。カッコ { } [ ] や「,」（カンマ）、「"」の数や位置を、たしかめてください。'] };
  }
  if (!isObj(data)) return { errors: ['ファイルの中身が、問題データの形になっていません。いちばん外側を { "meta": …, "questions": [ … ] } の形にしてください。'] };
  if (!Array.isArray(data.questions)) return { errors: ['「questions」（問題のならび）が見つかりません。"questions": [ … ] を入れてください。'] };
  if (!data.questions.length) return { errors: ['問題が1問も入っていません。'] };
  const errors = [], seen = new Map(), out = [];
  const str = v => typeof v === 'string' && v.trim() !== '';
  const NAMES = { id: 'id（問題の番号）', subject: 'subject（科目）', field: 'field（分野）', lesson: 'lesson（回）', question: 'question（問題文）' };
  data.questions.forEach((q, i) => {
    const where = `${i + 1}問目` + (isObj(q) && str(q.id) ? `（id: ${q.id}）` : '');
    const err = m => errors.push(`${where}：${m}`);
    if (!isObj(q)) { err('問題の形（{ … }）になっていません。'); return; }
    for (const k of Object.keys(NAMES)) if (!str(q[k])) err(`「${NAMES[k]}」がないか、空っぽです。`);
    if (str(q.id)) {
      const id = q.id.trim();
      if (seen.has(id)) err(`id が ${seen.get(id)}問目と同じです。1つのファイルの中では、ちがう id にしてください。`);
      else seen.set(id, i + 1);
    }
    if (!TYPES.includes(q.type)) { err(`「type」（問題の形式）は choice・tf・fill・card のどれかにしてください（いまは「${String(q.type)}」）。`); return; }
    if (q.type === 'choice') {
      if (!Array.isArray(q.choices) || q.choices.length < 2 || !q.choices.every(str)) err('「choices」（選択肢）は、2つ以上の文字のならびにしてください。');
      else if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length)
        err(`「answer」は、正しい選択肢の番号（0から${q.choices.length - 1}までの数）にしてください。いちばん上の選択肢が 0 です。`);
    } else if (q.type === 'tf') {
      if (typeof q.answer !== 'boolean') err('「answer」は true（〇）か false（×）にしてください（" " でかこまないでください）。');
    } else if (q.type === 'fill') {
      if (!(str(q.answer) || (Array.isArray(q.answer) && q.answer.length && q.answer.every(str))))
        err('「answer」は、正解の文字か、正解の候補のならび（["…", "…"]）にしてください。');
    } else if (!str(q.answer)) err('「answer」（カードの答え）を、文字で入れてください。');
    if (q.explanation != null && typeof q.explanation !== 'string') err('「explanation」（解説）は、文字にしてください。');
    if (q.hint != null && typeof q.hint !== 'string') err('「hint」（ヒント）は、文字にしてください。');
    if (q.tags != null && !(Array.isArray(q.tags) && q.tags.every(t => typeof t === 'string'))) err('「tags」は、文字のならびにしてください。');
    if (q.fixedOrder != null && typeof q.fixedOrder !== 'boolean') err('「fixedOrder」は true か false にしてください。');
    if (q.say != null && typeof q.say !== 'string') err('「say」（読み上げる英語）は、文字にしてください。');
    if (q.sayLang != null && !(typeof q.sayLang === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(q.sayLang)))
      err('「sayLang」は "en-US" のような言語の名前にしてください。');
    out.push(q);
  });
  return errors.length ? { errors } : { questions: out };
}

function cleanQuestion(q, ord) {
  const c = { id: q.id.trim(), subject: q.subject.trim(), field: q.field.trim(), lesson: q.lesson.trim(),
    type: q.type, question: q.question, answer: q.answer, explanation: q.explanation || '', _ord: ord };
  if (q.type === 'choice') c.choices = q.choices.slice();
  if (q.type === 'fill' && Array.isArray(q.answer)) c.answer = q.answer.slice();
  if (q.hint) c.hint = q.hint;
  if (q.tags) c.tags = q.tags.slice();
  if (q.fixedOrder === true) c.fixedOrder = true;
  if (typeof q.say === 'string' && plain(q.say).trim()) c.say = plain(q.say).trim();   // ふりがな記法は外す
  if (typeof q.sayLang === 'string' && q.sayLang) c.sayLang = q.sayLang;
  return c;
}

async function importFiles(files) {
  importMsgs = [];
  for (const file of files) {
    let text;
    try { text = await readText(file); } catch (e) {
      importMsgs.push({ ok: false, title: `「${file.name}」を開けませんでした。`, lines: [] });
      continue;
    }
    const res = validateQuestions(text);
    if (res.errors) {
      const lines = res.errors.slice(0, 15);
      if (res.errors.length > 15) lines.push(`ほかにも ${res.errors.length - 15}か所あります。`);
      importMsgs.push({ ok: false, title: `「${file.name}」は読みこみませんでした。次のところを直してください。`, lines });
      continue;
    }
    const before = Object.assign({}, questions);
    let added = 0, over = 0;
    const base = Date.now() * 1000;
    res.questions.forEach((q, i) => {
      const c = cleanQuestion(q, base + i);
      if (questions[c.id]) over++; else added++;
      questions[c.id] = c;
    });
    if (!saveQuestions()) {
      questions = before;
      importMsgs.push({ ok: false, title: `「${file.name}」を保存できませんでした（端末の保存する場所がいっぱいかもしれません）。`, lines: [] });
      continue;
    }
    importMsgs.push({ ok: true, title: `「${file.name}」から ${res.questions.length}問を読みこみました（新しい問題 ${added}問・上書き ${over}問）。`,
      lines: over ? ['上書きした問題の学習の記録は、そのまま引きつぎました。'] : [] });
  }
  renderData();
}

function download(name, obj) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
function backup() {
  download(`juku_kiroku_${today().replace(/-/g, '')}.json`, {
    app: BACKUP_APP, kind: 'backup', version: 1, exportedAt: new Date().toISOString(),
    progress, log: dlog, sessions: lastRuns,   // progress に問題ごとの回答回数(n)・正解回数(c)が入る
  });
  toast('記録のバックアップを保存しました');
}
async function restore(file) {
  let d;
  try { d = JSON.parse((await readText(file)).replace(/^﻿/, '')); } catch (e) { d = null; }
  if (!isObj(d) || d.app !== BACKUP_APP || !isObj(d.progress)) {
    importMsgs = [{ ok: false, title: `「${file.name}」は、このアプリの記録のバックアップではないようです。`, lines: ['「学習の記録をバックアップ」で保存したファイルをえらんでください。'] }];
    renderData();
    return;
  }
  if (!confirm('いまの学習の記録を、バックアップの記録に置きかえます。よろしいですか？')) return;
  progress = cleanProgress(d.progress);
  dlog = cleanLog(d.log);
  lastRuns = cleanRuns(d.sessions);
  saveRecords();
  importMsgs = [{ ok: true, title: '記録を復元しました。', lines: [`${Object.keys(progress).length}問ぶんの記録をもどしました。`] }];
  renderData();
}

function renderData() {
  applyTheme(null);
  const v = $('view-data');
  const qIn = h('input', { type: 'file', id: 'qFile', accept: '.json,application/json', multiple: true, hidden: true,
    onchange: e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) importFiles(f); } });
  const bIn = h('input', { type: 'file', id: 'bFile', accept: '.json,application/json', hidden: true,
    onchange: e => { const f = e.target.files[0]; e.target.value = ''; if (f) restore(f); } });

  const groups = new Map();
  for (const q of allQ()) {
    const k = JSON.stringify([q.subject, q.lesson]);
    if (!groups.has(k)) groups.set(k, { s: q.subject, l: q.lesson, fields: new Set(), ids: [] });
    const g = groups.get(k);
    g.fields.add(plain(q.field)); g.ids.push(q.id);
  }
  const gs = [...groups.values()].sort((a, b) => cmpSubj(a.s, b.s) || cmpLesson(a.l, b.l));

  v.replaceChildren(h('h1', { class: 'apptitle' }, '📁 データ'),
    h('div', { class: 'card' }, h('h2', { class: 'sec-h' }, '問題ファイル'),
      h('p', { class: 'note' }, '問題ファイル（JSON）を読みこみます。いくつかまとめてえらべます。問題は、この端末の中だけに保存されます。'),
      h('button', { class: 'btn primary block', id: 'importBtn', onclick: () => qIn.click() }, '📥 問題ファイルを読みこむ'), qIn,
      importMsgs.map(m => h('div', { class: 'msg ' + (m.ok ? 'ok' : 'err') }, h('b', null, (m.ok ? '✅ ' : '⚠️ ') + m.title),
        m.lines.length ? h('ul', null, m.lines.map(l => h('li', null, l))) : null))),
    h('div', { class: 'card', id: 'setList' }, h('h2', { class: 'sec-h' }, `読みこんだ問題（${allQ().length}問）`),
      gs.length ? gs.map(g => h('div', { class: 'set' },
        h('span', { class: 'dot', style: `background:${subjInfo(g.s).c}` }),
        h('div', { class: 'set-main' }, h('div', { class: 'set-t' }, R(g.s), '　', R(g.l)),
          h('div', { class: 'set-f' }, '分野：' + [...g.fields].join('・'))),
        h('div', { class: 'set-n' }, g.ids.length + '問'),
        h('button', { class: 'btn danger small', onclick: () => {
          if (!confirm(`${plain(g.s)} ${plain(g.l)} の問題（${g.ids.length}問）を削除しますか？\n学習の記録は残ります（同じ問題をまた読みこむと、記録が引きつがれます）。`)) return;
          g.ids.forEach(id => delete questions[id]);
          saveQuestions();
          importMsgs = [];
          toast('削除しました');
          renderData();
        } }, '削除'))) : h('p', { class: 'note' }, 'まだありません。')),
    h('div', { class: 'card' }, h('h2', { class: 'sec-h' }, '学習の記録'),
      h('p', { class: 'note' }, '機種変更などにそなえて、記録をファイルに保存できます。'),
      h('div', { class: 'row' },
        h('button', { class: 'btn sub', id: 'backupBtn', onclick: backup }, '💾 学習の記録をバックアップ'),
        h('button', { class: 'btn sub', id: 'restoreBtn', onclick: () => bIn.click() }, '📂 記録を復元')), bIn));
}
