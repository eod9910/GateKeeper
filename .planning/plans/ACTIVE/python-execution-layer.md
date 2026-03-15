# Python Execution Layer

Status: Active  
Owner: Scanner / Validator / Plugin Runtime  
Last Updated: 2026-03-06

## Purpose

Keep one source of truth for the Python execution architecture.

This plan replaces the old split between:

- `python-execution-layer.md`
- `python-execution-phase1-rollout.md`

The architecture goal is still the same:

1. stop paying spawn-per-call overhead everywhere
2. keep Python-side execution fast enough for scanner and validator workloads
3. preserve a safe Node fallback while the service path matures
4. move hot loops to compiled paths only where that actually matters

## Current State

What already exists:

- persistent Python plugin service scaffold is in place
- Node client routing exists with service-first and fallback behavior
- scanner single and batch paths can use the service
- validator can use the service path
- scan parallelization is already shipped
- Numba hot-loop acceleration and warmup support are already present

What is still unfinished:

- hard parity verification between service and spawn paths
- clearer operational ownership of the service path
- stricter plugin/runtime safety model
- reduction of remaining legacy scanner execution paths

## Architecture

```text
Frontend / Node routes
    -> TypeScript backend
    -> Python plugin service
       -> cached data
       -> plugin registry
       -> compiled hot loops where useful
       -> fallback-compatible result contract
```

## Principles

### 1. Keep Python for strategy/plugin logic

Python remains the right execution language for:

- plugin authoring
- scientific/data tooling
- flexible AI-generated logic
- fast experimentation

Do not replace that with a custom DSL.

### 2. Compile only the hot loops

Use compiled paths only for math-heavy primitives:

- indicators
- rolling statistics
- swing helpers
- repeated numeric loops

Do not force all plugin logic into restricted compiled code.

### 3. Maintain a safe fallback

The spawn path remains a recovery path until parity and reliability are fully proven.

### 4. Service path is the target architecture

Long term, scanner and validator should treat the persistent Python service as the default runtime, not the experimental path.

## Delivered Phases

### Phase 1A: Immediate validator speed wins

Completed:

- tier-aware validator runtime profiles
- reduced heavy robustness work for lighter tiers
- early-stop pass/fail behavior
- validator fast-path optimizations

### Phase 1B: Persistent Python service scaffold

Completed:

- `backend/services/plugin_service.py`
- Node client integration
- feature-flagged routing
- fallback to spawn path
- scanner service endpoints

### Phase 1B+: Scan parallelization

Completed:

- parallel prefetch
- parallel CPU work
- dynamic client timeout handling
- unified backend dev startup

### Phase 1C: Service integration

Partially complete:

- scanner service routing works
- validator service routing works
- fallback remains intact
- parity verification is still incomplete

### Phase 1D: Numba acceleration

Completed:

- compiled indicator helpers
- RDP cache improvements
- warmup path
- validator-side cache management

## Remaining Work

### Priority 1: Parity and trust

1. add deterministic parity checks for scanner outputs
2. add deterministic parity checks for validator outputs
3. fail loudly when service output breaks the expected contract

### Priority 2: Service-first operations

1. treat the Python service as the normal runtime path
2. improve health reporting and diagnostics
3. document restart/failure behavior clearly

### Priority 3: Runtime hardening

1. tighten plugin execution restrictions
2. reduce uncontrolled file/system access from generated code
3. make plugin loading and execution safer without destroying iteration speed

### Priority 4: Remove legacy drift

1. finish legacy plugin conversion into the unified plugin path
2. reduce direct reliance on old `patternScanner.py` execution branches
3. keep one runtime contract regardless of execution path

## Success Criteria

This plan is done when:

1. scanner and validator default to the service path
2. parity checks cover service vs fallback behavior
3. legacy execution paths are reduced to true fallback status
4. plugin execution safety is materially better than today
5. the service is operationally boring to run locally

## Commands

```bash
cd backend
npm run dev
npm run py:service
npm run node:dev:no-py
npm run build
npm test
```

## Related Plans

- `ACTIVE/legacy-plugin-conversion-plan.md`
- `ACTIVE/backtesting-master.md`
- `ACTIVE/research-to-live-trading.md`
