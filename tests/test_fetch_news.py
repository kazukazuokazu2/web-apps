"""scripts/fetch_news.py のテスト（標準ライブラリの unittest だけで動く）

実行: python -m unittest discover -s tests -v
ネットワークには接続しない（RSS は tests/fixtures/sample_rss.xml を使う）
"""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
import fetch_news as fn  # noqa: E402

SAMPLE = (ROOT / 'tests' / 'fixtures' / 'sample_rss.xml').read_bytes()
FIELDS = {'title', 'source', 'published', 'link'}


class ParseTest(unittest.TestCase):
    def test_extracts_title_source_date_link(self):
        items = fn.parse_rss(SAMPLE)
        first = items[0]
        self.assertEqual(first['title'], 'テスト社、第3四半期決算を発表')   # 末尾の「 - 媒体名」は外れる
        self.assertEqual(first['source'], '経済新聞A')
        self.assertEqual(first['published'], '2026-11-13T06:00:00+00:00')
        self.assertEqual(first['link'], 'https://news.google.com/rss/articles/AAA1?oc=5')

    def test_only_four_fields_no_body(self):
        items = fn.parse_rss(SAMPLE)
        self.assertTrue(items)
        for it in items:
            self.assertEqual(set(it), FIELDS)
        self.assertNotIn('要約', json.dumps(items, ensure_ascii=False))

    def test_non_http_link_is_dropped(self):
        links = [it['link'] for it in fn.parse_rss(SAMPLE)]
        self.assertFalse(any(l.startswith('javascript:') for l in links))

    def test_script_in_title_is_kept_as_plain_text(self):
        # スクリプトはただの文字列として保存される（画面では textContent で表示するので実行されない）
        titles = [it['title'] for it in fn.parse_rss(SAMPLE)]
        self.assertIn('<script>alert(1)</script>テスト社の新製品', titles)

    def test_query_and_url(self):
        q = fn.build_query(['エヌビディア', 'NVIDIA'])
        self.assertEqual(q, 'エヌビディア OR NVIDIA when:7d')
        url = fn.rss_url(q)
        self.assertTrue(url.startswith('https://news.google.com/rss/search?q='))
        self.assertIn('hl=ja&gl=JP&ceid=JP%3Aja', url)
        with self.assertRaises(ValueError):
            fn.build_query([])


class DedupeTest(unittest.TestCase):
    def test_dedupe_newest_first_max_8(self):
        out = fn.dedupe_sort(fn.parse_rss(SAMPLE))
        self.assertEqual(len(out), 8)
        dates = [it['published'] for it in out]
        self.assertEqual(dates, sorted(dates, reverse=True))
        titles = [fn.normalize(it['title']) for it in out]
        self.assertEqual(len(titles), len(set(titles)))
        # 3 件ある決算の記事（全角の「３」や句点の違いを含む）は、いちばん新しい 1 件だけ残る
        kessan = [it for it in out if '決算' in it['title']]
        self.assertEqual([it['source'] for it in kessan], ['経済新聞A'])
        self.assertEqual(out[0]['title'], 'テスト社のCEOが退任へ、後任は未定')

    def test_near_duplicate_removed(self):
        items = [
            {'title': 'テスト社、来期の業績見通しを上方修正 増配も発表', 'source': 'A', 'published': '2026-11-14T00:00:00+00:00', 'link': 'https://a'},
            {'title': 'テスト社、来期の業績見通しを上方修正　増配も発表へ', 'source': 'B', 'published': '2026-11-13T00:00:00+00:00', 'link': 'https://b'},
            {'title': 'まったく別の話題', 'source': 'C', 'published': '2026-11-12T00:00:00+00:00', 'link': 'https://c'},
        ]
        out = fn.dedupe_sort(items)
        self.assertEqual([it['source'] for it in out], ['A', 'C'])


class UpdateTest(unittest.TestCase):
    TARGETS = [
        {'symbol': 'AAA', 'label': 'A社', 'queries': ['A社']},
        {'symbol': 'BBB', 'label': 'B社', 'queries': ['B社']},
    ]
    OLD = {'news': {'BBB': {'label': 'B社', 'items': [
        {'title': '前回の見出し', 'source': 'X', 'published': '2026-11-01T00:00:00+00:00', 'link': 'https://x'}]}},
        'errors': {}}

    def fetch(self, url):
        if 'B%E7%A4%BE' in url:   # 「B社」の取得だけ失敗させる
            raise OSError('HTTP Error 503: Service Unavailable')
        return SAMPLE

    def test_one_failure_keeps_others_and_previous(self):
        with _quiet():
            out = fn.update_news(self.TARGETS, self.OLD, fetch=self.fetch, now='2026-11-15T00:00:00+00:00')
        self.assertEqual(len(out['news']['AAA']['items']), 8)                     # 他の銘柄は取れている
        self.assertEqual(out['news']['BBB']['items'], self.OLD['news']['BBB']['items'])   # 前回の内容が残る
        self.assertIn('503', out['errors']['BBB']['message'])                     # 失敗の印
        self.assertEqual(out['errors']['BBB']['since'], '2026-11-15T00:00:00+00:00')
        self.assertNotIn('AAA', out['errors'])

    def test_failure_since_is_kept_while_failing(self):
        old = {**self.OLD, 'errors': {'BBB': {'message': 'x', 'since': '2026-11-14T00:00:00+00:00'}}}
        with _quiet():
            out = fn.update_news(self.TARGETS, old, fetch=self.fetch, now='2026-11-15T00:00:00+00:00')
        self.assertEqual(out['errors']['BBB']['since'], '2026-11-14T00:00:00+00:00')

    def test_output_has_no_holding_info_and_is_small(self):
        with _quiet():
            out = fn.update_news(self.TARGETS, {}, fetch=lambda u: SAMPLE)
        for entry in out['news'].values():
            self.assertEqual(set(entry), {'label', 'items'})
            for it in entry['items']:
                self.assertEqual(set(it), FIELDS)
        text = json.dumps(out, ensure_ascii=False)
        self.assertNotIn('保有', text)
        self.assertNotIn('holding', text.lower())
        self.assertLess(len(text.encode('utf-8')), fn.MAX_BYTES)


class RepoFilesTest(unittest.TestCase):
    def test_targets_file_has_no_holding_info(self):
        text = (ROOT / 'data' / 'news-targets.json').read_text(encoding='utf-8')
        data = json.loads(text)
        self.assertNotIn('保有', text)
        self.assertNotIn('holding', text.lower())
        for t in data['targets']:
            self.assertEqual(set(t), {'symbol', 'label', 'queries'})
            self.assertTrue(t['queries'])

    def test_news_json_if_present_has_only_allowed_fields(self):
        path = ROOT / 'data' / 'news.json'
        if not path.exists():
            self.skipTest('data/news.json はまだない')
        data = json.loads(path.read_text(encoding='utf-8'))
        self.assertEqual(set(data), {'updatedAt', 'source', 'news', 'errors'})
        for entry in data['news'].values():
            self.assertEqual(set(entry), {'label', 'items'})
            for it in entry['items']:
                self.assertEqual(set(it), FIELDS)
        self.assertNotIn('holding', path.read_text(encoding='utf-8').lower())


class _quiet:
    """update_news の print を黙らせる"""
    def __enter__(self):
        import io
        self._old, sys.stdout = sys.stdout, io.StringIO()

    def __exit__(self, *a):
        sys.stdout = self._old


if __name__ == '__main__':
    unittest.main()
