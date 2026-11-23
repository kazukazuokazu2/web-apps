'use strict';
/* 画面4：せってい・タブ切りかえ・起動 */

let currentTab = 'learn';
const RENDER = { learn: renderLearn, stats: renderStats, data: renderData, settings: renderSettings };

function showTab(name) {
  currentTab = name;
  for (const t of Object.keys(RENDER)) {
    $('view-' + t).hidden = t !== name;
    const b = document.querySelector(`.tabbar [data-tab="${t}"]`);
    if (t === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  RENDER[name]();
  window.scrollTo(0, 0);
}

function applySettings() {
  document.body.classList.toggle('size-large', settings.size === 'large');
  document.body.classList.toggle('size-xlarge', settings.size === 'xlarge');
}
function switchBtn(id, label, value, onChange) {
  const txt = h('span', null, value ? 'オン' : 'オフ');
  const b = h('button', { class: 'sw', id, role: 'switch', 'aria-checked': String(value), 'aria-label': label,
    onclick: () => {
      const nv = b.getAttribute('aria-checked') !== 'true';
      b.setAttribute('aria-checked', String(nv));
      txt.textContent = nv ? 'オン' : 'オフ';
      onChange(nv);
    } });
  return h('span', { class: 'swbox' }, txt, b);
}

function renderSettings() {
  applyTheme(null);
  const v = $('view-settings');
  const preview = R('{漢字|かんじ}の{読|よ}み{方|かた}の{例|れい}です', 'div', 'preview');
  const size = h('div', { class: 'seg', role: 'group' }, [['normal', 'ふつう'], ['large', '大きい'], ['xlarge', 'とても大きい']]
    .map(([k, label]) => h('button', { 'aria-pressed': String(settings.size === k), onclick: () => {
      settings.size = k; saveSettings(); applySettings(); renderSettings();
    } }, label)));
  v.replaceChildren(h('h1', { class: 'apptitle' }, '⚙️ せってい'),
    h('div', { class: 'card' },
      h('div', { class: 'set-row' }, h('b', null, 'ふりがなを表示する'),
        switchBtn('swFurigana', 'ふりがなを表示する', settings.furigana, val => {
          settings.furigana = val; saveSettings();
          preview.replaceChildren(); rich(preview, '{漢字|かんじ}の{読|よ}み{方|かた}の{例|れい}です');
        }), preview),
      h('div', { class: 'set-row' }, h('b', null, '文字の大きさ'), size),
      h('div', { class: 'set-row' }, h('b', null, '効果音'),
        switchBtn('swSound', '効果音', settings.sound, val => { settings.sound = val; saveSettings(); if (val) playSound(true); }))),
    h('div', { class: 'card' }, h('h2', { class: 'sec-h' }, '記録を消す'),
      h('p', { class: 'note' }, '正答率・復習の予定・連続日数など、学習の記録をすべて消します。問題ファイルは消えません。'),
      h('button', { class: 'btn danger block', onclick: () => {
        if (!confirm('すべての学習の記録を消します。よろしいですか？')) return;
        if (!confirm('ほんとうに消しますか？　もとにはもどせません。')) return;
        progress = {}; dlog = {}; lastRuns = {};
        unstore(KEYS.progress); unstore(KEYS.log); unstore(KEYS.sessions);
        toast('すべての記録を消しました');
      } }, '🗑 すべての記録を消す')),
    h('div', { class: 'card' }, h('h2', { class: 'sec-h' }, 'このアプリについて'),
      h('p', { class: 'note' }, 'インターネットとの通信はしません。問題と記録は、この端末の中だけに保存されます。'),
      h('p', { class: 'note' }, '塾テスト対策　バージョン 1')));
}

/* ----- 起動 ----- */
applySettings();
document.querySelectorAll('.tabbar [data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
showTab('learn');
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* なくても動く */ });
}
