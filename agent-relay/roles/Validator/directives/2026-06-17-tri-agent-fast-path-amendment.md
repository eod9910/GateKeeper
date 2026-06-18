# Validator Decision — Tri-Agent Contract Fast-Path Amendment

- Date: 2026-06-17
- Phase: tri-agent-governance
- From: Validator
- To: User/Mediator (ratification)
- Type: GOVERNANCE AMENDMENT
- Authority: User/Mediator approved the change; Validator owns the contract.

## Change

Amended `TRI_AGENT_CODING_CONTRACT.md`:

1. Added a "Fast Path (Tier 0 / Tier 1)" section. For Tier 0/1 only, the single
   running agent may act as Builder + Editor inline (no separate subagents, no
   full relay) IF: scope is genuinely Tier 0/1, Validator freezes intent first,
   Validator verifies against actual files/diff and compile/test output, and the
   outcome is recorded as one combined relay entry. Full subagent relay remains
   required for Tier 2/3 and any core trading/backtest/research/governance work.

2. Strengthened "No Self-Certification": implementer reports are UNTRUSTED;
   Validator must verify against actual files/diff/compile output, never against
   the report's claims. "No change needed / already present" must be confirmed by
   reading the code.

## Why

Observed tonight: full subagent relay added real token/overhead cost on trivial
changes (a one-line doc fix), and a Builder report misstated the git state
("no edits / already present") while the code had in fact changed. The fast path
removes ceremony for light work; the untrusted-report rule preserves the
verification that actually catches bad work.

## Process note

This amendment was made by the Validator directly (Validator owns the governance
contract) with User/Mediator approval, recorded as a single relay entry. It was
intentionally NOT run through full subagent relay, consistent with reducing
overhead on light governance edits already approved by the User.

## Follow-up 2 (User-directed) — Planning documents are Tier 2

Per User direction, `TRI_AGENT_CODING_CONTRACT.md` now states that any work
carrying a PRD or checklist is automatically Tier 2 minimum, runs the full relay,
and is never fast-path eligible. Flow: Validator authors the PRD + paired
checklist, routes to Builder (who performs the work), Editor does a second-pass
cleanup, and the Validator independently verifies that EVERY checklist item is
done against files/diff/test output before acceptance. Escalates to Tier 3 if the
underlying system is core trading/backtest/research/governance. The Fast Path
eligibility list now explicitly excludes any PRD/checklist work.

## Follow-up (same approval) — AGENTS.md surfaced the fast path

Per User approval, `AGENTS.md` "Agent Operating Contract" section now carries a
one-line summary of the Tier 0/1 fast path so future agents see it on boot
without opening the full contract. This follow-up was executed using the fast
path itself (Tier 0 doc edit): intent frozen, edit verified against the actual
`git diff` (scope limited to `AGENTS.md`), and logged here as one combined entry.
