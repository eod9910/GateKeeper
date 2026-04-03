"""
One-time script: remove dead symbols, add live replacements, rebuild symbols.json.
"""
import json, os

SYMBOLS_FILE = os.path.normpath(
    os.path.join(os.path.dirname(__file__), '..', 'data', 'symbols.json')
)

DEAD = {
    # Round 3 — final two dead on Yahoo
    "ALTM",  # Rio Tinto completed acquisition, delisted
    "CSWI",  # Not found on Yahoo (may trade OTC only)
}

# Final replacements
REPLACEMENTS = [
    ("LAC",   "Lithium Americas — active lithium play (replaces ALTM)"),
    ("MTRN",  "Industrial specialty — Materion Corp (replaces CSWI)"),
]

with open(SYMBOLS_FILE, "r", encoding="utf-8") as f:
    data = json.load(f)

existing_all = set(data["all"])

# Remove dead from smallcaps
original_len = len(data["smallcaps"])
data["smallcaps"] = [s for s in data["smallcaps"] if s not in DEAD]
removed = original_len - len(data["smallcaps"])

# Add replacements (skip if already in universe)
added = []
for ticker, note in REPLACEMENTS:
    if ticker not in existing_all:
        data["smallcaps"].append(ticker)
        added.append((ticker, note))
        existing_all.add(ticker)

# Rebuild "all" from sub-arrays to keep perfectly consistent
all_symbols = []
seen = set()
for category in ["commodities", "futures", "indices", "sectors", "international", "bonds", "smallcaps", "forex", "crypto"]:
    for s in data.get(category, []):
        if s not in seen:
            all_symbols.append(s)
            seen.add(s)
data["all"] = all_symbols

with open(SYMBOLS_FILE, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)

print(f"Removed {removed} dead symbols")
print(f"Added {len(added)} replacements:")
for ticker, note in added:
    print(f"  + {ticker:6s}  {note}")
print(f"Total universe: {len(data['all'])} symbols")
