import os, json
from collections import defaultdict

REPORTS_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'validation-reports')
TRADES_DIR  = os.path.join(os.path.dirname(__file__), '..', 'data', 'trade-instances')

TARGET_ID = 'sweep_8058e3a6-d_6_v1'

# Find all reports for this strategy
reports = []
for f in os.listdir(REPORTS_DIR):
    if not f.endswith('.json'):
        continue
    path = os.path.join(REPORTS_DIR, f)
    with open(path, encoding='utf-8') as fh:
        try:
            r = json.load(fh)
        except Exception:
            continue
        if r.get('strategy_version_id') == TARGET_ID:
            reports.append(r)

print(f"Reports found for {TARGET_ID}: {len(reports)}")
for r in sorted(reports, key=lambda x: x.get('created_at', '')):
    tier = r.get('config', {}).get('validation_tier', '?')
    pf   = r.get('pass_fail', '?')
    tc   = r.get('trade_count', '?')
    exp  = r.get('expectancy', '?')
    rid  = r.get('report_id', '?')
    sym_count = len(r.get('config', {}).get('universe', []))
    exp_str = f"{exp:.4f}" if isinstance(exp, float) else str(exp)
    print(f"  [{tier}] {pf} | trades={tc} | expectancy={exp_str} | symbols={sym_count} | {rid}")


def load_trades(report):
    if not report:
        return []
    rid = report.get('report_id', '')
    dir_path = os.path.join(TRADES_DIR, rid)
    if not os.path.isdir(dir_path):
        print(f"  No trade directory found at {dir_path}")
        return []
    trades = []
    for fname in os.listdir(dir_path):
        if fname.endswith('.json'):
            with open(os.path.join(dir_path, fname), encoding='utf-8') as fh:
                try:
                    trades.append(json.load(fh))
                except Exception:
                    pass
    return trades


def analyze_trades(trades, label):
    print(f"\n--- {label} ---")
    print(f"Total trades: {len(trades)}")
    if not trades:
        return

    by_symbol = defaultdict(list)
    for t in trades:
        sym = t.get('symbol', '?')
        r_val = t.get('R_multiple', t.get('r_multiple', 0)) or 0
        by_symbol[sym].append(float(r_val))

    sym_stats = []
    for sym, rs in by_symbol.items():
        avg_r = sum(rs) / len(rs)
        wins  = sum(1 for r in rs if r > 0)
        sym_stats.append((sym, len(rs), avg_r, wins))

    sym_stats.sort(key=lambda x: x[2])

    print(f"\nBottom 20 worst symbols (by avg R):")
    print(f"{'Symbol':<10} {'Trades':>7} {'AvgR':>8} {'WinRate':>9}")
    print("-" * 42)
    for sym, cnt, avg_r, wins in sym_stats[:20]:
        wr = wins / cnt * 100 if cnt else 0
        flag = " <-- KILLER" if avg_r < -0.3 and cnt >= 3 else ""
        print(f"{sym:<10} {cnt:>7} {avg_r:>8.3f} {wr:>8.1f}%{flag}")

    print(f"\nTop 10 best symbols (by avg R):")
    print(f"{'Symbol':<10} {'Trades':>7} {'AvgR':>8} {'WinRate':>9}")
    print("-" * 42)
    for sym, cnt, avg_r, wins in sym_stats[-10:][::-1]:
        wr = wins / cnt * 100 if cnt else 0
        print(f"{sym:<10} {cnt:>7} {avg_r:>8.3f} {wr:>8.1f}%")

    positive = [(s, c, r, w) for s, c, r, w in sym_stats if r > 0]
    negative = [(s, c, r, w) for s, c, r, w in sym_stats if r <= 0]
    total_r_pos = sum(r * c for _, c, r, _ in positive)
    total_r_neg = sum(r * c for _, c, r, _ in negative)
    print(f"\nSymbols profitable: {len(positive)} | Total R contributed: +{total_r_pos:.2f}")
    print(f"Symbols losing:     {len(negative)} | Total R contributed: {total_r_neg:.2f}")
    print(f"Net R drag from losers: {total_r_neg:.2f}R across {sum(c for _,c,_,_ in negative)} trades")

    # Show single-trade symbols that lost
    single_losers = [(s, c, r) for s, c, r, _ in sym_stats if c == 1 and r < 0]
    multi_losers  = [(s, c, r) for s, c, r, _ in sym_stats if c > 1 and r < 0]
    print(f"\nSingle-trade symbols that lost: {len(single_losers)} (R drag: {sum(r for _,_,r in single_losers):.2f})")
    print(f"Multi-trade symbols that avg lost: {len(multi_losers)} (R drag: {sum(r*c for _,c,r in multi_losers):.2f})")


tier1bs_report = next((r for r in reports if r.get('config', {}).get('validation_tier') == 'tier1bs'), None)
tier1_report   = next((r for r in reports if r.get('config', {}).get('validation_tier') in ('tier1', 'tier1s')), None)

t1bs_trades = load_trades(tier1bs_report)
t1_trades   = load_trades(tier1_report)

analyze_trades(t1bs_trades, "TIER 1BS (250 symbols) — THE FAILING RUN")
analyze_trades(t1_trades,   "TIER 1 (50 symbols) — THE 1.0R RUN")
