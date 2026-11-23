'use strict';
/* 共通の道具（ほかのJSより先に読みこむ） */

const TYPES = ['choice', 'tf', 'fill', 'card'];
const TYPE_LABEL = { choice: 'えらぶ', tf: '〇×', fill: '書く', card: '暗記カード' };
const INTERVALS = [1, 2, 4, 7, 14];   // 箱1〜5の、次に出すまでの日数
const LOW = 3;                         // これより少ない回答数は「まだデータが少ない」

const SUBJECTS = {
  '国語': { c: '#d9465f', l: '#fde9ed', d: '#a8213a', ic: '✏️' },
  '算数': { c: '#2f74d8', l: '#e5effc', d: '#1c4f9c', ic: '📐' },
  '理科': { c: '#1f9a5c', l: '#e2f5ea', d: '#136b3e', ic: '🌱' },
  '社会': { c: '#d9711a', l: '#fdeedd', d: '#97480a', ic: '🗾' },
};
const EXTRA_COLORS = [
  { c: '#7c4dd6', l: '#efe8fb', d: '#52289f', ic: '📚' },
  { c: '#0e8f8c', l: '#dff4f3', d: '#06615f', ic: '📗' },
  { c: '#c0378a', l: '#fbe6f1', d: '#86185c', ic: '📕' },
  { c: '#5b6577', l: '#eceef2', d: '#363d4a', ic: '📒' },
];
const SUBJ_ORDER = ['国語', '算数', '理科', '社会'];

function subjInfo(s) {
  if (SUBJECTS[s]) return SUBJECTS[s];
  let n = 0;
  for (const ch of String(s)) n = (n * 31 + ch.codePointAt(0)) >>> 0;
  return EXTRA_COLORS[n % EXTRA_COLORS.length];
}
function cmpSubj(a, b) {
  const ia = SUBJ_ORDER.indexOf(a), ib = SUBJ_ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || String(a).localeCompare(String(b), 'ja');
}
function lessonNum(l) {
  const m = String(l).normalize('NFKC').match(/\d+/);
  return m ? Number(m[0]) : Infinity;
}
function cmpLesson(a, b) {
  return (lessonNum(a) - lessonNum(b)) || String(a).localeCompare(String(b), 'ja');
}

/* ----- 日付（端末の時刻で YYYY-MM-DD） ----- */
function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function today() { return ymd(new Date()); }
function addDays(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  return ymd(new Date(y, m - 1, d + n));
}

/* ----- 小さな道具 ----- */
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const asObj = v => (isObj(v) ? v : {});
const uniq = a => [...new Set(a)];
const $ = id => document.getElementById(id);
function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const pick = a => a[Math.floor(Math.random() * a.length)];
const rate = a => (a && a.n > 0 ? Math.round(a.c / a.n * 100) : null);
const colorOf = p => (p == null ? 'none' : p >= 80 ? 'g' : p >= 50 ? 'y' : 'r');

/* ----- ふりがな {漢字|よみ} ----- */
const RUBY_SRC = '\\{([^{}|]+)\\|([^{}|]+)\\}';
function plain(t) { return String(t == null ? '' : t).replace(new RegExp(RUBY_SRC, 'g'), '$1'); }

// el の中に、ふりがな付きの文章を「安全に」入れる（HTMLタグは文字のまま表示）
function rich(el, t) {
  t = String(t == null ? '' : t);
  const re = new RegExp(RUBY_SRC, 'g');
  let last = 0, m;
  while ((m = re.exec(t))) {
    if (m.index > last) el.appendChild(document.createTextNode(t.slice(last, m.index)));
    if (settings.furigana) {
      const r = document.createElement('ruby');
      r.appendChild(document.createTextNode(m[1]));
      const rt = document.createElement('rt');
      rt.textContent = m[2];
      r.appendChild(rt);
      el.appendChild(r);
    } else {
      el.appendChild(document.createTextNode(m[1]));
    }
    last = m.index + m[0].length;
  }
  if (last < t.length) el.appendChild(document.createTextNode(t.slice(last)));
  return el;
}
function R(text, tag, cls) { return rich(h(tag || 'span', cls ? { class: cls } : null), text); }

// 穴埋めの判定用：ふりがな除去・全角半角・空白・カタカナ/ひらがなの違いをそろえる
function norm(s) {
  return plain(s).normalize('NFKC').toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/* ----- 画面の部品を作る（文字は必ず textContent 扱い） ----- */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of kids.flat(2)) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  return el;
}

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
}

function answerText(q) {
  if (q.type === 'choice') return q.choices[q.answer];
  if (q.type === 'tf') return q.answer ? '〇（正しい）' : '×（まちがい）';
  if (q.type === 'fill') return Array.isArray(q.answer) ? q.answer.join(' ／ ') : q.answer;
  return q.answer;
}
