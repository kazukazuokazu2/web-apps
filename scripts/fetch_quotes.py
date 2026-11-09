"""株価を取得して data/quotes.json に書き出す（GitHub Actions から定期的に実行する）。

- 取得する銘柄は data/symbols.json に、アプリと同じコードで書く（例: 7203, AAPL, ^N225, USDJPY）
- 日本株（数字で始まる4文字）は Yahoo!ファイナンスの「7203.T」、USDJPY は「JPY=X」として取得する
- 取得に失敗した銘柄は、前回の値を残し、errors に理由を書く
- 株価が前回と同じなら、ファイルを書き換えない（不要なコミットを作らないため）
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
SYMBOLS_FILE = ROOT / 'data' / 'symbols.json'
QUOTES_FILE = ROOT / 'data' / 'quotes.json'


def yahoo_ticker(symbol):
    """アプリのコードを、Yahoo!ファイナンスのティッカーに直す"""
    if symbol == 'USDJPY':
        return 'JPY=X'
    if re.fullmatch(r'\d[0-9A-Z]{3}', symbol):
        return symbol + '.T'
    return symbol


def summarize(closes):
    """日足の終値から、アプリが使う値（現在値・前日終値・1か月前・前年末）を作る"""
    closes = closes.dropna()
    if len(closes) < 2:
        raise ValueError('終値のデータが足りません（コードが正しいか確認してください）')
    last_date = closes.index[-1]
    month_ago = closes[closes.index <= last_date - pd.DateOffset(months=1)]
    prev_year = closes[closes.index.year < last_date.year]
    return {
        'price': round(float(closes.iloc[-1]), 4),        # 最新の値（取引時間中はその時点の値）
        'prevClose': round(float(closes.iloc[-2]), 4),    # 前の取引日の終値
        'monthAgo': round(float(month_ago.iloc[-1]), 4) if len(month_ago) else None,
        'yearStart': round(float(prev_year.iloc[-1]), 4) if len(prev_year) else None,   # 前年末の終値
        'date': last_date.strftime('%Y-%m-%d'),           # 最新の値の日付（現地の日付）
    }


def main():
    symbols = json.loads(SYMBOLS_FILE.read_text(encoding='utf-8'))['symbols']
    old = json.loads(QUOTES_FILE.read_text(encoding='utf-8')) if QUOTES_FILE.exists() else {}
    old_quotes = old.get('quotes', {})

    quotes, errors = {}, {}
    for symbol in symbols:
        ticker = yahoo_ticker(symbol)
        try:
            hist = yf.Ticker(ticker).history(period='14mo', interval='1d', auto_adjust=False)
            quotes[symbol] = summarize(hist['Close'])
        except Exception as e:  # 1銘柄の失敗で全体を止めない
            errors[symbol] = f'{ticker}: {e}'
            if symbol in old_quotes:
                quotes[symbol] = old_quotes[symbol]
        print(f'{symbol:8} {ticker:8} ' + (f'エラー: {errors[symbol]}' if symbol in errors else json.dumps(quotes[symbol])))

    if quotes == old_quotes and errors == old.get('errors', {}):
        print('前回と同じなので、ファイルは書き換えません')
        return 0

    out = {
        'updatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'source': 'Yahoo!ファイナンス（yfinance で取得）',
        'quotes': quotes,
        'errors': errors,
    }
    QUOTES_FILE.write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'{len(quotes)} 銘柄を書き出しました（エラー {len(errors)} 件）')
    return 0 if quotes else 1   # 1銘柄も取れなかったときは、Actions で失敗として表示する


if __name__ == '__main__':
    sys.exit(main())
