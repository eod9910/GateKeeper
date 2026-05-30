# Signal, Composite, and Strategy Methodology

This document is the canonical methodology for how Pattern Detector separates scannable signals from tradable strategies.

The core rule is simple:

```text
Primitive -> emits a metric, event, or state component
Composite -> combines primitives and may emit a stateful signal
Strategy -> wraps a primitive/composite state with entry, exit, risk, and execution rules
```

## Why This Boundary Exists

Pattern Detector has two different jobs that should not be mixed:

- Find symbols that are interesting right now.
- Prove whether acting on those signals has positive expectancy.

The Scanner answers the first question. It consumes primitives and composites.

The Validator answers the second question. It consumes strategies only.

This keeps signal discovery separate from trade management. A signal can be useful before we know how to trade it. A strategy can only be validated once it defines how trades are entered, exited, sized, and costed.

Validator does not create strategies. Strategy creation belongs to Strategy Builder, which wraps one primitive or composite signal in trade-management rules and saves the strategy spec for Validator to test.

## Primitive

A primitive is the smallest reusable signal component. It answers one narrow question.

Examples:

- RSI below 30
- MACD line crossing signal line
- DCF undervalued
- price-to-sales above 70
- base pattern detected
- insider buying cluster

Primitives may be technical, fundamental, social, structural, or pattern based.

Primitives are allowed in the Scanner. A primitive can be scanned alone when the user wants raw matches for one condition.

Primitives can also be used as stages inside composites.

Primitives must not own trade-management rules. A primitive should not define stops, take profits, position sizing, or holding-period exits.

## Composite

A composite combines one or more primitives into a higher-order signal.

Composites may be stateless or stateful. Stateful composites are first-class citizens in this methodology.

Examples of composite states:

- `setup_detected`
- `base_forming`
- `waiting_for_trigger`
- `entry_ready`
- `overextended`
- `distribution_risk`
- `invalidated`
- `cooldown`
- `regime_confirmed`

A composite can represent a lifecycle. For example, a base breakout composite might move from `base_forming` to `waiting_for_trigger` to `entry_ready` to `invalidated`.

Composites are allowed in the Scanner. The Scanner should eventually support queries like:

```text
show symbols where base_breakout_composite.state == entry_ready
show symbols where dcf_rsi_composite.state == accumulation_candidate
```

Composites must not own trade-management rules. They may say "this symbol is entry ready," but they must not say "buy next open with a 2 ATR stop and a 3R target." That belongs to a strategy.

## Strategy

A strategy turns a primitive or composite signal into a testable trading hypothesis.

Strategies define:

- signal source: primitive or composite
- required signal state, if applicable
- direction: long, short, or both
- entry rule
- stop rule
- take-profit rule
- exit rule
- sizing and risk controls
- cost and slippage assumptions
- validation universe and interval
- parameter manifest for sweep, sensitivity, AI repair, and review

A strategy can wrap one primitive, such as RSI below 30 with a 2 ATR stop, a 3R target, and a 20-bar max hold.

A strategy can also wrap a composite, such as a base breakout composite in `entry_ready` state with a stop below the base low and a 40-bar max hold.

Strategies are not Scanner objects. They belong in the Validator/backtester because they exist to answer whether a trading rule has positive expectancy.

## Product Surface Ownership

| Product surface | Consumes | Purpose |
|---|---|---|
| Primitive Builder | primitive definitions | Create one reusable signal component |
| Composite Builder | primitives | Combine primitives into a signal, including stateful signals |
| Strategy Builder | primitives or composites | Wrap a signal/state in trade-management rules |
| Scanner | primitives and composites | Find current matches or signal states |
| Research Studio | primitives and composites | Test signal quality without full trade rules |
| Validator | strategies | Test expectancy, robustness, risk, and tradability |
| Parameter Sweep | strategies | Repair or optimize strategy parameters under policy |

## Scanner Contract

Scanner should show signal-producing artifacts only:

- technical primitives
- fundamental primitives
- pattern primitives/scanners
- composites

Scanner should not show strategies as normal scan signals.

If the product later needs a "trade candidates" view, it should be explicit that the view is running a strategy-backed workflow, not a plain signal scan.

## Research Contract

Research Studio may run signal-only studies on primitives and composites.

Signal-only studies can measure:

- forward return after signal
- MFE/MAE after signal
- hit rate to fixed levels
- signal frequency
- regime sensitivity
- state-transition outcomes

Research answers:

```text
Does this signal appear to have there there?
```

Research does not certify live tradability. It can recommend that a promising signal be wrapped into a strategy.

## Validator Contract

Validator runs strategies only.

Validator answers:

```text
Does this trade plan have positive expectancy after realistic entry, exit, risk, cost, and robustness testing?
```

Validator should not run naked primitives or naked composites. Naked signal checks belong in Research.

## Builder Naming

The UI should use these names:

- `Primitive Builder`
- `Composite Builder`
- `Strategy Builder`
- `Pattern Scanner`
- `Signal Library`

The word "indicator" should be used only when the specific artifact is truly a technical indicator. The broader product term is "signal."

## Storage Implications

Primitive definitions live with pattern/plugin definitions and declare `composition: "primitive"`, role metadata, `tunable_params`, output ports, and optional state compatibility metadata.

Composite definitions live with pattern/plugin definitions and declare `composition: "composite"`, `default_setup_params.composite_spec`, stages, reducer or state-machine semantics, and derived tunable params where appropriate.

Strategy definitions live in `backend/data/strategies/` and declare strategy identity, signal source, required state where applicable, entry/risk/exit/cost/execution configs, and `parameter_manifest`.

Completed strategies must conform to the canonical schema at `backend/data/schemas/strategy.schema.json`. The schema is a hard outer contract with flexible inner configs: every strategy has the same machine-readable envelope, while each primitive/composite family can define its own `setup_config`, `structure_config`, `fundamental_config`, and execution details.

All strategies must be sweep compliant. A strategy is sweep compliant when every behavior-defining knob can be found by Sweep through `parameter_manifest` or through primitive/composite tunables that the strategy promoter converts into `parameter_manifest`. Non-compliant strategies may exist as drafts, but they should not enter Validator as official test candidates.

## Data Contracts

Primitive scan output should expose these fields when available:

- `pattern_id`
- `symbol`
- `timestamp`
- `passed`
- `score`
- `value`
- `state`
- `reason`
- `metrics`
- `params`

Composite scan output should preserve primitive stage evidence and expose state explicitly:

- `pattern_id`
- `symbol`
- `timestamp`
- `passed`
- `state`
- `previous_state`
- `state_changed`
- `confidence`
- `stage_results`
- `reducer_result`
- `metrics`

Composite definitions should reserve `default_setup_params.composite_spec.state_spec` for state metadata:

```json
{
  "emits_state": true,
  "default_state": "entry_ready",
  "allowed_states": [
    "setup_detected",
    "waiting_for_trigger",
    "entry_ready",
    "invalidated",
    "cooldown"
  ]
}
```

State policy is fixed vocabulary plus extension. Builders should offer the common states above, but definitions may add domain-specific states such as `undervalued`, `overextended`, or `regime_confirmed` when the signal requires them.

Strategy definitions should point back to the primitive or composite they trade:

```json
{
  "source_signal": {
    "pattern_id": "base_breakout_composite",
    "composition": "composite",
    "required_state": "entry_ready"
  }
}
```

Strategy parameter manifests may reference both composite stage parameters and strategy-level trade parameters. Valid manifest targets include:

- `setup_config.composite_spec.stages[].params`
- `setup_config`
- `entry_config`
- `risk_config`
- `exit_config`
- `cost_config`
- `execution_config`
- `fundamental_config`

Strategy-defining research knobs must be saved with the strategy, not only passed as one-off Backtester overrides. For fundamental and valuation strategies, this includes settings such as DCF forward hold bars, rebalance cadence, valuation gap threshold, and minimum observation counts. Example: a DCF strategy that tests a 26-bar forward valuation basket should persist `fundamental_config.forward_bars: 26` and expose it through `parameter_manifest` if Sweep is allowed to vary it.

## Methodology Checklist

Before building a new artifact, classify it:

- If it asks one reusable question, build a primitive.
- If it combines signal components or tracks a signal lifecycle, build a composite.
- If it says when/how to enter or exit a trade, build a strategy.

Before adding something to Scanner:

- It must be a primitive or composite.
- It must emit a current signal, metric, candidate, or state.
- It must not require stop/take-profit logic to make sense.

Before adding something to Validator:

- It must be a strategy.
- It must include trade-management rules.
- It must be capable of producing expectancy, drawdown, and robustness metrics.
