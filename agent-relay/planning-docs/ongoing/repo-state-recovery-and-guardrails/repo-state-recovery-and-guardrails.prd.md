# Repo State Recovery and Guardrails Plan

Checklist: repo-state-recovery-and-guardrails-checklist.md

**Status:** ACTIVE
**Created:** 2026-03-30
**Purpose:** Recover the repo from mixed-state drift, align active source-of-truth docs, stabilize the Ledger/PIT/SEC workstream, and put guardrails in place so the repo does not fall back into an ambiguous or untrustworthy state.

---

## Core Problem

The repo is not failing because one subsystem is missing.

The repo is hard to trust because several layers are drifting at once:

- a very dirty git worktree mixes unrelated tracked and untracked work
- active plans and implementation reality are ahead of some older docs
- Ledger data plumbing is real, but not fully contract-hardened
- SEC bulk download state is partially valid (`companyfacts.zip`) and partially broken (`submissions.zip`)
- operational state is not captured tightly enough for clean resumption

This plan fixes those problems in an explicit order and adds prevention rules so the same situation does not accumulate again.

---

## Recovery Goals

1. Restore trust in repo state and diffs
2. Make current source-of-truth docs unambiguous
3. Stabilize the Ledger/PIT/SEC pipeline around a strict contract
4. Separate staged downloads from normalized ingestion
5. Make resumability and active-state visibility first-class
6. Prevent future worktree drift and documentation drift

---

## Phase 1 - Establish a Clean Operational Baseline

### Objective

Make it possible to answer "what changed, why, and is it safe?" without guessing.

### Tasks

- inventory current git state into buckets:
  - active Ledger/PIT/SEC work
  - active scanner/strategy work
  - generated data artifacts
  - stale or abandoned experiments
- create a "do not touch yet" list for ambiguous files
- create a "safe to archive/remove" list for generated clutter and obsolete outputs
- group untracked files by domain:
  - planning docs
  - workspace artifacts
  - datasets / caches / sqlite
  - scripts
  - frontend/backend code
- record the current branch, last commit, and current long-running processes in a single note

### Deliverable

A one-page repo-state snapshot that explains:

- what is intentional
- what is in-progress
- what is generated
- what is unknown

### Exit Criteria

- no important file remains in the "unknown" bucket without an owner or note
- generated artifacts are distinguished from hand-authored code and docs

---

## Phase 2 - Clean the Worktree Safely

### Objective

Reduce repo-wide noise without deleting work that still matters.

### Tasks

- move generated outputs that should not live in git status into ignored or external storage locations
- review untracked planning files and either:
  - adopt them into the active plan set, or
  - archive them into a dated holding area
- review modified tracked files and classify each one:
  - keep active
  - split later
  - revert only with explicit confirmation
- isolate the current Ledger/universe/SEC work into a known working set
- stop using the full repo diff as a proxy for one task's blast radius

### Deliverable

A worktree where:

- task-specific changes can be viewed separately
- generated data no longer obscures code changes
- ambiguous edits are reduced to a manageable shortlist

### Exit Criteria

- `git status` is materially smaller and intelligible
- GitNexus change analysis becomes useful again for active work

---

## Phase 3 - Reconcile Source-of-Truth Documents

### Objective

Make the repo say one coherent thing about what the project is doing now.

### Tasks

- designate current source-of-truth docs for:
  - project state
  - Ledger/PIT/SEC plan
  - universe ownership
  - normalization contract
  - workspace/agent contract
- update stale docs that materially conflict with current execution reality
- add explicit "superseded by" notes to lagging docs instead of leaving silent contradictions
- reconcile the Microsoft smoke-test status across docs
- add a single top-level "active workstreams" index under `agent-relay/planning-docs/`

### Deliverable

One short canonical list of current docs and their authority level.

### Exit Criteria

- README, memory bank, active plans, and probe docs no longer contradict each other on major status claims

---

## Phase 4 - Stabilize the Ledger Data Contract

### Objective

Finish the gating work before any broad normalization rollout.

### Tasks

- freeze the canonical fact schema in practical terms, not just prose
- finalize normalization rules for:
  - period semantics
  - units and scale
  - currency handling
  - derived vs reported values
  - `available_at`
- harden the evidence contract so facts link to stable document references, not fragile markdown-only snippets
- document the app-facing Ledger input contract
- document the app-facing Ledger output contract
- validate the full contract on 2-3 issuers before widening ingestion

### Deliverable

A contract pack consisting of:

- canonical fact schema
- normalization rules
- evidence contract
- Ledger input/output schema

### Exit Criteria

- no broad normalized ingestion proceeds without this contract pack being declared stable

---

## Phase 5 - Repair SEC Bulk and Raw Ingestion Discipline

### Objective

Make the SEC ingestion path reliable and restartable.

### Tasks

- redownload and verify `submissions.zip` integrity
- keep `companyfacts.zip` as the validated bulk baseline
- document the exact bulk-update strategy:
  - nightly bulk refresh
  - incremental live updates
  - targeted raw filing fetches
- add integrity checks for bulk downloads before treating them as usable
- record batch-run summaries in a stable machine-readable format
- keep raw-download staging explicitly separate from Docling normalization

### Deliverable

A reproducible SEC ingestion baseline with verified bulk inputs and resumable raw filing queue behavior.

### Exit Criteria

- both bulk artifacts are either valid and verified or explicitly marked unusable
- raw filing batches can be resumed without ambiguity

---

## Phase 6 - Finish Universe Eligibility Hardening

### Objective

Make the canonical universe match the intended domestic common-stock scope.

### Tasks

- keep the current exclusions for:
  - SPACs / acquisition vehicles
  - ADR/ADS/depositary securities
  - ordinary-share/voting-share variants
  - exchange test issues
- add a second-pass domestic eligibility filter based on filing family or domicile metadata
- distinguish:
  - canonical stock universe
  - Ledger filing-eligible universe
  - validator/smoke-test tiers
- record why symbols are excluded, not just that they are excluded

### Deliverable

A transparent eligibility model instead of ad hoc name filtering.

### Exit Criteria

- foreign common-share edge cases no longer leak into the Ledger filing queue unnoticed

---

## Phase 7 - Add Operational Guardrails

### Objective

Prevent future state drift instead of repeatedly cleaning it up by hand.

### Tasks

- add a repo-state checklist for end-of-session handoff:
  - running jobs
  - active plans
  - data stores touched
  - unfinished batches
  - source-of-truth docs
- add a short active-workstream index in the memory bank
- add a "generated artifacts policy" for large data outputs, sqlite files, caches, and batch summaries
- add a "doc freshness policy" requiring status docs to be updated when smoke-test or pipeline status changes materially
- add integrity verification for critical downloads and imports
- add environment verification steps for test tooling before relying on local test commands
- define when work belongs in:
  - repo code
  - planning docs
  - workspace memory
  - generated data folders

### Deliverable

A lightweight operational playbook that keeps repo state legible over time.

### Exit Criteria

- resuming work after a break does not require reconstructing hidden state from terminal history

---

## Phase 8 - Add Enforcement and Automation

### Objective

Reduce reliance on memory and manual discipline.

### Tasks

- add a repo-state audit script that reports:
  - git status counts
  - large untracked directories
  - running critical jobs
  - critical data files present/missing
  - latest plan docs
- add SEC artifact verification scripts:
  - zip integrity
  - extraction completeness
  - batch summary sanity checks
- add a daily or per-session snapshot note generator for the memory bank
- add a pre-ingestion checklist for Ledger normalization rollout
- add a post-batch report for raw SEC download runs

### Deliverable

Small automation that turns hidden operational state into visible artifacts.

### Exit Criteria

- basic repo health and pipeline status can be checked quickly without manual archaeology

### Practical Thresholds

- `GREEN`
  - <= 15 changed files
  - <= 10 `backend/data` entries in status
  - safe to keep working on the current slice
- `YELLOW`
  - <= 40 changed files
  - <= 20 `backend/data` entries in status
  - finish the current slice, then checkpoint soon
- `RED`
  - above either threshold
  - do not start another unrelated initiative before checkpointing

---

## Recommended Execution Order

1. Establish a clean operational baseline
2. Clean the worktree safely
3. Reconcile source-of-truth docs
4. Stabilize the Ledger data contract
5. Repair SEC bulk and raw ingestion discipline
6. Finish universe eligibility hardening
7. Add operational guardrails
8. Add enforcement and automation

Do not widen broad Ledger normalization or ingestion scale until phases 1-6 are materially complete.

---

## Definition of Done

This cleanup effort is done when all of the following are true:

- the repo has a legible worktree
- active docs agree on current status
- Ledger schema, normalization, and evidence contracts are explicit
- SEC bulk inputs are verified
- raw filing queue state is resumable and documented
- universe eligibility is transparent
- session continuity is captured without hidden terminal state
- basic repo-state checks are scriptable

---

## Prevention Rules

- Do not let generated data and handwritten code share the same status bucket without labeling
- Do not treat a download as ready until integrity is verified
- Do not treat a successful probe as a scalable pipeline until the contract is stable
- Do not update one status doc without updating the canonical status surfaces
- Do not widen universe-driven ingestion without a transparent eligibility model
- Do not end a session with hidden running jobs or hidden active assumptions
- Do not let mutable runtime state write into tracked repo files when a local/ignored path will do
- Do not let generated strategy variants, sweep winners, or rebuildable registry outputs accumulate silently in the same visible bucket as hand-authored source
- Before ending a session, run:
  - `git status --short`
  - `powershell -ExecutionPolicy Bypass -File backend/scripts/check_repo_state.ps1`
  - update `memory-bank/LATEST.md` if status or source-of-truth meaning changed materially
