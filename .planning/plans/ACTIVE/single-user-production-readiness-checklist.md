# Single-User Production Readiness Checklist

Date: 2026-02-15  
Scope: Pattern Detector as a **single-user** system that is safe for real-money decision support (not multi-tenant SaaS).

## 1) What "Production-Ready (Single User)" Means

This standard does **not** require:
- Multi-tenant auth/roles.
- Public cloud autoscaling.
- Enterprise compliance packaging.

This standard **does** require:
- Deterministic, reproducible research outputs.
- Strong plugin/code execution safety.
- Reliable data handling and cache/freshness behavior.
- Real risk controls for any live execution path.
- Basic observability, recovery, and repeatable release process.

## 2) Scoring Model

Scale per domain:
- `0` = missing
- `1` = partial / fragile
- `2` = mostly complete
- `3` = strong

Weighted score target for single-user production: **>= 75/100**.

## 3) Current Score (Evidence-Based)

| Domain | Weight | Score (0-3) | Weighted |
|---|---:|---:|---:|
| Validation architecture & statistical gating | 20 | 2.5 | 16.7 |
| Data pipeline & caching | 15 | 2.0 | 10.0 |
| Determinism & testing | 15 | 2.0 | 10.0 |
| Security & isolation (plugin/runtime/API) | 20 | 0.8 | 5.3 |
| Reliability & observability | 15 | 1.5 | 7.5 |
| Live execution risk controls | 15 | 1.0 | 5.0 |
| **Total** | **100** |  | **54.5 / 100** |

Verdict: **Serious research platform; not yet single-user production-ready for autonomous/live execution.**

## 4) Checklist with Status

### A. Validation Architecture

- [x] Tiered validation universes by asset class are implemented.
  - Evidence: `backend/src/routes/validator.ts:61`, `backend/src/routes/validator.ts:433`
- [x] Tier-based gating and pass dependencies exist (Tier2 requires Tier1 PASS, Tier3 requires Tier2 PASS).
  - Evidence: `backend/src/routes/validator.ts:515`
- [x] Tier-specific trade thresholds are now implemented.
  - Evidence: `backend/services/validatorPipeline.py:124`, `backend/services/validatorPipeline.py:454`
- [~] Statistical thresholds exist but still need periodic calibration against real strategy distribution.
  - Evidence: `backend/services/validatorPipeline.py:134`

### B. Data & Caching

- [x] Validator snapshot cache exists (symbol set + interval + date window keyed).
  - Evidence: `backend/services/validatorPipeline.py:50`, `backend/services/validatorPipeline.py:487`, `backend/services/validatorPipeline.py:558`
- [x] Snapshot reuse is surfaced in report metadata.
  - Evidence: `backend/services/validatorPipeline.py:740`
- [x] Invalid-symbol cache exists to avoid repeated failing downloads.
  - Evidence: `backend/services/validatorPipeline.py:35`, `backend/services/validatorPipeline.py:213`
- [~] No explicit snapshot TTL/expiry policy yet (cache freshness policy incomplete).
  - Evidence: snapshot mechanism exists but no expiry gate in `backend/services/validatorPipeline.py`

### C. Determinism & Testing

- [x] Deterministic spec hash exists.
  - Evidence: `backend/src/services/storageService.ts:41`
- [x] Python fixture regression tests exist, including hash parity test.
  - Evidence: `backend/tests/test_validator_fixtures.py:1`, `backend/tests/test_validator_fixtures.py:120`
- [~] Build script exists, but no dedicated backend test script in package scripts.
  - Evidence: `backend/package.json` (no `test` script)
- [~] CI pipeline/workflows are not present in repository.
  - Evidence: no project workflows under `.github/workflows` (excluding `node_modules`)

### D. Security & Isolation

- [ ] Plugin test path executes arbitrary Python source via `exec(...)` in process context.
  - Evidence: `backend/src/routes/plugins.ts:258`
- [ ] Plugin test harness is spawned directly with system Python, no sandbox boundary.
  - Evidence: `backend/src/routes/plugins.ts:302`
- [ ] API has no auth middleware (all routes open inside reachable network context).
  - Evidence: `backend/src/server.ts:44`, `backend/src/server.ts:46`
- [ ] CORS is permissive by default for all origins.
  - Evidence: `backend/src/server.ts:30`

### E. Reliability & Observability

- [x] Validator async jobs are tracked and persisted; stale-job recovery exists.
  - Evidence: `backend/src/routes/validator.ts:52`, `backend/src/routes/validator.ts:116`
- [x] Active run polling and cancellation endpoint exist.
  - Evidence: `backend/src/routes/validator.ts:670`, `backend/src/routes/validator.ts:680`
- [x] Health endpoint exists.
  - Evidence: `backend/src/server.ts:49`
- [~] Logging is mostly ad-hoc console/stderr, not structured telemetry with severity/context schema.
  - Evidence: multiple console/stderr patterns in `backend/src/routes/validator.ts`, `backend/services/validatorPipeline.py`

### F. Live Execution Risk Controls

- [x] Execution rule engine exists (daily cap, time stop, green-to-red, ladder, etc.).
  - Evidence: `backend/src/services/executionEngine.ts:79`
- [ ] Execution rule engine is not wired into an actual live order-routing runtime.
  - Evidence: `evaluateExecutionRules` references only in `backend/src/services/executionEngine.ts`
- [ ] No broker integration path found in backend (order placement/reconciliation runtime missing).
  - Evidence: no backend broker/order router service under `backend/src` or `backend/services`

## 5) Top Blocking Gaps (P0)

1. **Plugin isolation/sandboxing**
   - Replace unrestricted `exec` path with restricted runtime boundary (filesystem/network/import limits, CPU/memory/time quotas).

2. **Access control for local production use**
   - Add at least single-user auth gate (local token/session) + tighter CORS for non-local origins.

3. **Live execution safety path**
   - Either:
   - Keep system explicitly "research-only" (no live order path), or
   - Implement broker adapter + reconciliation + fail-closed kill switch path before any automation.

4. **Cache freshness policy**
   - Add snapshot TTL and "force refresh" switch for validator runs.

## 6) Near-Term Upgrade Plan (Recommended)

### Phase 1 (1-2 weeks)
- Add snapshot TTL + refresh flag in validator run config.
- Add structured run logs (run_id, strategy_version_id, tier, asset_class, symbol_count, elapsed, verdict).
- Add `npm test` script + Python test command wiring.

### Phase 2 (2-4 weeks)
- Implement restricted plugin execution boundary.
- Add local auth + CORS restriction defaults.
- Add immutable run artifacts index (append-only metadata log).

### Phase 3 (4-6 weeks)
- Decide explicit mode:
- `Research mode` (no order routing), or
- `Execution mode` with broker adapter, reconciliation, and operational kill switches.

## 7) Practical Conclusion

This is **not a toy**.  
It is a capable research/validation system with strong momentum, but it still needs security and runtime hardening before it should be trusted as a production execution system, even for one user.

