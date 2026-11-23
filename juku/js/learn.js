'use strict';
/* 画面1：まなぶ（出題の選択） */

function applyTheme(subj) {
  const i = subj ? subjInfo(subj) : { c: '#e06d1f', l: '#fff0e3', d: '#a04a0c' };
  const st = document.documentElement.style;
  st.setProperty('--sc', i.c); st.setProperty('--sl', i.l); st.setProperty('--sd', i.d);
}
const allQ = () => Object.values(questions);
function subjectsInData() { return uniq(allQ().map(q => q.subject)).sort(cmpSubj); }
function fieldsOf(s) { return uniq(allQ().filter(q => q.subject === s).map(q => q.field)).sort((a, b) => a.localeCompare(b, 'ja')); }
function lessonsOf(s) { return uniq(allQ().filter(q => q.subject === s).map(q => q.lesson)).sort(cmpLesson); }

// 前回の選び方を、いまのデータに合わせて直す
function normalizeSel() {
  const subs = subjectsInData();
  if (!subs.length) return false;
  if (!subs.includes(sel.subject)) { sel.subject = subs[0]; sel.fields = null; sel.lessons = null; }
  for (const [key, items] of [['fields', fieldsOf(sel.subject)], ['lessons', lessonsOf(sel.subject)]]) {
    if (!Array.isArray(sel[key])) { sel[key] = items.slice(); continue; }
    const kept = sel[key].filter(x => items.includes(x));
    sel[key] = (kept.length || !sel[key].length) ? kept : items.slice();
  }
  if (!['all', 'wrong', 'new'].includes(sel.mode)) sel.mode = 'all';
  if (!['10', '20', 'all'].includes(sel.count)) sel.count = '10';
  if (!['random', 'lesson'].includes(sel.order)) sel.order = 'random';
  return true;
}

function pool() {
  return allQ().filter(q => {
    if (q.subject !== sel.subject || !sel.fields.includes(q.field) || !sel.lessons.includes(q.lesson)) return false;
    const p = progress[q.id];
    if (sel.mode === 'wrong') return !!(p && p.n > 0 && p.last === false);
    if (sel.mode === 'new') return !(p && p.n > 0);
    return true;
  });
}
// 復習の期限が来た問題を先に入れてから、数をしぼる
function buildItems(list, limit, order) {
  const due = shuffle(list.filter(isDue)), rest = shuffle(list.filter(q => !isDue(q)));
  let chosen = due.concat(rest).slice(0, limit);
  if (order === 'random') chosen = shuffle(chosen);
  else chosen.sort((a, b) => cmpLesson(a.lesson, b.lesson) || (a._ord || 0) - (b._ord || 0));
  return chosen;
}
function condKey() { return JSON.stringify([sel.subject, sel.fields.slice().sort(), sel.lessons.slice().sort()]); }

function section(no, title, right, body) {
  return h('section', { class: 'card' },
    h('h2', { class: 'sec-h' }, h('span', { class: 'step' }, String(no)), h('span', null, title),
      right ? h('span', { class: 'right' }, right) : null),
    body);
}
function pctBadge(a) {
  const p = rate(a);
  if (p == null) return h('span', { class: 'pc none' }, '—（未学習）');
  return h('span', { class: 'pc ' + colorOf(p) + (a.n < LOW ? ' low' : ''), title: `${a.c}/${a.n}` }, p + '%');
}
function chipList(key, items, agg) {
  return h('div', { class: 'chips' }, items.map(it => h('button', {
    class: 'chip', 'aria-pressed': String(sel[key].includes(it)),
    onclick: () => {
      const i = sel[key].indexOf(it);
      if (i >= 0) sel[key].splice(i, 1); else sel[key].push(it);
      renderLearn();
    },
  }, R(it), pctBadge(agg.get(it)))));
}
function allBtn(key, items) {
  const all = items.every(x => sel[key].includes(x));
  return h('button', { class: 'mini', onclick: () => { sel[key] = all ? [] : items.slice(); renderLearn(); } },
    all ? 'ぜんぶ はずす' : 'ぜんぶ');
}
function seg(key, opts) {
  return h('div', { class: 'seg', role: 'group' }, opts.map(([val, label]) => h('button', {
    'aria-pressed': String(sel[key] === val), onclick: () => { sel[key] = val; renderLearn(); },
  }, label)));
}
function pickWeak(fs, ls, fA, lA) {
  const weak = (items, agg) => items.filter(x => { const p = rate(agg.get(x)); return p != null && p < 50; });
  const wf = weak(fs, fA), wl = weak(ls, lA);
  if (!wf.length && !wl.length) { toast('正答率が50%未満の分野・回は、まだありません'); return; }
  sel.fields = wf.length ? wf : fs.slice();
  sel.lessons = wl.length ? wl : ls.slice();
  renderLearn();
  toast(`にがてな分野 ${wf.length}こ・回 ${wl.length}こ をえらびました`);
}

function renderLearn() {
  const v = $('view-learn');
  v.replaceChildren(h('h1', { class: 'apptitle' }, '📖 まなぶ'));
  if (!normalizeSel()) {
    applyTheme(null);
    v.append(h('div', { class: 'card empty' },
      h('p', null, 'まだ問題がありません。'),
      h('p', null, '「データ」タブから、問題ファイルを読みこんでね。'),
      h('button', { class: 'btn primary', onclick: () => showTab('data') }, '📁 データへ')));
    return;
  }
  applyTheme(sel.subject);
  saveSel();

  const grid = h('div', { class: 'subjects' }, subjectsInData().map(s => {
    const i = subjInfo(s);
    return h('button', {
      class: 'subj', 'aria-pressed': String(s === sel.subject),
      style: `--c:${i.c};--c-l:${i.l};--c-d:${i.d}`,
      onclick: () => { sel.subject = s; sel.fields = null; sel.lessons = null; renderLearn(); },
    }, h('span', { class: 'ic', 'aria-hidden': 'true' }, i.ic), R(s), h('small', null, allQ().filter(q => q.subject === s).length + '問'));
  }));
  v.append(section(1, '科目', null, grid));

  const fs = fieldsOf(sel.subject), ls = lessonsOf(sel.subject);
  const inSubj = m => m.s === sel.subject;
  const fA = aggregate(m => m.f, inSubj), lA = aggregate(m => m.l, inSubj);
  v.append(section(2, '分野', allBtn('fields', fs), chipList('fields', fs, fA)));
  v.append(section(3, '回', allBtn('lessons', ls), chipList('lessons', ls, lA)));
  v.append(h('div', { class: 'card weakrow' },
    h('button', { class: 'btn sub small', onclick: () => pickWeak(fs, ls, fA, lA) }, '🎯 にがてだけ'),
    h('span', { class: 'note' }, '正答率が50%未満の分野と回を、自動でえらびます')));
  v.append(section(4, '出題の種類', null, seg('mode', [['all', 'ぜんぶ'], ['wrong', 'まちがえた問題だけ'], ['new', 'まだやっていない問題だけ']])));
  v.append(section(5, '問題数', null, seg('count', [['10', '10問'], ['20', '20問'], ['all', 'ぜんぶ']])));
  v.append(section(6, '出題の順番', null, seg('order', [['random', 'ランダム'], ['lesson', '回の順（テキストの順）']])));

  const list = pool();
  const lim = sel.count === 'all' ? list.length : Math.min(list.length, Number(sel.count));
  const due = list.filter(isDue).length;
  const info = list.length
    ? [h('div', null, 'じょうけんに合う問題 ', h('b', { id: 'matchCount' }, String(list.length)), ' 問'),
       h('small', null, `こんかいは ${lim}問 出します` + (due ? `（復習の時期の ${due}問を先に入れます）` : ''))]
    : [h('div', null, 'じょうけんに合う問題 ', h('b', { id: 'matchCount' }, '0'), ' 問'),
       h('small', null, sel.mode === 'wrong' ? 'まちがえた問題はありません。すばらしい！'
         : sel.mode === 'new' ? 'まだやっていない問題はありません。' : '分野と回を1つ以上えらんでね。')];
  v.append(h('div', { class: 'startbar' }, h('div', { class: 'cnt' }, info),
    h('button', { class: 'btn primary', id: 'startBtn', disabled: list.length === 0,
      onclick: () => startQuiz(buildItems(list, lim, sel.order), false) }, '▶ はじめる')));
}
