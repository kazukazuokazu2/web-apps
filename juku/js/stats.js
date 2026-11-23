'use strict';
/* 画面2：きろく */

let statSubj = 'all';

function tile(label, value, unit, extra) {
  return h('div', { class: 'tile' }, h('div', { class: 'k' }, label),
    h('div', { class: 'v' }, value, unit ? h('small', null, ' ' + unit) : null), extra || null);
}
function pctTile(label, a, id) {
  const p = rate(a);
  if (p == null) return tile(label, '—', '', h('div', { class: 'lowmsg' }, 'まだ記録がありません'));
  const low = a.n < LOW;
  const t = h('div', { class: 'tile', id },
    h('div', { class: 'k' }, label),
    h('div', { class: 'v ' + colorOf(p) + '-t' + (low ? ' low' : '') }, p + '%', h('small', null, ` ${a.c}/${a.n}`)),
    low ? h('div', { class: 'lowmsg' }, 'まだデータが少ないです（参考値）') : null);
  return t;
}
function bar(label, a) {
  const p = rate(a), low = a.n < LOW;
  return h('div', { class: 'bar-row' + (low ? ' lowdata' : '') },
    h('div', { class: 'bar-label' }, label),
    h('div', { class: 'bar-track', role: 'img', 'aria-label': `${p}%` },
      h('div', { class: 'bar-fill ' + colorOf(p), style: `width:${Math.max(p, 2)}%` })),
    h('div', { class: 'bar-val' }, h('b', { class: colorOf(p) + '-t' }, p + '%'), h('small', null, `${a.c}/${a.n}`)),
    low ? h('div', { class: 'bar-note' }, 'まだデータが少ないです（参考値）') : null);
}
function barCard(title, rows) {
  if (!rows.length) return null;
  return h('div', { class: 'card' }, h('h2', { class: 'sec-h' }, title), h('div', { class: 'bars' }, rows));
}
const legend = () => h('div', { class: 'legend' },
  h('span', null, h('i', { class: 'g' }), '80%以上'), h('span', null, h('i', { class: 'y' }), '50〜79%'),
  h('span', null, h('i', { class: 'r' }), '50%未満'), h('span', null, `うすい表示＝回答が${LOW}問未満（参考値）`));

// 日別の正答率（直近14日）の折れ線グラフ
function lineChart(subj) {
  const NS = 'http://www.w3.org/2000/svg', W = 340, H = 190, L = 42, RR = 12, T = 18, B = 28;
  const t = today(), days = [];
  for (let i = 13; i >= 0; i--) { const d = addDays(t, -i); days.push(Object.assign({ d }, dayStat(d, subj))); }
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '直近14日の正答率の推移');
  const el = (tag, attrs, text, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    (parent || svg).appendChild(e);
    return e;
  };
  const x = i => L + (W - L - RR) * i / 13, y = p => T + (H - T - B) * (1 - p / 100);
  for (const g of [0, 50, 80, 100]) {
    el('line', { x1: L, x2: W - RR, y1: y(g), y2: y(g), class: g === 50 || g === 80 ? 'grid th' : 'grid' });
    el('text', { x: L - 6, y: y(g) + 4, class: 'ax', 'text-anchor': 'end' }, g + '%');
  }
  days.forEach((d, i) => {
    if (i % 2 === 1) {
      const [, m, dd] = d.d.split('-').map(Number);
      el('text', { x: x(i), y: H - 8, class: 'ax', 'text-anchor': 'middle' }, i === 13 ? 'きょう' : `${m}/${dd}`);
    }
  });
  const pts = days.map((d, i) => (d.n > 0 ? { i, p: rate(d), n: d.n, c: d.c } : null)).filter(Boolean);
  if (pts.length > 1) el('polyline', { points: pts.map(p => `${x(p.i)},${y(p.p)}`).join(' '), class: 'ln' });
  for (const p of pts) {
    const c = el('circle', { cx: x(p.i), cy: y(p.p), r: 5, class: 'pt ' + colorOf(p.p) + (p.n < LOW ? ' low' : '') });
    el('title', {}, `${days[p.i].d}：${p.p}%（${p.c}/${p.n}）`, c);
    el('text', { x: x(p.i), y: y(p.p) - 9, class: 'pv', 'text-anchor': 'middle' }, String(p.p));
  }
  return h('div', { class: 'card' }, h('h2', { class: 'sec-h' }, '日ごとの正答率（直近14日）'),
    pts.length ? svg : h('p', { class: 'note' }, 'この14日間の記録は、まだありません。'),
    pts.length ? h('p', { class: 'note' }, `うすい点は、その日の回答が${LOW}問未満（参考値）です。`) : null);
}

function weakList(subj) {
  const list = Object.keys(progress)
    .filter(id => questions[id] && progress[id].n >= 2 && progress[id].c < progress[id].n &&
      (!subj || questions[id].subject === subj))
    .map(id => ({ q: questions[id], p: progress[id] }))
    .sort((a, b) => a.p.c / a.p.n - b.p.c / b.p.n || b.p.n - a.p.n)
    .slice(0, 10);
  return h('div', { class: 'card', id: 'weakList' },
    h('h2', { class: 'sec-h' }, '🔍 にがてな問題'),
    h('p', { class: 'note' }, '2回以上といた問題のうち、正答率が低い順です（タップで解説）。'),
    list.length ? list.map(({ q, p }) => {
      const pp = rate(p), s = plain(q.question);
      return h('details', { class: 'weak' },
        h('summary', null, h('span', { class: 'wt' }, s.length > 30 ? s.slice(0, 30) + '…' : s),
          h('span', { class: 'pc ' + colorOf(pp) }, `${pp}%`), h('small', null, `${p.c}/${p.n}`)),
        h('div', { class: 'wbody' }, R(q.question, 'div', 'wq-q'),
          h('div', { class: 'lbl' }, 'こたえ'), R(answerText(q), 'div'),
          q.explanation ? [h('div', { class: 'lbl' }, 'かいせつ'), R(q.explanation, 'div', 'exp')] : null));
    }) : h('p', { class: 'note' }, 'まだありません。'));
}

function renderStats() {
  applyTheme(null);
  const v = $('view-stats');
  v.replaceChildren(h('h1', { class: 'apptitle' }, '📊 きろく'));
  const subs = uniq(subjectsInData().concat(Object.keys(progress).map(id => metaOf(id).s).filter(Boolean))).sort(cmpSubj);
  if (statSubj !== 'all' && !subs.includes(statSubj)) statSubj = 'all';
  v.append(h('div', { class: 'card' }, h('div', { class: 'chips' },
    [['all', 'ぜんぶの科目']].concat(subs.map(s => [s, s])).map(([k, label]) => h('button', {
      class: 'chip', 'aria-pressed': String(statSubj === k), onclick: () => { statSubj = k; renderStats(); },
    }, R(label))))));

  const subj = statSubj === 'all' ? null : statSubj;
  const filt = subj ? (m => m.s === subj) : null;
  const total = aggregate(() => 'all', filt).get('all') || { n: 0, c: 0 };
  v.append(h('div', { class: 'tiles' },
    tile('総回答数', String(total.n), '問'),
    pctTile('正答率（累計）', total, 'totalPct'),
    pctTile('直近7日の正答率', rangeStat(7, subj), 'weekPct'),
    tile('今日の回答数', String(dayStat(today(), subj).n), '問'),
    tile('連続して学習', String(streak(subj)), '日')));
  if (!total.n) {
    v.append(h('div', { class: 'card empty' }, h('p', null, 'まだ記録がありません。「まなぶ」で問題をといてみよう！')));
    return;
  }
  v.append(legend(), lineChart(subj));

  const key2 = (a, b) => JSON.stringify([a, b]);
  if (!subj) {
    const m = aggregate(mt => mt.s);
    v.append(barCard('科目別の正答率', [...m.keys()].sort(cmpSubj).map(k => bar(R(k), m.get(k)))));
  }
  // 分野：にがて（正答率が低い）を上に。データが少ないものは後ろ
  const fm = aggregate(mt => key2(mt.s, mt.f), filt);
  const fk = [...fm.keys()].sort((a, b) => {
    const A = fm.get(a), B = fm.get(b);
    return (A.n < LOW) - (B.n < LOW) || A.c / A.n - B.c / B.n;
  });
  v.append(barCard('分野別の正答率（にがてな順）', fk.map(k => {
    const [s, f] = JSON.parse(k);
    return bar(subj ? R(f) : h('span', null, R(f), h('small', null, `（${plain(s)}）`)), fm.get(k));
  })));
  const lm = aggregate(mt => key2(mt.s, mt.l), filt);
  const lk = [...lm.keys()].sort((a, b) => {
    const A = JSON.parse(a), B = JSON.parse(b);
    return cmpSubj(A[0], B[0]) || cmpLesson(A[1], B[1]);
  });
  v.append(barCard('回別の正答率', lk.map(k => {
    const [s, l] = JSON.parse(k);
    return bar(subj ? R(l) : h('span', null, R(l), h('small', null, `（${plain(s)}）`)), lm.get(k));
  })));
  v.append(weakList(subj));
}
