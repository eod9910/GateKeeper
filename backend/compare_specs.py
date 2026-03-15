"""Quick comparison: v1 (major) vs v2 (RDP) on a list of symbols."""
import subprocess, json, sys

SYMBOLS = ["SLV", "CROX", "PAAS", "UUUU"]
SPECS = [
    ("v1 MAJOR", "data/strategies/wyckoff_accumulation_v1.json"),
    ("v2 RDP",   "data/strategies/wyckoff_accumulation_v2.json"),
]

for symbol in SYMBOLS:
    print(f"\n{'='*60}")
    print(f"  {symbol}")
    print(f"{'='*60}")
    
    for label, spec_path in SPECS:
        cmd = [
            sys.executable, "services/strategyRunner.py",
            "--spec", spec_path,
            "--symbol", symbol,
            "--timeframe", "W",
            "--period", "max",
            "--interval", "1wk",
            "--mode", "scan"
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            print(f"\n  [{label}] ERROR: {result.stderr[-200:]}")
            continue
        
        candidates = json.loads(result.stdout)
        print(f"\n  [{label}] {len(candidates)} candidate(s)")
        
        for i, c in enumerate(candidates):
            a = c.get("anchors", {})
            peak = a.get("prior_peak", {})
            base = c.get("base", {})
            pb = c.get("pullback", {})
            brk = a.get("second_breakout", {})
            
            print(f"    #{i+1}  Score: {c.get('score', '?')}")
            print(f"         Peak:     ${peak.get('price','?')} ({peak.get('date','?')})")
            print(f"         Base:     ${base.get('low',0):.2f} - ${base.get('high',0):.2f}  ({base.get('duration','?')}w)")
            print(f"         Pullback: {pb.get('retracement_pct','?')} retracement")
            print(f"         Breakout: ${brk.get('price','?')} ({brk.get('date','?')})")
