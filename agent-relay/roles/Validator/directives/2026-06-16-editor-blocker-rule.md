# Validator Directive: Add Explicit Editor Blocker Rule

- Date: 2026-06-16
- Phase: tri-agent-governance
- From: Validator
- To: Editor
- Work tier: Tier 2 governance infrastructure

## Mediator Decision

If Editor records an explicit blocker, the system cannot move on until that
blocker is fixed or the User/Mediator explicitly overrides it.

## Required Work

Update the tri-agent governance documents so future agents understand:

- Editor blockers are hard stop gates;
- Validator cannot accept, commit, or advance blocked work;
- blocker reports must say what is blocked, why, who should fix it, and what
  evidence clears it.

