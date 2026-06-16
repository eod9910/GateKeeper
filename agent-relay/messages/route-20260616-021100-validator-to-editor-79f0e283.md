# Validator Directive: Add Conversation Framing Rule

- Date: 2026-06-16
- Phase: tri-agent-governance
- From: Validator
- To: Editor
- Work tier: Tier 2 governance infrastructure

## Mediator Decision

The Mediator speaks to Validator, not directly to Builder or Editor. Validator
must frame all status updates with explicit role attribution so role ownership
is never ambiguous.

## Required Work

Update the tri-agent governance contract and Validator role instructions so
future Validator instances say:

- `Validator directed Builder...`
- `Builder reported...`
- `Validator directed Editor...`
- `Editor found...`
- `Validator accepted/rejected...`

Avoid ambiguous statements such as `I implemented`, `I reviewed`, or `we fixed`
when Builder or Editor performed the work.

