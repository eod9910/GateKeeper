#!/usr/bin/env python3
"""Quick API test to verify the strategy is visible and can be run."""

import json
import urllib.request

BASE = "http://localhost:3002/api/validator"

def api_get(path):
    r = urllib.request.urlopen(f"{BASE}{path}", timeout=10)
    return json.loads(r.read())

def api_post(path, data):
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(f"{BASE}{path}", data=body, headers={"Content-Type": "application/json"})
    r = urllib.request.urlopen(req, timeout=10)
    return json.loads(r.read())

# 1. Check strategies
print("=== Strategies ===")
resp = api_get("/strategies")
strats = resp.get("data", [])
print(f"Total: {len(strats)}")
for s in strats:
    print(f"  {s['strategy_version_id']}: {s['name']} ({s.get('status','?')})")

found = any(s["strategy_version_id"] == "structure_break_short_v1" for s in strats)
print(f"\nStructure Break Short found: {found}")

if found:
    print("\n=== Strategy Detail ===")
    detail = api_get("/strategy/structure_break_short_v1")
    s = detail["data"]
    print(f"  direction: {s.get('backtest_config',{}).get('direction','?')}")
    print(f"  pattern_type: {s.get('setup_config',{}).get('pattern_type','?')}")
    print(f"  interval: {s.get('interval','?')}")
    print(f"  stop_value: {s.get('risk_config',{}).get('stop_value','?')}")

print("\nAPI test complete.")
