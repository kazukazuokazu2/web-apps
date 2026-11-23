'use strict';
/* 出題画面・結果画面 */

let S = null;                       // いまの出題（session）
const lastOrders = new Map();       // 問題id → 前回の選択肢の順番（同じ並びが続かないように）
const PRAISE = ['せいかい！すごい！', 'せいかい！その調子！', 'せいかい！よくできたね！', 'せいかい！かんぺき！'];

function startQuiz(qs, retry) {
  if (!qs.length) return;
  S = { items: qs.map(q => ({ q })), idx: 0, answers: [], cond: retry ? null : condKey() };
  document.body.classList.add('in-quiz');
  $('result').classList.remove('on');
  $('quiz').classList.add('on');
  renderQ();
}
function closeQuiz() {
  S = null;
  document.body.classList.remove('in-quiz');
  $('quiz').classList.remove('on');
  $('result').classList.remove('on');
  showTab('learn');
}

// 選択肢の順番：毎回ランダム（fixedOrder:true は入れかえない）
function choiceOrder(q) {
  const base = q.choices.map((_, i) => i);
  if (q.fixedOrder === true || base.length < 2) return base;
  const prev = lastOrders.get(q.id);
  let o, tries = 0;
  do { o = shuffle(base); tries++; } while (prev && o.join() === prev && tries < 30);
  lastOrders.set(q.id, o.join());
  return o;
}

function renderQ() {
  const it = S.items[S.idx], q = it.q, total = S.items.length;
  applyTheme(q.subject);
  const root = $('quiz');
  root.replaceChildren(h('div', { class: 'qtop' },
    h('button', { class: 'quit', onclick: quitQuiz }, '✕ やめる'),
    h('div', { class: 'prog' },
      h('div', { class: 't', id: 'qProg' }, `${S.idx + 1} / ${total}`),
      h('div', { class: 'pbar' }, h('i', { style: `width:${S.idx / total * 100}%` })))));
  const area = h('div', { class: 'area' }), fb = h('div');
  const card = h('div', { class: 'card qcard', 'data-id': q.id, 'data-type': q.type },
    h('div', { class: 'qmeta' }, R(q.subject, 'span', 'tag'), R(q.lesson, 'span', 'tag'), R(q.field, 'span', 'tag'),
      h('span', { class: 'tag' }, TYPE_LABEL[q.type])),
    R(q.question, 'div', 'qtext'));
  if (q.hint) {
    const hint = h('div', { class: 'hint', hidden: true }, h('b', null, '💡 ヒント：'), R(q.hint));
    const btn = h('button', { class: 'mini hintbtn', onclick: () => { hint.hidden = false; btn.remove(); } }, '💡 ヒントを見る');
    card.append(btn, hint);
  }
  card.append(area, fb);
  root.append(card);
  const done = (ok, extra) => answered(it, ok, extra || {}, fb);
  ({ choice: askChoice, tf: askTF, fill: askFill, card: askCard })[q.type](q, area, done);
  window.scrollTo(0, 0);
}

function askChoice(q, area, done) {
  const order = choiceOrder(q);
  const correctText = plain(q.choices[q.answer]);   // 並べかえ前の answer の「文字」で判定する
  const short = q.choices.length % 2 === 0 && q.choices.every(c => plain(c).length <= 10);
  const btns = order.map((orig, k) => h('button', {
    class: 'choice', 'data-orig': String(orig),
    onclick: ev => {
      const picked = ev.currentTarget;
      const ok = plain(q.choices[orig]) === correctText;
      btns.forEach((b, j) => {
        b.disabled = true;
        if (plain(q.choices[order[j]]) === correctText) { b.classList.add('correct'); b.append(h('span', { class: 'mk' }, '⭕ こたえ')); }
        else if (b === picked) { b.classList.add('wrong'); b.append(h('span', { class: 'mk' }, '✕')); }
      });
      done(ok);
    },
  }, h('span', { class: 'no' }, String(k + 1)), R(q.choices[orig], 'span', 'ct')));
  area.append(h('div', { class: 'choices' + (short ? ' two' : '') }, btns));
}

function askTF(q, area, done) {
  const mk = (val, label, cls) => h('button', {
    class: cls, 'aria-label': val ? 'まる（正しい）' : 'ばつ（まちがい）',
    onclick: () => {
      bo.disabled = bx.disabled = true;
      (q.answer ? bo : bx).classList.add('correct');
      if (val !== q.answer) (val ? bo : bx).classList.add('wrong');
      done(val === q.answer);
    },
  }, label);
  const bo = mk(true, '〇', 'o'), bx = mk(false, '×', 'x');
  area.append(h('div', { class: 'tf' }, bo, bx));
}

function askFill(q, area, done) {
  const cands = Array.isArray(q.answer) ? q.answer : [q.answer];
  const inp = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    enterkeyhint: 'done', 'aria-label': 'こたえを書くところ', placeholder: 'ここにこたえを書いてね' });
  const chk = h('button', { class: 'btn primary', type: 'submit' }, '✅ こたえあわせ');
  const idk = h('button', { class: 'btn sub', type: 'button', onclick: () => finish(false, null) }, '🤔 わからない');
  function finish(ok, mine) {
    inp.disabled = chk.disabled = idk.disabled = true;
    done(ok, { mine });
  }
  area.append(h('form', { class: 'fill', onsubmit: e => {
    e.preventDefault();
    if (!norm(inp.value)) { inp.focus(); toast('こたえを書いてから、おしてね'); return; }
    finish(cands.some(a => norm(a) === norm(inp.value)), inp.value);
  } }, inp, h('div', { class: 'row' }, chk, idk)));
  setTimeout(() => { try { inp.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }, 50);
}

function askCard(q, area, done) {
  const show = h('button', { class: 'btn primary block', onclick: () => {
    const yes = h('button', { class: 'btn ok' }, '😊 できた'), no = h('button', { class: 'btn sub' }, '😣 できなかった');
    const f = ok => { yes.disabled = no.disabled = true; done(ok, { card: true }); };
    yes.onclick = () => f(true); no.onclick = () => f(false);
    area.replaceChildren(h('div', { class: 'cardans' }, h('div', { class: 'lbl' }, 'こたえ'), R(q.answer, 'div', 'ans')),
      h('p', { class: 'note' }, '思い出せたかな？'), h('div', { class: 'row' }, yes, no));
  } }, '👀 こたえを見る');
  area.append(h('p', { class: 'note' }, 'こたえを頭の中で思い出してから、ボタンをおしてね。'), show);
}

function answered(it, ok, extra, fb) {
  if (it.done) return;
  it.done = true;
  const q = it.q;
  record(q, ok);
  S.answers.push({ q, ok });
  playSound(ok);
  const last = S.idx >= S.items.length - 1;
  const next = h('button', { class: 'btn primary block', id: 'nextBtn', onclick: nextQ }, last ? '🏁 けっかを見る' : 'つぎへ ▶');
  const box = h('div', { class: 'fb ' + (ok ? 'ok' : 'ng'), role: 'status' },
    h('div', { class: 'big' }, ok ? pick(PRAISE) : 'おしい！もういちど見てみよう'),
    extra.card ? null : [h('div', { class: 'lbl' }, 'せいかい'), R(answerText(q), 'div', 'ans')],
    !ok && extra.mine != null ? [h('div', { class: 'lbl' }, 'あなたのこたえ'), h('div', null, extra.mine)] : null,
    q.explanation ? [h('div', { class: 'lbl' }, 'かいせつ'), R(q.explanation, 'div', 'exp')] : null,
    h('div', { class: 'row' }, next));
  fb.append(box);
  if (ok) stars(box);
  const bar = document.querySelector('#quiz .pbar i');
  if (bar) bar.style.width = ((S.idx + 1) / S.items.length * 100) + '%';
  setTimeout(() => {
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    try { next.focus({ preventScroll: true }); } catch (e) { /* 無視 */ }
  }, 60);
}
function nextQ() {
  S.idx++;
  if (S.idx >= S.items.length) showResult(false); else renderQ();
}
function quitQuiz() {   // 確認なしで中断。回答した分は record() で保存ずみ
  if (S && S.answers.length) showResult(true); else closeQuiz();
}

function stars(box) {
  for (let i = 0; i < 10; i++) {
    const s = h('span', { class: 'star', 'aria-hidden': 'true' }, '★');
    const ang = Math.PI * 2 * i / 10, dist = 60 + Math.random() * 50;
    s.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
    s.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
    box.append(s);
    setTimeout(() => s.remove(), 1000);
  }
}
let audioCtx = null;
function playSound(ok) {
  if (!settings.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    for (const [f, dt] of ok ? [[880, 0], [1318, 0.12]] : [[330, 0], [262, 0.16]]) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = ok ? 'sine' : 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.2, t + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.25);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t + dt); o.stop(t + dt + 0.3);
    }
  } catch (e) { /* 音が出せなくても続ける */ }
}

/* ----- 結果画面 ----- */
function resultMessage(p) {
  if (p === 100) return 'パーフェクト！すばらしい！🎉';
  if (p >= 80) return 'よくできました！この調子！';
  if (p >= 50) return 'がんばったね！まちがえた問題を見なおそう。';
  return 'おつかれさま！まちがえた問題で、力がつくよ。';
}
function resultTable(title, keyFn, sorter) {
  const m = new Map();
  for (const a of S.answers) {
    const k = keyFn(a.q), e = m.get(k) || { n: 0, c: 0 };
    e.n++; if (a.ok) e.c++;
    m.set(k, e);
  }
  return h('div', { class: 'card' }, h('h2', { class: 'sec-h' }, title),
    h('table', { class: 'rt' },
      h('thead', null, h('tr', null, h('th', null, ''), h('th', { class: 'num' }, 'せいかい'), h('th', { class: 'num' }, '正答率'))),
      h('tbody', null, [...m.keys()].sort(sorter).map(k => {
        const e = m.get(k), p = rate(e);
        return h('tr', null, h('td', null, R(k)), h('td', { class: 'num' }, `${e.c}/${e.n}`),
          h('td', { class: 'num' }, h('b', { class: colorOf(p) + '-t' }, p + '%')));
      }))));
}
function showResult(stopped) {
  const n = S.answers.length, c = S.answers.filter(a => a.ok).length, p = rate({ n, c });
  let cmp = null;
  if (S.cond) {
    const prev = lastRuns[S.cond];
    if (prev && prev.n > 0) cmp = rate(prev);
    lastRuns[S.cond] = { n, c, at: Date.now() };
    saveRecords();
  }
  $('quiz').classList.remove('on');
  const root = $('result');
  root.classList.add('on');
  const wrong = uniq(S.answers.filter(a => !a.ok).map(a => a.q));
  root.replaceChildren(
    h('div', { class: 'card res-top' },
      stopped ? h('p', { class: 'note' }, 'とちゅうでやめました。ここまでの記録は保存しました。') : null,
      h('div', { class: 'note' }, 'こんかいの正答率'),
      h('div', { class: 'res-pct ' + colorOf(p) + '-t', id: 'resPct' }, p + '%'),
      h('div', { class: 'res-sub' }, `${n}問中 ${c}問 せいかい`),
      h('div', { class: 'res-msg' }, resultMessage(p)),
      cmp != null ? h('div', { class: 'cmp', id: 'resCmp' }, `前回 ${cmp}% → 今回 ${p}% `,
        p > cmp ? h('span', { class: 'up' }, '↑ アップ！') : p < cmp ? h('span', null, '↓') : h('span', null, '→ おなじ'))
        : S.cond ? h('p', { class: 'note' }, 'この選び方で学習したのは、はじめてです。') : null),
    resultTable('回ごとの正答率', q => q.lesson, cmpLesson),
    resultTable('分野ごとの正答率', q => q.field, (a, b) => a.localeCompare(b, 'ja')),
    h('div', { class: 'card' },
      h('h2', { class: 'sec-h' }, wrong.length ? 'まちがえた問題（見なおそう）' : '全問せいかい！🎉'),
      wrong.map(q => h('div', { class: 'wq' }, R(q.question, 'div', 'wq-q'),
        h('div', { class: 'lbl' }, 'こたえ'), R(answerText(q), 'div'),
        q.explanation ? [h('div', { class: 'lbl' }, 'かいせつ'), R(q.explanation, 'div', 'exp')] : null))),
    h('div', { class: 'row' },
      wrong.length ? h('button', { class: 'btn primary', id: 'retryBtn', onclick: () => startQuiz(shuffle(wrong), true) }, '🔁 まちがえた問題だけもう一度') : null,
      h('button', { class: 'btn sub', id: 'backBtn', onclick: closeQuiz }, 'まなぶにもどる')));
  window.scrollTo(0, 0);
}
