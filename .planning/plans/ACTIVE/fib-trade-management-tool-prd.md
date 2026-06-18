# Fib Trade Management Tool PRD

Checklist: fib-trade-management-tool-checklist.md

## Objective

Add a literal dual-mode Trade Fib drawing tool alongside the regular Fib tool:

- Regular `Fib` remains a plain Fibonacci drawing.
- New `Trade Fib` is a dual-mode fib object.
- Trade Fib structure mode defines the swing/invalidating structure and entry fib level.
- Trade Fib management mode locks that structure and changes the visible scale into a second fib: `0% = entry`, `100% = structure target`, negative percentages = adverse/stop-extension area, positive percentages between `0%` and `100%` = TP progress.

This workstream starts with the fib itself before building optimizer or coach translation layers.

## Problem

The current training module can draw a regular fib and derive entry/stop/target from it, but there is no purpose-built dual-mode Trade Fib tool. The system needs a separate drawing tool that can preserve trade-management intent without changing normal fib behavior.

- Which entry fib was being tested?
- Where are stop-extension candidates beyond the 100/invalidation side?
- How far toward the prior high/low target do TP levels sit?
- Which fib state should the resolver/coach use when measuring later trade behavior?

## Phase One Scope

Implement the first useful slice:

1. A separate `Trade Fib` appears in the drawing toolbar.
2. A placed Trade Fib starts in structure mode.
3. A placed Trade Fib can be switched into management mode.
4. The original fib anchors remain locked as structure metadata.
5. In management mode, the drawing replaces the visible structure scale with:
   - `0%` at the actual/planned entry
   - negative adverse percentages under/against entry
   - positive TP-progress percentages between entry and target
   - `100%` at the structure target
6. The normalized training drawing payload preserves these fib-management fields.
7. The backend accepts and stores those fields on training attempts.
8. Resolved attempts record objective manage-fib excursion:
   - max adverse excursion from entry as a negative/absolute stop-candidate percentage
   - max favorable excursion toward the structure target as a TP-progress percentage
   - structure stop percentage as a reference, not a forced stop

## Out Of Scope For Phase One

- Full stop optimizer rankings.
- TP optimizer with partial-exit simulations.
- Full stop/TP recommendation optimizer UI.
- Per-trade hover tooltip for MAE/MFE.
- Dedicated React/editor rewrite.

Those belong to later checklist items after the fib object exists.

## Data Model

Training fib drawings may include optional metadata:

- `mode`: `structure` or `trade_management`
- `direction`: `long` or `short`
- `entryFibLevel`: number, percentage style such as `78.6`
- `actualEntryPrice`
- `targetPrice`
- `stopExtensionLevels`: percentage values such as `[0, -5, -10, -15, -20]`
- `tpProgressLevels`: percentage values such as `[25, 50, 75, 100]`
- `lockedStructure`: boolean
- `selectedStopLevel`: optional stop candidate percentage for R-label calculations

Resolved attempts may include `fibTradeExcursion`:

- `maxAdversePct`: worst adverse move after entry in manage-fib percent
- `maxFavorablePct`: best favorable move after entry in manage-fib percent
- `structureStopPct`: where the old structure extreme sits in manage-fib percent
- `reached25`, `reached50`, `reached75`, `reached100`

## Acceptance Criteria

- User can draw a normal fib and still use it as before.
- User can click a trade-management control and see stop-extension and TP progress overlays.
- Entry, stop, and TP seeding from fib still works.
- Attempts created from a trade-management fib include the fib metadata.
- Resolved attempts expose manage-fib MAE/MFE so the coach can compare candidate stops and TP progress objectively.
- Existing box/range workflows are not changed.
- Frontend syntax and backend TypeScript build pass.
