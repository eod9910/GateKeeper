import argparse
import json
import time
from pathlib import Path
from typing import Dict, List

import mplfinance as mpf
import pandas as pd
import yfinance as yf


def parse_args():
    parser = argparse.ArgumentParser(
        description="Generate rolling chart images from a stock universe."
    )
    parser.add_argument(
        "--universe-json",
        default="../../backend/data/universe_clean.json",
        help="Path to universe JSON (expects stocks[].symbol or a symbol list).",
    )
    parser.add_argument(
        "--symbol",
        default="",
        help="Single symbol to scan (overrides universe-json), e.g. BTC-USD or AAPL.",
    )
    parser.add_argument(
        "--symbols-csv",
        default="",
        help="Optional CSV file with a 'symbol' column (overrides universe-json).",
    )
    parser.add_argument(
        "--output-dir",
        default="artifacts/charts",
        help="Output directory for rendered chart images and metadata.",
    )
    parser.add_argument(
        "--timeframes",
        default="1d,1wk",
        help="Comma-separated Yahoo intervals (examples: 1d,1wk,1h).",
    )
    parser.add_argument(
        "--period",
        default="max",
        help="Yahoo period argument (example: max, 10y, 5y).",
    )
    parser.add_argument(
        "--window-bars",
        type=int,
        default=200,
        help="Bars per rendered image window.",
    )
    parser.add_argument(
        "--stride-bars",
        type=int,
        default=20,
        help="Stride between rolling windows.",
    )
    parser.add_argument(
        "--min-bars",
        type=int,
        default=260,
        help="Minimum bars required for a symbol/timeframe before rendering windows.",
    )
    parser.add_argument(
        "--max-symbols",
        type=int,
        default=0,
        help="If >0, limit number of symbols for a test run.",
    )
    parser.add_argument(
        "--pause-seconds",
        type=float,
        default=0.05,
        help="Small pause between symbol fetches to reduce request bursts.",
    )
    return parser.parse_args()


def load_universe_symbols(path: Path) -> List[str]:
    data = json.loads(path.read_text(encoding="utf-8"))

    symbols: List[str] = []
    if isinstance(data, dict) and isinstance(data.get("stocks"), list):
        for item in data["stocks"]:
            if isinstance(item, dict):
                sym = item.get("symbol") or item.get("ticker")
                if sym:
                    symbols.append(str(sym).upper())
    elif isinstance(data, dict) and isinstance(data.get("symbols"), list):
        symbols = [str(s).upper() for s in data["symbols"]]
    elif isinstance(data, list):
        symbols = [str(s).upper() for s in data]
    else:
        raise ValueError(f"Unsupported universe JSON shape: {path}")

    deduped = sorted(set(symbols))
    if not deduped:
        raise ValueError(f"No symbols found in: {path}")
    return deduped


def load_symbols_from_csv(path: Path) -> List[str]:
    df = pd.read_csv(path)
    if "symbol" not in df.columns:
        raise ValueError(f"CSV must contain a 'symbol' column: {path}")
    symbols = [str(s).strip().upper() for s in df["symbol"].dropna().tolist() if str(s).strip()]
    deduped = sorted(set(symbols))
    if not deduped:
        raise ValueError(f"No symbols found in CSV: {path}")
    return deduped


def fetch_ohlc(symbol: str, interval: str, period: str) -> pd.DataFrame:
    df = yf.download(
        tickers=symbol,
        interval=interval,
        period=period,
        auto_adjust=False,
        progress=False,
        threads=False,
    )
    if df is None or df.empty:
        return pd.DataFrame()

    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    required = ["Open", "High", "Low", "Close"]
    if not all(col in df.columns for col in required):
        return pd.DataFrame()

    if "Volume" not in df.columns:
        df["Volume"] = 0

    df = df[["Open", "High", "Low", "Close", "Volume"]].dropna().copy()
    return df


def render_window_chart(df_window: pd.DataFrame, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    mpf.plot(
        df_window,
        type="candle",
        style="charles",
        volume=False,
        axisoff=True,
        figratio=(16, 9),
        figscale=1.0,
        tight_layout=True,
        savefig=dict(fname=str(output_path), dpi=120, bbox_inches="tight", pad_inches=0.02),
        closefig=True,
    )


def main():
    args = parse_args()

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    universe_path = Path(args.universe_json).resolve()
    symbols: List[str]
    symbol_mode = "universe_json"
    if args.symbol.strip():
        symbols = [args.symbol.strip().upper()]
        symbol_mode = "single_symbol"
    elif args.symbols_csv.strip():
        symbols_csv = Path(args.symbols_csv).resolve()
        symbols = load_symbols_from_csv(symbols_csv)
        symbol_mode = "symbols_csv"
    else:
        symbols = load_universe_symbols(universe_path)

    if args.max_symbols > 0:
        symbols = symbols[: args.max_symbols]

    timeframes = [t.strip() for t in args.timeframes.split(",") if t.strip()]
    if not timeframes:
        raise ValueError("No valid timeframes provided.")

    metadata_rows: List[Dict] = []
    total_images = 0

    for idx, symbol in enumerate(symbols, start=1):
        print(f"[{idx}/{len(symbols)}] {symbol}")
        for timeframe in timeframes:
            try:
                df = fetch_ohlc(symbol=symbol, interval=timeframe, period=args.period)
            except Exception as exc:  # noqa: BLE001
                print(f"  - {timeframe}: fetch error -> {exc}")
                continue

            if len(df) < args.min_bars or len(df) < args.window_bars:
                print(f"  - {timeframe}: skipped (bars={len(df)})")
                continue

            symbol_tf_dir = output_dir / timeframe / symbol
            windows_for_symbol_tf = 0

            for start_i in range(0, len(df) - args.window_bars + 1, args.stride_bars):
                end_i = start_i + args.window_bars
                window = df.iloc[start_i:end_i]
                if len(window) < args.window_bars:
                    continue

                file_name = f"{symbol}__{timeframe}__{start_i}_{end_i-1}.png"
                image_path = symbol_tf_dir / file_name
                render_window_chart(window, image_path)

                metadata_rows.append(
                    {
                        "symbol": symbol,
                        "timeframe": timeframe,
                        "window_start_idx": start_i,
                        "window_end_idx": end_i - 1,
                        "start_datetime": str(window.index[0]),
                        "end_datetime": str(window.index[-1]),
                        "bars_visible": args.window_bars,
                        "image_path": str(image_path),
                    }
                )
                windows_for_symbol_tf += 1
                total_images += 1

            print(f"  - {timeframe}: rendered {windows_for_symbol_tf} windows")

        if args.pause_seconds > 0:
            time.sleep(args.pause_seconds)

    metadata_path = output_dir / "chart_windows_metadata.csv"
    pd.DataFrame(metadata_rows).to_csv(metadata_path, index=False)

    summary = {
        "symbol_mode": symbol_mode,
        "universe_json": str(universe_path),
        "symbols_scanned": len(symbols),
        "timeframes": timeframes,
        "period": args.period,
        "window_bars": args.window_bars,
        "stride_bars": args.stride_bars,
        "total_images": total_images,
        "metadata_csv": str(metadata_path),
    }
    summary_path = output_dir / "chart_generation_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"\nDone. Generated {total_images} chart images.")
    print(f"Metadata: {metadata_path}")
    print(f"Summary:  {summary_path}")


if __name__ == "__main__":
    main()
