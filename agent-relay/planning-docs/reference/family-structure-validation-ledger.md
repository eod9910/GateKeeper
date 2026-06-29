# Family Structure Validation Ledger

**Status:** ACTIVE
**Purpose:** Keep a running record of family tests so we can tell:

- which structural families have standalone value on their own
- which only become usable after being wrapped with location/timing logic
- which still fail even after wrapping

---

## Why This Exists

When a family-backed strategy underperforms, we need to know whether:

- the **raw family structure** is weak,
- the **downstream filters** (Fib / RSI / timing) are helping,
- or the **risk model** is the real problem.

This ledger tracks two steps of that diagnosis:

1. **structure-only** family tests
2. **wrapped family** tests where structure is used as context and Fib/RSI/timing logic is layered on top

---

## Standard Test Rule

Each family should be tested with a comparable structure-only baseline:

- same asset class
- same timeframe
- same simple risk model
- no Fib location filter
- no RSI timing filter
- no extra regime filter unless that regime filter is considered part of the family definition itself

Primary question:

**Does the family itself show any standalone expectancy at all?**

---

## Decision Buckets

- **Promising standalone structure**
  Positive expectancy with acceptable drawdown and enough trades to justify deeper work.

- **Weak but maybe salvageable**
  Slightly positive or mixed, but not strong enough on its own. Could still be useful as a structural backbone with filters.

- **No standalone value**
  Negative expectancy and/or unacceptable drawdown. Downstream filters may rescue it somewhat, but the raw family itself is not a good tradable base.

- **Not tested yet**
  No completed structure-only validation yet.

---

## Summary

| Bucket | Count |
|---|---:|
| Promising standalone structure | 0 |
| Weak but maybe salvageable | 0 |
| No standalone value | 1 |
| Not tested yet | TBD |

---

## Results Ledger

| Family signature | Test strategy | Tier | Verdict | Exp R | Trades | WF profitable | MC p95 DD | MC p99 DD | Classification | Notes |
|---|---|---|---|---:|---:|---:|---:|---:|---|---|
| `LTH\|CONTINUATION_UP\|HH_ONLY\|DEEP_DOM` | `lth_continuation_test_v1` | Tier 1 | HARD FAIL | -0.105 | 284 | 0.0% | 94.4% | 94.4% | No standalone value | Raw family structure is negative and high-drawdown on its own. The full composite was weak but positive, which implies Fib/RSI were doing rescue/filtering work rather than being the root problem. |

---

## Wrapped Family Results

| Family signature | Wrapped strategy | Tier | Verdict | Exp R | Trades | WF profitable | MC p95 DD | MC p99 DD | Classification | Notes |
|---|---|---|---|---:|---:|---:|---:|---:|---|---|
| `HTL\|REVERSAL_UP\|BOTH_BREAKS\|DEEP_DOM` | `htl_reversal_up_fib_rsi_v1` | Tier 1 | HARD FAIL | 0.135 | 342 | 100.0% | 38.3% | 38.3% | Improved but still not robust | Wrapping the family with Fib location + RSI timing rescued expectancy and walk-forward behavior versus structure-only tests, but the strategy still failed on trade count and Monte Carlo drawdown. This supports the view that structure is useful as context, not sufficient by itself. |

---

## Active Test Queue

| Family signature | Test strategy | Status |
|---|---|---|
| `LTH|REVERSAL_UP|LL_ONLY|DEEP_DOM` | `lth_reversal_up_test_v1` | Ready to run |
| `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` | `htl_reversal_up_test_v1` | Ready to run |
| `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM` | `htl_continuation_up_test_v1` | Ready to run |
| `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` | `lth_reversal_down_test_v1` | Ready to run |

---

## Interpretation Rule

Use this ledger to decide what to do next:

- If a family is **negative on its own**, do not assume the full strategy can be repaired cheaply.
- If a family is **positive on its own**, then investigate whether location/timing/risk is improving it or making it worse.
- If a family is **weak but positive**, treat it as a possible structural scaffold, not as proof of a finished strategy.
