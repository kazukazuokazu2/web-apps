"""ニュースの見出しを取得して data/news.json に書き出す（GitHub Actions から定期的に実行する）。

- 取得する対象は data/news-targets.json に書く（symbol・queries・label）
- Google ニュースの RSS から、見出し・媒体名・公開日時・リンクだけを取り出す（本文や要約は保存しない）
- 同じ見出し・ほぼ同じ見出しを除き、新しい順に最大 8 件
- 1 銘柄の取得に失敗しても続ける。失敗した銘柄は前回の見出しを残し、errors に印を付ける
- 内容が前回と同じなら、ファイルを書き換えない（不要なコミットを作らないため）
- 標準ライブラリだけで動く
"""
import difflib
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGETS_FILE = ROOT / 'data' / 'news-targets.json'
NEWS_FILE = ROOT / 'data' / 'news.json'

MAX_ITEMS = 8            # 1 銘柄あたりの最大件数
SIMILAR = 0.9            # これ以上似ている見出しは、同じ記事とみなす
MAX_BYTES = 500_000      # news.json の上限（これを超えたら書かずに失敗にする）
TIMEOUT = 15             # 1 回の取得の待ち時間（秒）
RETRIES = 2              # 失敗したときに試す回数
INTERVAL = 1.0           # 銘柄ごとの取得の間隔（秒）
USER_AGENT = 'Mozilla/5.0 (compatible; watchlist-news-fetcher/1.0)'


def build_query(queries):
    """検索名の配列を、Google ニュースの検索語にする（例: エヌビディア OR NVIDIA when:7d）"""
    terms = [f'"{q}"' if ' ' in q else q for q in (q.strip() for q in queries) if q]
    if not terms:
        raise ValueError('検索名（queries）が空です')
    return ' OR '.join(terms) + ' when:7d'


def rss_url(query):
    return 'https://news.google.com/rss/search?' + urllib.parse.urlencode(
        {'q': query, 'hl': 'ja', 'gl': 'JP', 'ceid': 'JP:ja'})


def fetch_url(url):
    """RSS を取得して bytes で返す。失敗したら例外"""
    last = None
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
                return res.read()
        except Exception as e:  # HTTP エラー・タイムアウト・名前解決の失敗など
            last = e
            if attempt + 1 < RETRIES:
                time.sleep(5)
    raise last


def parse_rss(data):
    """RSS から [{title, source, published, link}] を取り出す。description（要約）は読まない"""
    root = ET.fromstring(data)
    items = []
    for item in root.iter('item'):
        title = (item.findtext('title') or '').strip()
        link = (item.findtext('link') or '').strip()
        source = (item.findtext('source') or '').strip()
        pub = (item.findtext('pubDate') or '').strip()
        if not title or not re.match(r'https?://', link):   # リンクは http(s) だけを使う
            continue
        # Google ニュースの見出しは末尾に「 - 媒体名」が付くので外す
        if source and title.endswith(' - ' + source):
            title = title[: -len(' - ' + source)].rstrip()
        try:
            published = parsedate_to_datetime(pub).astimezone(timezone.utc).isoformat(timespec='seconds')
        except (TypeError, ValueError):
            published = None
        items.append({'title': title, 'source': source, 'published': published, 'link': link})
    return items


def normalize(title):
    """重複の判定用に、表記をそろえる（全角・半角、大文字・小文字、記号・空白を無視）"""
    t = unicodedata.normalize('NFKC', title).lower()
    return re.sub(r'[\s\W_]+', '', t)


def dedupe_sort(items, limit=MAX_ITEMS):
    """新しい順に並べ、同じ見出し・ほぼ同じ見出しを除いて、最大 limit 件にする"""
    ordered = sorted(items, key=lambda x: x['published'] or '', reverse=True)
    kept, keys = [], []
    for it in ordered:
        key = normalize(it['title'])
        if not key:
            continue
        if any(key == k or difflib.SequenceMatcher(None, key, k).ratio() >= SIMILAR for k in keys):
            continue
        kept.append(it)
        keys.append(key)
        if len(kept) >= limit:
            break
    return kept


def update_news(targets, old, fetch=fetch_url, now=None, interval=0):
    """全銘柄を取得して、新しい news.json の中身（updatedAt なし）を返す。fetch はテストで差し替える"""
    now = now or datetime.now(timezone.utc).isoformat(timespec='seconds')
    old_news, old_errors = old.get('news', {}), old.get('errors', {})
    news, errors = {}, {}
    for i, t in enumerate(targets):
        sym, label = t['symbol'], t.get('label') or t['symbol']
        if i and interval:
            time.sleep(interval)
        url = None
        try:
            url = rss_url(build_query(t.get('queries') or []))
            items = dedupe_sort(parse_rss(fetch(url)))
            news[sym] = {'label': label, 'items': items}
            print(f'{sym:8} {len(items)} 件')
        except Exception as e:  # 1 銘柄の失敗で全体を止めない
            msg = f'{type(e).__name__}: {e}'
            prev = old_errors.get(sym, {})
            errors[sym] = {'message': msg, 'since': prev.get('since', now)}   # 失敗し始めた日時
            news[sym] = {'label': label, 'items': old_news.get(sym, {}).get('items', [])}   # 前回の内容を残す
            # GitHub Actions のログで目立つように、警告として出す
            print(f'::warning title=ニュース取得失敗 {sym}::{msg} / URL: {url}')
    return {'news': news, 'errors': errors}


def main():
    targets = json.loads(TARGETS_FILE.read_text(encoding='utf-8'))['targets']
    old = json.loads(NEWS_FILE.read_text(encoding='utf-8')) if NEWS_FILE.exists() else {}

    result = update_news(targets, old, interval=INTERVAL)
    ok = len(targets) - len(result['errors'])

    if result['news'] == old.get('news') and result['errors'] == old.get('errors'):
        print('前回と同じなので、ファイルは書き換えません')
        return 0 if ok else 1

    out = {
        'updatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'source': 'Google ニュース（RSS）の見出し',
        **result,
    }
    text = json.dumps(out, ensure_ascii=False, indent=1) + '\n'
    size = len(text.encode('utf-8'))
    if size > MAX_BYTES:
        print(f'::error::news.json が大きすぎます（{size} バイト > {MAX_BYTES}）。書き出しません')
        return 1
    NEWS_FILE.write_text(text, encoding='utf-8')
    print(f'{len(targets)} 銘柄を書き出しました（失敗 {len(result["errors"])} 件、{size} バイト）')
    if not ok:
        print('::error::すべての銘柄で取得に失敗しました（ネットワークや Google ニュースの制限を確認してください）')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
