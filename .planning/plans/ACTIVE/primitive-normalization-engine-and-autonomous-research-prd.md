# Primitive Normalization Engine and Autonomous Strategy Research

Checklist: primitive-normalization-engine-and-autonomous-research-checklist.md

**Status:** ACTIVE  
**Created:** 2026-03-21  
**Purpose:** Build a canonical primitive normalization engine, import a standard indicator library through adapters, and rebuild the research stack around autonomous strategy discovery over normalized primitives and approved state-machine templates.

---

## Why This Workstream Exists

The app already has a growing primitive catalog, but it is not yet a clean autonomous search language.

Current issues:

- the registry is skewed toward structural, experimental, and custom primitives
- standard indicators exist, but not yet as a clearly normalized and complete core library
- primitive roles are uneven and not always ideal for autonomous composition
- imported indicators and custom research primitives are not yet treated as peers behind one canonical contract
- `Research Studio` currently manages sessions, but it does not yet clearly operate as an autonomous strategy-design system over a normalized search space

The goal is not to rewrite commodity indicators like `RSI` or `MACD`.

The goal is to:

1. import standard indicator math from proven libraries
2. normalize all imported and custom indicators into one internal primitive contract
3. expose that normalized primitive language to:
   - `Research Studio`
   - `Blockly`
   - AI Composer
   - Pipeline/Node editor
   - Scanner
   - Validator
4. allow autonomous strategy design, including stateful strategies, over a controlled and intelligible search space

---

## Product Goal

Turn `Research Studio` into a true autonomous strategy-design surface with explicit modes like:

- `Explore from scratch`
- `Guide the search`
- `Repair a promising strategy`
- `Turn a family into a strategy`
- `Invent a new primitive` (rare, high-cost branch)

This must be powered by a normalized primitive library rather than a loose collection of plugin implementations.

---

## Non-Negotiable Rules

1. **Do not hand-write standard indicator math unless there is a real reason.**
   - Use open-source libraries for standard indicators.
   - Keep custom code for differentiated primitives and system orchestration.

2. **The rest of the app must never consume raw third-party indicator outputs directly.**
   - All indicator outputs must pass through the normalization engine.

3. **Autonomous research must search over constrained strategy specs, not arbitrary code.**
   - Strategy discovery operates over normalized primitives, parameter manifests, topology rules, and approved state templates.

4. **State machines must be template-driven, not free-form.**
   - The AI may bind primitives into approved state patterns.
   - It should not invent arbitrary transition graphs by default.

---

## Current State Snapshot

Already present:

- standard-ish primitives:
  - `ma_crossover`
  - `rsi_primitive`
  - `macd_primitive`
  - `macd_histogram`
  - `regime_filter`
  - `fib_location_primitive`
  - `regression_channel_primitive`
- differentiated primitives:
  - `structural_family_signal`
  - base / breakout / Wyckoff / density / wiggle-family tools
  - `fundamental_quality_filter_primitive`
  - `sr_score_primitive`
- state-machine support in strategy specs and execution engine
- builder surfaces that already understand primitive roles and parameter manifests

Current gap:

- the primitive library is not yet normalized into one canonical contract
- standard indicators are incomplete as a coherent core tier
- research does not yet clearly search over a tiered primitive language with autonomy rules

---

## Target Architecture

```text
external indicator libraries
→ source adapters
→ primitive normalization engine
→ canonical primitive registry entries
→ builder/research/validator/scanner/execution consumers
```

### The normalization engine owns

- canonical `pattern_id`
- display metadata
- primitive role
- parameter schema + defaults + bounds
- parameter-manifest compatibility
- output normalization
- warmup/readiness behavior
- chart overlay contract
- autonomy metadata

### External libraries own

- indicator math only

---

## Canonical Primitive Contract

Every normalized primitive must expose:

1. **Identity**
   - `pattern_id`
   - `name`
   - `category`
   - `artifact_type`
   - `composition`

2. **Role**
   - one canonical role such as:
     - `anchor_structure`
     - `location`
     - `timing_trigger`
     - `regime_state`
     - `context`
     - `state_filter`

3. **Parameter contract**
   - tunable params
   - defaults
   - valid bounds
   - sweep/sensitivity flags
   - identity-preserving status

4. **Runtime contract**
   - min data bars
   - warmup handling
   - missing-data behavior
   - output payload shape
   - verdict/signal semantics

5. **Visualization contract**
   - chart overlays / pane behavior
   - display labels

6. **Autonomy metadata**
   - `library_tier`
     - `core_stable`
     - `advanced_experimental`
     - `research_only`
   - `autonomy_safe`
   - `state_compatible`
   - `cost_class`
   - `search_tags`

---

## Execution Sequence

## Phase 0 — Audit and Contract Definition

**Goal:** Define the canonical primitive contract and audit current registry entries against it.

### Deliverables

1. current primitive inventory by role and status
2. canonical primitive contract spec
3. tiering rules for `core_stable`, `advanced_experimental`, `research_only`
4. list of role metadata corrections needed in the registry

### Acceptance criteria

- every existing primitive can be classified into a canonical role or explicitly flagged as ambiguous
- the app has one written contract for imported and custom primitives
- the first “core library” target list is frozen

---

## Phase 1 — Build the Primitive Normalization Engine

**Goal:** Add the adapter + normalization layer that converts raw imported indicator outputs into canonical app primitives.

### Deliverables

1. source adapter interface
2. normalized primitive output schema
3. registry integration path for normalized imported primitives
4. warmup / NaN / readiness normalization behavior

### Acceptance criteria

- the app can call one external source and convert its output into the canonical primitive format
- the rest of the app consumes normalized outputs only

---

## Phase 2 — Import the Standard Indicator Core

**Goal:** Import a standard library of commodity indicators rather than implementing them ad hoc.

### First target set

- `RSI`
- `MACD`
- `MACD histogram`
- `ATR`
- `Bollinger Bands`
- `EMA`
- `SMA`
- moving-average slope / distance
- `ADX`
- `VWAP`
- ROC / momentum
- volume expansion

### Deliverables

1. canonical wrappers for the first core indicators
2. registry entries with normalized metadata
3. chart compatibility
4. builder/discovery compatibility

### Acceptance criteria

- the core indicators are visible as normalized primitives
- they can be used in builders, validator, and scanner without bespoke special cases

---

## Phase 3 — Registry Cleanup and Primitive Tiering

**Goal:** Make the primitive search space safe and legible for autonomous strategy design.

### Deliverables

1. role cleanup across registry entries
2. tier assignment across the library
3. autonomy policy:
   - default search uses `core_stable`
   - optional expansion uses `advanced_experimental`
   - `research_only` gated from broad autonomous search

### Acceptance criteria

- the research engine can query a clean primitive catalog by role and tier
- builders show a more coherent taxonomy

---

## Phase 4 — State-Machine-Aware Autonomy

**Goal:** Allow autonomous creation of stateful strategies using approved templates.

### Approved template families

- `Arm -> Confirm -> Emit`
- `Setup -> Watch -> Trigger / Expire`
- `Detect -> Retest -> Enter`
- `Single-fire breakout / continuation`

### Deliverables

1. template catalog
2. rules for when state is required
3. compiler logic that binds normalized primitives into state templates

### Acceptance criteria

- the research engine can emit a valid `state_machine` config without free-form graph invention
- stateful strategies are only created when sequence logic truly requires memory

---

## Phase 5 — Rebuild Research Studio Around Autonomous Strategy Design

**Goal:** Make `Research Studio` explicitly strategy-discovery-first.

### Desired product shape

- mode separation:
  - `Strategy Discovery`
  - `Symbolic Regression`
- clearer launch semantics:
  - `Start Strategy Research`
  - “leave seed blank to explore from scratch”
  - “enable primitive creation to let the agent invent new building blocks”
- decision-first session details
- explicit view into the primitive tier / search space being used

### Acceptance criteria

- the page clearly explains how to launch autonomous strategy discovery
- the user can understand what the engine will search over before the run starts
- the session detail view becomes decision-first rather than metric-first

---

## Phase 6 — Autonomous Research Policy

**Goal:** Make the research engine behave like a disciplined search system instead of a free-form generator.

### Research lanes

- `Explore from scratch`
- `Guide the search`
- `Repair a promising strategy`
- `Turn a family into a strategy`
- `Invent a new primitive`

### Policy rules

- search over constrained strategy specs
- mutate according to failure cause
- preserve identity during repair
- use primitive invention only when the current library repeatedly fails to express the needed edge

---

## Immediate Execution Start

This workstream is active now.

### Start with

1. audit current primitive registry and roles
2. define the canonical primitive contract in repo docs
3. choose the first external indicator library to adopt as the standard source for commodity indicators
4. implement the first adapter path for one or two indicators

### First concrete execution milestone

`Normalization Engine v0`

Minimum meaning:

- one canonical contract
- one source adapter
- one or two imported indicators normalized end-to-end

---

## Suggested First Imported Indicators

Use these first because they are low controversy, high utility, and useful across research, builder, and scanner:

1. `RSI`
2. `ATR`
3. `EMA` / `SMA`
4. `MACD`

These form the minimum viable imported core.

---

## Open Decisions

1. Which library becomes the canonical commodity-indicator source?
2. Should imported indicators live as generated registry entries or hand-authored wrappers backed by adapters?
3. Which current primitives must be demoted to `research_only` before broad autonomous search is allowed?

---

## Success Condition

This workstream succeeds when:

1. commodity indicators are imported instead of reimplemented
2. imported and custom indicators behave like one normalized primitive library
3. the research engine searches over that library safely
4. `Research Studio` clearly exposes autonomous strategy discovery as a first-class workflow

