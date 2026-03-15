"""Debug wiggle scores on real NVDA data."""
import sys, io, os
import numpy as np

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "services"))
sys.path.insert(0, os.path.join(_HERE, "..", "services", "plugins"))

from ohlcv import fetch_data_yfinance
from rdp_wiggle_base_primitive import _wiggle_score, _legs_from_pivots
from rdp import detect_swings_rdp

def quiet(fn, *a, **kw):
    old = sys.stderr; sys.stderr = io.StringIO()
    try: return fn(*a, **kw)
    finally: sys.stderr = old

bars  = quiet(fetch_data_yfinance, "NVDA", period="15y", interval="1wk")
coarse = quiet(detect_swings_rdp, bars, "NVDA", "W", epsilon_pct=0.05)

lows  = [p for p in coarse.swing_points if p.point_type == "LOW"]
highs = [p for p in coarse.swing_points if p.point_type == "HIGH"]

print(f"NVDA: {len(bars)} weekly bars")
print(f"Coarse lows: {len(lows)}")
for lo in lows:
    print(f"  bar {lo.index}  {lo.date[:10]}  ${lo.price:.2f}")
print()

for anchor in lows[:3]:
    anchor_idx   = int(anchor.index)
    anchor_price = float(anchor.price)
    post_data    = bars[anchor_idx:]

    fine = quiet(detect_swings_rdp, post_data, f"NVDA_FINE_{anchor_idx}", "W",
                 epsilon_pct=0.010, use_exact_epsilon=True)
    fine_pts = sorted(fine.swing_points, key=lambda sp: sp.index)
    legs = _legs_from_pivots(fine_pts)

    # Reference median from pre-anchor data
    pre_data  = bars[max(0, anchor_idx - 80): anchor_idx + 1]
    pre_fine  = quiet(detect_swings_rdp, pre_data, f"NVDA_PRE_{anchor_idx}", "W",
                      epsilon_pct=0.010, use_exact_epsilon=True)
    pre_pts   = sorted(pre_fine.swing_points, key=lambda sp: sp.index)
    pre_legs  = _legs_from_pivots(pre_pts)
    ref_median = (float(np.median([l["absLeg"] for l in pre_legs]))
                  if len(pre_legs) >= 3
                  else float(np.median([l["absLeg"] for l in legs[:8]])) if legs else 1.0)

    eps_fine_price = 0.010 * anchor_price
    window_n = 8

    print(f"Anchor bar {anchor_idx}  {bars[anchor_idx].timestamp[:10]}  ${anchor_price:.2f}")
    print(f"  post_data bars: {len(post_data)}  fine_pts: {len(fine_pts)}  legs: {len(legs)}")
    print(f"  ref_median: {ref_median:.2f}  eps_fine_price: {eps_fine_price:.2f}")

    if len(legs) < window_n:
        print(f"  SKIP: fewer legs ({len(legs)}) than window_n ({window_n})")
        print()
        continue

    # Show first few legs
    print("  First 10 legs:")
    for lg in legs[:10]:
        print(f"    dP={lg['dP']:+.2f}  absLeg={lg['absLeg']:.2f}  sign={lg['sign']:+d}")

    # Rolling WIGGLE
    print("  Rolling WIGGLE scores:")
    for k in range(window_n, min(window_n + 25, len(legs) + 1)):
        w = _wiggle_score(legs[:k], window_n, ref_median, eps_fine_price)
        if w:
            flag = " *** QUALIFIES" if w["WIGGLE"] >= 0.30 else ""
            print(f"    k={k:3d}  ALT={w['ALT']:.3f}  AMP={w['AMP']:.3f}  TURN={w['TURN']:.3f}  "
                  f"WIGGLE={w['WIGGLE']:.4f}{flag}")
    print()
