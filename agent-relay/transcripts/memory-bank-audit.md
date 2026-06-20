# Agent Relay Transcript: memory-bank-audit

Generated: 2026-06-20T14:10:41Z

## 1. Validator -> Builder: Audit memory-bank before cleanup

- Routing ID: `route-20260616-021831-validator-to-builder-cccbb691`
- Type: `directive`
- Phase: `memory-bank-audit`
- Timestamp: `2026-06-16T02:18:31Z`
- Original: `agent-relay/roles/Validator/directives/2026-06-16-memory-bank-audit-builder-directive.md`
- Body: `agent-relay/messages/route-20260616-021831-validator-to-builder-cccbb691.md`
- SHA-256: `ae80a860ee8168723deb7009ff1a8e12fabb6375dcb66c9e99cfee73485e5650`

### Validator Directive: Memory Bank Audit And Cleanup Plan

- Date: 2026-06-16
- Phase: memory-bank-audit
- From: Validator
- To: Builder
- Work tier: Tier 2 governance/continuity infrastructure

#### Mediator Intent

The Agent Relay and dated Codex transcript system now carry the serious
auditable continuity trail. The older `memory-bank/` may contain useful context,
but it may also contain stale, duplicated, or misplaced governance material.

Do not delete or move memory files yet. First produce an inventory and cleanup
proposal.

#### Required Work

Audit `memory-bank/` and classify files into these buckets:

1. Keep as active startup memory.
2. Keep as dated/searchable transcript history.
3. Archive as historical context.
4. Move governance rules into contracts or role files.
5. Move role conversation records into `agent-relay/`.
6. Ignore/delete generated or stale junk, only after Validator/User approval.

#### Required Output

Create a Builder report under:

```text
agent-relay/roles/Builder/reports/
```

The report must include:

- inventory of top-level `memory-bank/` files and transcript folders;
- recommended classification for each file/folder;
- any files that look sensitive or unsafe to publish;
- any files that duplicate `agent-relay/`, `TRI_AGENT_CODING_CONTRACT.md`,
  `AGENT_OPERATING_CONTRACT.md`, or `memory-bank/CODEX_MEMORY_POLICY.md`;
- a proposed cleanup sequence that avoids data loss.

#### Constraints

- Do not delete files.
- Do not move files.
- Do not rewrite historical transcripts.
- Do not change contracts yet.
- Treat ambiguous memory as archive/keep until Editor and Validator review it.



---

## 2. Validator -> Editor: Review memory-bank audit criteria

- Routing ID: `route-20260616-021832-validator-to-editor-a5bca88c`
- Type: `directive`
- Phase: `memory-bank-audit`
- Timestamp: `2026-06-16T02:18:32Z`
- Original: `agent-relay/roles/Validator/directives/2026-06-16-memory-bank-audit-editor-directive.md`
- Body: `agent-relay/messages/route-20260616-021832-validator-to-editor-a5bca88c.md`
- SHA-256: `c107da174fb29516a9c6dbe2151a30ce364a476ed1d3c35dae161aa27e05fc8b`

### Validator Directive: Review Memory Bank Audit Criteria

- Date: 2026-06-16
- Phase: memory-bank-audit
- From: Validator
- To: Editor
- Work tier: Tier 2 governance/continuity infrastructure

#### Request

Prepare to review Builder's `memory-bank/` audit and cleanup proposal.

#### Editor Review Standard

When Builder reports back, check whether the proposal:

- preserves disaster-recovery memory;
- keeps the Agent Relay as the official role-communication record;
- keeps `memory-bank/` focused on broader conversation/context memory;
- moves governance rules into contracts instead of leaving duplicate law in
  memory files;
- avoids deleting or moving ambiguous historical material without approval;
- clearly distinguishes active startup memory from archived context.

#### Blocker Criteria

Record an `EDITOR BLOCKER` if Builder proposes:

- deletion of historical memory without a recoverable archive;
- moving role-governance records out of the relay;
- making raw offline transcript mirrors trackable;
- weakening the Codex memory policy;
- leaving duplicate contradictory rules in multiple places.

#### Required Output

After Builder submits the inventory, return an Editor report to Validator with:

- no blocker / blocker status;
- classification concerns;
- recommended corrected cleanup sequence;
- whether Builder or Editor should perform the next step.



---

## 3. Builder -> Validator: Memory-bank audit builder report

- Routing ID: `route-20260616-022142-builder-to-validator-fc1ebdb9`
- Type: `report`
- Phase: `memory-bank-audit`
- Timestamp: `2026-06-16T02:21:42Z`
- Original: `agent-relay/roles/Builder/reports/2026-06-16-memory-bank-audit-builder-report.md`
- Body: `agent-relay/messages/route-20260616-022142-builder-to-validator-fc1ebdb9.md`
- SHA-256: `761b0182611fa58bc1e92080166ec1d41ce5210d3b1f2fd6e2e0846926d89410`

### Builder Report: Memory-Bank Audit

Date: 2026-06-16
Phase: memory-bank-audit
Source: Builder
Target: Validator

#### Scope

Builder inventoried `memory-bank/` to determine what still belongs in active memory, what should become historical archive material, and what needs cleanup policy before any move or deletion.

Builder did not move, delete, or rewrite memory files during this audit.

#### Inventory Summary

##### Active Startup / Continuity Memory

- `memory-bank/CODEX_CONTINUITY.md`
  - Active Codex continuity file.
  - Small enough to serve as compact startup memory.
  - Should remain active.

- `memory-bank/CODEX_MEMORY_POLICY.md`
  - Active policy file for Codex memory behavior.
  - Should remain active and should be the canonical policy location for Codex memory rules.

- `memory-bank/PHASE.md`
  - Small phase marker currently containing `REFINE`.
  - Should remain until its runtime use is confirmed.

- `memory-bank/CURSOR_CONTINUITY.md`
  - Cursor-specific continuity file.
  - Should remain if Cursor is still part of the workflow, but should not be treated as Codex startup memory unless explicitly referenced by Codex-facing instructions.

##### Legacy Catch-All Memory

- `memory-bank/CHAT_MEMORY.md`
- `memory-bank/LATEST.md`

Builder classifies these as legacy catch-all memory files. They contain useful historical material, but they are too large and too mixed to serve as stable startup memory now that the repo has:

- `AGENTS.md`
- `AGENT_OPERATING_CONTRACT.md`
- `TRI_AGENT_CODING_CONTRACT.md`
- `memory-bank/CODEX_CONTINUITY.md`
- `memory-bank/CODEX_MEMORY_POLICY.md`
- `agent-relay/`

Builder recommends treating these as read-on-demand historical archive files until a later extraction pass identifies rules that still belong in canonical contracts.

##### Reference / Historical Project Memory

- `memory-bank/BASE_METHOD_TOMBSTONES.md`
- `memory-bank/GSD_REFERENCE.md`
- `memory-bank/PLATFORM_SDK_GUIDE.md`
- `memory-bank/PRIMITIVE_AUDIT_REPORT.md`
- `memory-bank/RSI-SUB-PANEL-TEST-REPORT.md`
- `memory-bank/PRDs/`

Builder classifies these as reference/history files, not active agent startup memory.

Some of these may eventually belong under `.planning/plans/REFERENCE/` or `.planning/plans/ARCHIVE/`, but Builder recommends not moving them during this audit because the planning tree already has substantial unrelated changes.

##### Transcript Archive

Builder found historical transcript material under `memory-bank/transcripts/`, including:

- old ChatGPT/Cursor/Codex conversation exports
- strategy and validator transcripts
- `memory-bank/transcripts/cursor-session-live.md`
- `memory-bank/transcripts/codex-session-live.md`
- `memory-bank/transcripts/codex/YYYY-MM-DD/`

Builder classifies `memory-bank/transcripts/codex-session-live.md` as the active rolling Codex mirror.

Builder classifies older transcript exports as historical archive material. They are useful for recall and forensic reconstruction, but they should not be startup-loaded wholesale.

#### Issue Found

Builder found that the dated Codex snapshot system is currently too noisy.

The directory `memory-bank/transcripts/codex/2026-06-15/` contains many near-duplicate files, roughly one every mirror interval, each about 541 KB to 560 KB, plus `latest.md`.

This creates unnecessary repository churn and storage growth. The likely intended design is:

- one rolling live transcript
- one daily latest pointer
- occasional durable checkpoints

The current behavior appears to create a new durable checkpoint every mirror pass.

#### Builder Recommendation

Builder recommends the next cleanup phase proceed in this order:

1. Fix Codex transcript snapshot cadence before moving or deleting historical memory.
2. Keep `memory-bank/CODEX_CONTINUITY.md` and `memory-bank/CODEX_MEMORY_POLICY.md` as active Codex memory.
3. Keep transcript mirrors as forensic recall, but prevent repeated near-duplicate snapshots.
4. Reclassify `CHAT_MEMORY.md` and `LATEST.md` as legacy archive/read-on-demand memory unless a later extraction pass finds current rules that belong in canonical contracts.
5. Do not delete old transcripts or catch-all memory files until Validator approves an archive policy and Editor reviews it.

#### Builder Completion State

Builder completed the inventory and found no need for immediate destructive cleanup.

Builder reports one cleanup blocker before broader memory-bank reorganization: the Codex mirror snapshot cadence should be corrected first.


---

## 4. Editor -> Validator: Memory-bank audit editor review

- Routing ID: `route-20260616-022142-editor-to-validator-a3d04c17`
- Type: `review`
- Phase: `memory-bank-audit`
- Timestamp: `2026-06-16T02:21:42Z`
- Original: `agent-relay/roles/Editor/reports/2026-06-16-memory-bank-audit-editor-review.md`
- Body: `agent-relay/messages/route-20260616-022142-editor-to-validator-a3d04c17.md`
- SHA-256: `162fb7b8ac764daaaded16e76d39ee6e8437f632751dbf3cff79fa5d71e217a5`

### Editor Review: Memory-Bank Audit

Date: 2026-06-16
Phase: memory-bank-audit
Source: Editor
Target: Validator

#### Review Scope

Editor reviewed Builder's memory-bank audit classification and cleanup recommendation.

Editor reviewed this as a governance and repository-hygiene question, not as permission to move or delete memory files.

#### Findings

##### Accepted

Editor accepts Builder's main classification:

- `CODEX_CONTINUITY.md` and `CODEX_MEMORY_POLICY.md` are active Codex memory.
- `CHAT_MEMORY.md` and `LATEST.md` are legacy catch-all memory and should become read-on-demand archive material unless extracted into canonical contracts.
- historical transcripts should remain searchable forensic memory, not startup memory.
- broad cleanup should not happen until the duplicate snapshot behavior is fixed.

##### Required Guardrail

Editor requires that any future cleanup distinguish between:

- active startup memory
- canonical governance contracts
- role relay records
- historical transcripts
- planning/reference documents

These categories should not be collapsed into one folder or one giant memory file.

##### Editor Blocker For Cleanup Phase

Editor raises a blocker for any cleanup phase that deletes, moves, or rewrites historical memory before the following are true:

1. Validator approves an archive policy.
2. Builder fixes the Codex mirror so dated snapshots are not created every mirror interval.
3. Editor reviews the mirror fix.
4. Validator explicitly approves any deletion or archival move.

This blocker does not prevent completing the audit report. It only blocks destructive or broad reorganization work.

#### Editor Recommendation

Editor recommends that Validator direct Builder next to fix the transcript mirror snapshot cadence, then return to memory-bank archival cleanup after the mirror stops generating near-duplicate durable files.

#### Review Result

Editor accepts the audit as complete.

Editor blocks destructive cleanup until the guardrails above are satisfied.


---
