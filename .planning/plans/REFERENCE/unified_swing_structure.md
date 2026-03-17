# Unified Swing Structure: Backtrack + RDP Fusion

## The Problem

Two swing detection methods exist, each with blind spots:

| Method | Strengths | Weaknesses |
|--------|-----------|------------|
| **Backtrack** (impulse_trough / choch_primitive) | Always finds the structurally significant trough; mechanical, deterministic, no tuning | Only finds ONE level (peak + trough); no intermediate swings |
| **RDP** (detect_swings_rdp) | Full swing map across entire series; adaptive epsilon; captures intermediate structure | Epsilon-dependent — misses swings when sensitivity is wrong; sometimes picks up noise |

Neither gives the complete picture alone.

## The Idea

Run both methods on the same data, then cross-reference to produce a **ranked swing structure**:

```
Price Data
    │
    ├──► Backtrack Method ──► Key structural trough + peak (1 pair)
    │
    ├──► RDP Method ──► Full swing map (6-12 swing points)
    │
    └──► Fusion Logic ──► Unified Swing Structure (ranked)
```

## Fusion Algorithm

### Step 1: Run Both Methods

```python
# Backtrack: find the ONE key structural level
backtrack_result = find_structure_levels(data, rally_threshold_pct)
# Returns: { peak_idx, peak_price, trough_idx, trough_price }

# RDP: find ALL swing points
rdp_structure = detect_swings_rdp(data, symbol, timeframe, epsilon_pct)
# Returns: SwingStructure with swing_points[] (each has index, price, type HIGH/LOW)
```

### Step 2: Cross-Reference & Rank

For each swing point from either method, assign a confidence tier:

**Tier 1 — Confirmed by BOTH methods** (highest confidence)
- An RDP swing LOW that falls within N bars of the backtrack trough
- An RDP swing HIGH that falls within N bars of the backtrack peak
- These are the structural levels you anchor Fibs to and place stops at

**Tier 2 — RDP-only swings** (intermediate structure)
- RDP found these but backtrack didn't — they're real intermediate swings
- Useful for: intermediate Fib targets, partial profit levels, support/resistance zones

**Tier 3 — Backtrack-only levels** (RDP missed them)
- Backtrack found the structural trough but RDP's epsilon was too aggressive
- This is the "safety net" — catches the swing RDP missed
- Should trigger an RDP epsilon adjustment hint for next time

### Step 3: Proximity Matching

Two swing points "match" if they are within a tolerance window:

```python
MATCH_TOLERANCE_BARS = max(3, int(len(data) * 0.02))  # 2% of data length or 3 bars
MATCH_TOLERANCE_PRICE_PCT = 0.02  # 2% price proximity

def swings_match(backtrack_idx, backtrack_price, rdp_idx, rdp_price):
    bar_close = abs(backtrack_idx - rdp_idx) <= MATCH_TOLERANCE_BARS
    price_close = abs(backtrack_price - rdp_price) / backtrack_price <= MATCH_TOLERANCE_PRICE_PCT
    return bar_close and price_close
```

## Output: UnifiedSwingStructure

```python
@dataclass
class RankedSwingPoint:
    index: int
    price: float
    date: str
    point_type: str          # "HIGH" or "LOW"
    confidence_tier: int     # 1 = both methods, 2 = RDP only, 3 = backtrack only
    source: str              # "both", "rdp", "backtrack"
    rdp_confirmed: bool
    backtrack_confirmed: bool

@dataclass
class UnifiedSwingStructure:
    symbol: str
    timeframe: str
    swings: List[RankedSwingPoint]   # sorted by index
    structural_peak: RankedSwingPoint     # the key peak (always Tier 1 or 3)
    structural_trough: RankedSwingPoint   # the key trough (always Tier 1 or 3)
    structure_intact: bool                # current price above trough?
    current_price: float
    rdp_epsilon_used: float
    methods_agreed: bool                  # did backtrack and RDP find the same key levels?
```

## How This Improves Everything

### Better Fib Anchoring
- Anchor from Tier 1 trough to Tier 1 peak (both methods agree = high confidence)
- If methods disagree, flag it — "low confidence anchor, review manually"

### Better Stop Placement
- Place stops at/below Tier 1 support levels (confirmed by both methods)
- Use Tier 2 levels for intermediate support/trailing stops

### Better Profit Targets
- Instead of dumb 2R targets, target the NEXT Tier 1 or Tier 2 swing level
- This is how real traders pick targets — at known structure

### Better Backtest Exits
- Replace the time exit with: exit at next confirmed swing level
- Reduces the -25R catastrophic losses from the time exit

### Better Structure Break Detection
- A break below a Tier 1 trough is more significant than a break below a Tier 2 trough
- Weight the signal by confidence tier

## Implementation Plan

### New File: `backend/services/plugins/unified_swing_primitive.py`

```
1. Accept OHLCV data
2. Run find_structure_levels() (backtrack)
3. Run detect_swings_rdp() (RDP)
4. Cross-reference with proximity matching
5. Rank all swings into tiers
6. Return UnifiedSwingStructure
7. Annotate chart with tier-colored markers:
   - Tier 1: bright green/red (high confidence)
   - Tier 2: muted green/red (intermediate)
   - Tier 3: yellow (one method only — review)
```

### Integration Points

- **Scanner**: use UnifiedSwingStructure for structure break detection
- **Fib primitive**: anchor from Tier 1 swings instead of raw RDP
- **Backtest engine**: use Tier 1/2 levels for smart exits instead of time exits
- **Validator**: test strategies using unified structure vs raw RDP vs backtrack

### New File: `backend/data/patterns/unified_swing_primitive.json`

Standard primitive registration with:
- `pattern_type: "unified_swing"`
- `indicator_role: "anchor_structure"`
- Tunable params: `rally_threshold_pct`, `rdp_epsilon_pct`, `match_tolerance_bars`

## What This Means for the Backtest

The structure break strategy failed because:
1. Exits were dumb (time exit or fixed R)
2. Only one structural level was detected (the trough)
3. No intermediate structure for trailing stops or profit targets

With unified swings:
- Entry: still on structure break (Tier 1 trough break)
- Stop: at next Tier 1 swing level above (for shorts) or below (for longs)
- Target: next Tier 2 swing level in the profit direction
- Trailing: move stop to each new Tier 2 level as price moves in your favor

This turns the dumb fixed-R system into a structure-aware trade management system.
