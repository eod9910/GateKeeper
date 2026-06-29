# Financial Data Execution Plan - 2026-03-30

**Status:** ACTIVE
**Created:** 2026-03-30
**Purpose:** Execute the next concrete financial-data steps needed to make the Ledger/PIT/SEC foundation trustworthy and restartable.

---

## Goal

Move the financial-data layer from "real but partially mixed and partially verified" to:

- bulk SEC inputs verified
- PIT coverage complete for the current canonical universe
- old-universe PIT spillover removed
- Ledger-facing data contract explicit
- repeatable verification available
- status docs synchronized with actual repo state

---

## Scope For This Pass

This pass is intentionally limited to the work that is both high-value and safe to execute now.

Included:

1. repair SEC bulk baseline
2. verify PIT coverage against the current clean universe
3. verify and document bulk artifact health
4. define the Ledger financial-data input/output contract
5. synchronize docs with actual current state

Excluded for this pass:

- broad normalization rollout
- contract-breaking schema churn
- large-scale filing extraction beyond current guarded staging
- speculative metric expansion before the contract is hardened

---

## Execution Steps

### 1. Contract Layer

- create an explicit Ledger financial-data contract for what the app should provide to the Financial Analyst workspace
- define the expected analysis output shape back to the app
- keep this contract separate from the lower-level canonical fact schema

### 2. SEC Bulk Repair

- redownload `submissions.zip`
- verify archive integrity before treating it as usable
- preserve `companyfacts.zip` as the currently valid bulk baseline

### 3. PIT Coverage Cleanup

- confirm hydration coverage against the current `clean_stocks` universe
- hydrate any remaining symbols
- remove PIT rows for symbols outside the current canonical universe
- preserve filing-derived document tables during cleanup
- take a database backup before pruning

### 4. Verification Tooling

- add one repeatable script that reports:
  - bulk ZIP validity
  - PIT table counts
  - current-universe hydration coverage
  - symbols outside the current universe
  - filing-derived table counts

### 5. Status Sync

- update probe docs to reflect the real current state
- update memory-bank status notes so future sessions do not rely on terminal archaeology

---

## Success Criteria

This pass is successful when all of the following are true:

- `submissions.zip` is verified or explicitly recorded as still unusable
- PIT coverage is complete for the current clean universe
- old-universe PIT spillover is removed
- a reusable verification script exists and runs successfully
- the Financial Analyst workspace has an explicit input/output data contract
- the main financial-data status docs agree on the current state

---

## Follow-On Work After This Pass

1. harden normalization rules
2. harden evidence contract
3. validate on a third issuer
4. only then widen normalized filing ingestion
