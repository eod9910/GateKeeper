# Trading Desk / Execution Desk Industrialization Plan

Status: Active  
Owner: Trading Desk / Execution Desk / Position Book  
Last Updated: 2026-03-12

## Purpose

Capture the current state of the Trading Desk and Execution Desk workflow cleanup, record what has already been built, and define the remaining work in a low-credit-friendly order.

This plan is the continuity document for the current push to:

- enforce the intended `Scanner -> Trading Desk -> Execution Desk -> Position Book` flow
- separate scanner entry logic from Trading Desk risk/exit planning
- move toward a shared frontend trade-plan state model
- break large frontend files into maintainable modules
- reduce duplicate risk/account settings across Trading Desk, Execution Desk, and Settings

## Current Product Direction

The intended workflow is:

1. Scanner finds entry candidates only.
2. Trading Desk owns the trade plan.
   - side
   - entry
   - stop
   - take profit
   - size
   - broker route
   - order ticket type
3. Execution Desk owns order submission, broker reconciliation, and broker-native protection updates.
4. Position Book only shows executed or reconciled positions.

This means:

- scanner strategy packages do not remain the runtime source of truth for stops and targets
- stop/target planning belongs in Trading Desk
- Execution Desk should not be the place where trades originate
- Position Book should not become a workaround for missing execution flow

## What Has Been Completed

### 1. Workflow corrections

- Trading Desk is now the origin for manual order handoff into Execution Desk.
- Trading Desk and chart interactions share the same risk-plan state for:
  - entry
  - stop
  - take profit
  - side
- explicit trade-side controls were restored in Trading Desk route controls
  - side can be inferred from entry/stop/target geometry
  - side can still be manually overridden
- a pre-send route summary now shows the intended trade before handoff to Execution Desk
- `Execution` was renamed visibly to `Execution Desk`

### 2. Shared trade-plan state

- A shared frontend trade-plan store was added in:
  - [trade-plan-store.js](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/frontend/public/trade-plan-store.js)
- Scanner, Trading Desk, and Execution Desk now share a common active trade-plan path through:
  - [ai-handoffs.js](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/frontend/public/ai-handoffs.js)
  - [trade-intent.js](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/frontend/public/trade-intent.js)
- Trading Desk now bootstraps from and syncs into the active trade plan instead of relying only on one-off local storage handoff objects.

### 3. Trading Desk UI cleanup

- `Desk Setup` was removed and its controls were redistributed into the working area.
- timeframe selection moved into the chart header
- saved content moved below trade actions
- instrument details were moved into trade actions / instrument settings
- top `Long / Short` control was removed from the old header and moved into routing context
- chart loads without the old automatic fib clutter
- chart header keeps entry/stop/target actions
- drawing tools moved into a grouped left-rail toolbar

### 4. Shared chart toolbar direction

- the grouped drawing toolbar is now the default shared chart behavior used by the app chart layer
- Trading Desk pattern tools now include TradingView-style pattern drawings:
  - XABCD
  - Cypher
  - Head and Shoulders
  - ABCD
  - Triangle
  - Three Drives

### 5. Robinhood / broker work already completed

- Robinhood read-only auth and position fetch were added
- Robinhood account values can now be surfaced in broker status
- OANDA live stop/take-profit values are used in Execution Desk instead of stale local suggestions
- Execution Desk position rows are clickable and open a unified adjustment flow
- broker settings were moved into per-broker modal interaction instead of one shared broker-settings card

Important boundary:

- Robinhood order submission is still not wired
- Robinhood support is currently read-only plus reconciliation/mirroring oriented

### 6. Trading Desk file refactor already completed

The old Trading Desk logic has been split into focused modules.

Current files:

- [copilot-trading.js](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/frontend/public/copilot-trading.js) - `527` lines
- [copilot-analysis.js](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/frontend/public/copilot-analysis.js) - `946` lines
- [copilot-trade-plan-sync.js](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/frontend/public/copilot-trade-plan-sync.js) - `195` lines
- [copilot-risk-plan.js](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/frontend/public/copilot-risk-plan.js) - `260` lines
- [copilot-chat.js](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/frontend/public/copilot-chat.js) - `166` lines
- [copilot-trade-actions.js](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/frontend/public/copilot-trade-actions.js) - `357` lines
- [copilot-execution-route.js](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/frontend/public/copilot-execution-route.js) - `250` lines

This is materially better than the previous single-file Trading Desk implementation.

### 7. Verification already completed

Syntax verification passed for the Trading Desk module set with `node --check`.

Known verification gap:

- no browser click-through regression pass was completed after the latest module split

## What Is Still Weak

Even after the Trading Desk split, the app is not yet industrial-grade.

Current weak points:

- Execution Desk still lives mostly inside one very large inline script in [execution.html](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/frontend/public/execution.html)
- Position Book logic is still concentrated in one large file, [history.js](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/frontend/public/history.js)
- Workshop still has a very large scanner/workbench file in [workshop-scanner.js](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/frontend/public/workshop-scanner.js)
- backend routing is still too large in:
  - [candidates.ts](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/backend/src/routes/candidates.ts)
  - [execution.ts](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/backend/src/routes/execution.ts)
- Position Book, Execution Desk, and broker reconciliation still do not share one formal execution/position contract end to end
- some broker flows are still UI-driven instead of adapter-driven
- the system still depends too much on manual testing

## Remaining Large Files

These are the next maintainability risks:

- [execution.html](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/frontend/public/execution.html) - `2404` lines
- [history.js](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/frontend/public/history.js) - `2421` lines
- [workshop-scanner.js](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/frontend/public/workshop-scanner.js) - `2910` lines
- [candidates.ts](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/backend/src/routes/candidates.ts) - `1513` lines
- [execution.ts](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/backend/src/routes/execution.ts) - `727` lines

## What Is Left To Be Done

### Phase 1. Stabilize the Trading Desk split

Before more large refactors:

- do a browser click-through regression pass on Trading Desk
- verify:
  - symbol switching
  - analysis reruns
  - chart click entry/stop/target sync
  - risk plan modal sync
  - route summary
  - send-to-execution handoff
  - save/open-position behavior
- fix any cross-module load-order or global dependency issues that show up after the split

### Phase 2. Refactor Execution Desk

Primary target:

- extract the large inline logic from [execution.html](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/frontend/public/execution.html) into real JS modules

Suggested split:

- `execution-store-sync.js`
- `execution-brokers.js`
- `execution-positions.js`
- `execution-ticket-panel.js`
- `execution-bridge-controls.js`
- `execution-robinhood.js`
- `execution-log.js`

Goals:

- remove app logic from inline HTML
- make broker settings, broker status, and broker actions explicit modules
- isolate Robinhood auth/read-only flows from core Execution Desk rendering

### Phase 3. Formalize execution and reconciliation state

Create a formal frontend execution state model that complements the trade-plan store.

Needed slices:

- pending execution ticket
- broker submission result
- broker reconciliation state
- adopted external position state
- execution-to-position-book handoff record

Key rule:

- Position Book should render reconciled execution outcomes, not ad hoc mixed-source objects

### Phase 4. Refactor Position Book

Primary target:

- split [history.js](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/frontend/public/history.js)

Suggested split:

- `position-book-render.js`
- `position-book-persistence.js`
- `position-book-imports.js`
- `position-book-risk-math.js`
- `position-book-actions.js`

Goals:

- separate rendering from broker import/mirror logic
- stop mixing local persistence, risk calculations, and UI behavior in one file
- formalize the position object contract

### Phase 5. Split backend route files

Primary targets:

- [execution.ts](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/backend/src/routes/execution.ts)
- [candidates.ts](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/backend/src/routes/candidates.ts)

Suggested split for `execution.ts`:

- broker settings/status routes
- execution ticket routes
- broker protection / close routes
- Robinhood auth routes
- bridge / log routes

Suggested split for `candidates.ts`:

- scanner request handling
- symbol normalization
- copilot scan path
- result shaping / response mapping

Goals:

- shrink route files
- reduce route-level business logic
- make services the place where real behavior lives

### Phase 6. Refactor Workshop

Primary target:

- [workshop-scanner.js](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/frontend/public/workshop-scanner.js)

Goals:

- split state management from rendering
- split scanner actions from workbench-specific UI
- reuse the same chart / state conventions already established in Trading Desk

### Phase 7. Finish the product-model cleanup

These are still open product-architecture items:

- make Trading Desk the only place where new trade plans originate
- ensure Execution Desk only executes or reconciles those plans
- remove remaining duplicate risk/account controls that belong in Settings
- keep bridge controls limited to automation/scan orchestration, not discretionary stop/target ownership
- formalize the `trade plan -> execution ticket -> reconciled fill -> position` lifecycle

## Recommended Build Order

Because credits are limited, the remaining work should be resumed in this order:

1. Trading Desk click-through regression pass
2. split Execution Desk inline logic out of [execution.html](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/frontend/public/execution.html)
3. introduce an execution-state store / reconciliation contract
4. split [history.js](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/frontend/public/history.js)
5. split backend [execution.ts](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/backend/src/routes/execution.ts)
6. split backend [candidates.ts](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/backend/src/routes/candidates.ts)
7. split [workshop-scanner.js](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/frontend/public/workshop-scanner.js)

## Practical Stop Rule

If credits are tight, do not keep refactoring opportunistically.

Only resume refactoring when one of these is true:

- a file is actively blocking a feature
- a bug fix is unsafe without the split
- a module already has a clean seam and can be split in one contained pass

Otherwise, continue product work and treat this plan as the queue for later cleanup.

## Acceptance Criteria

This plan is complete when:

1. Trading Desk, Execution Desk, and Position Book each use explicit shared state contracts instead of page-local workflow state
2. [execution.html](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/frontend/public/execution.html) no longer contains the current large inline application script
3. [history.js](C:/Users/eod99/OneDrive/Documents/Coding/pattern-detector/frontend/public/history.js) is split into focused modules
4. backend execution and candidate route files are split by concern
5. the `Scanner -> Trading Desk -> Execution Desk -> Position Book` lifecycle is enforced by code structure, not just UI convention
6. regression testing exists for the critical trade lifecycle
