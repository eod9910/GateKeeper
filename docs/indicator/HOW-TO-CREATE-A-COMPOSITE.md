# How to Create a Composite

This guide explains how to create a composite signal in Indicator Studio.

For the full product boundary, see `indicator-architecture.md`.

## What is a Composite?

A composite combines one or more primitives into a higher-order signal.

It may be stateless:

```text
RSI oversold AND DCF undervalued
```

It may also be stateful:

```text
base_forming -> waiting_for_trigger -> entry_ready -> invalidated
```

The key rule:

```text
Composite = signal or signal state
Strategy = trading rules around that signal/state
```

A composite can say:

- `entry_ready`
- `overextended`
- `distribution_risk`
- `regime_confirmed`
- `invalidated`
- `cooldown`

A composite must not define:

- stop loss
- take profit
- position sizing
- execution cost
- max hold exit
- live trade management

Those belong to a strategy.

## When to Build a Composite

Build a composite when:

- one primitive is not enough
- you need multiple conditions to agree
- you need a lifecycle/state machine
- you want Scanner to find a richer setup state
- you want a strategy to later consume a named signal state

Examples:

- DCF undervalued + RSI recovering
- base pattern + volume contraction + breakout trigger
- price-to-sales extreme + trend breakdown
- quality fundamentals + accumulation structure
- social buzz rising + confirmed technical trigger

## Inputs

Composites consume primitives.

Primitive families can include:

- technical primitives
- fundamental primitives
- pattern primitives
- social/intelligence primitives
- structural/context primitives

Each primitive should expose `output_ports` such as:

```json
{
  "signal": {
    "passed": true,
    "score": 0.72,
    "reason": "RSI crossed above threshold"
  },
  "oscillator_state": {
    "state": "recovering_from_oversold"
  }
}
```

## Composite Definition Shape

A composite definition should declare:

- `composition: "composite"`
- `plugin_file: "plugins/composite_runner.py"`
- `plugin_function: "run_composite_plugin"`
- `default_setup_params.composite_spec`
- stage list
- reducer or state-machine logic
- tunable params derived from stage params when needed

Example:

```jsonc
{
  "pattern_id": "value_reversal_entry_composite",
  "name": "Value Reversal Entry Composite",
  "composition": "composite",
  "plugin_file": "plugins/composite_runner.py",
  "plugin_function": "run_composite_plugin",
  "default_setup_params": {
    "pattern_type": "value_reversal_entry_composite",
    "composite_spec": {
      "intent": "entry",
      "stages": [
        { "id": "value", "pattern_id": "dcf_valuation_primitive", "params": { "required_state": "undervalued" } },
        { "id": "timing", "pattern_id": "rsi_primitive", "params": { "threshold": 30, "direction": "cross_above" } }
      ],
      "reducer": {
        "op": "AND",
        "inputs": ["value", "timing"]
      },
      "emit_state": "entry_ready"
    }
  },
  "indicator_role": "entry_composite",
  "tunable_params": []
}
```

## Stateful Composite Guidance

If a composite has state, document the state lifecycle.

Good state names are specific and action-neutral:

- `setup_detected`
- `base_forming`
- `waiting_for_trigger`
- `entry_ready`
- `overextended`
- `invalidated`
- `cooldown`

Avoid state names that are actually trade instructions:

- `buy_now`
- `short_here`
- `sell_at_target`
- `stop_out`

Use `entry_ready` instead of `buy_now`. The strategy decides whether to buy.

## Scanner Contract

Composites can appear in Scanner.

Scanner should be able to answer:

```text
show symbols where value_reversal_entry_composite is entry_ready
show symbols where base_breakout_composite is waiting_for_trigger
```

Scanner does not need stop/take-profit logic to show composite matches.

## Strategy Contract

A strategy can wrap a composite.

The strategy should specify:

- source composite id
- required composite state
- direction
- entry rule
- stop rule
- take-profit rule
- exit rule
- sizing/risk controls
- cost assumptions

Example:

```text
Source: value_reversal_entry_composite
Required state: entry_ready
Direction: long
Entry: next open
Stop: 2 ATR
Take profit: 3R
Max hold: 40 bars
```

## Checklist

Before registering a composite:

- [ ] It references existing primitives.
- [ ] It uses `composition: "composite"`.
- [ ] It uses `plugins/composite_runner.py`.
- [ ] It emits a signal, score, candidate, or state.
- [ ] Its state names are descriptive, not trade instructions.
- [ ] It does not define stops, targets, sizing, or exits.
- [ ] Its tunable stage params are exposed where needed.
- [ ] It can be scanned directly.
- [ ] It can be wrapped by a strategy later.

