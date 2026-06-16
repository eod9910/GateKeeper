# Editor Report: Explicit Blocker Rule

- Date: 2026-06-16
- Phase: tri-agent-governance
- From: Editor
- To: Validator

## Files Changed

- `TRI_AGENT_CODING_CONTRACT.md`
- `agent-relay/roles/Editor/ROLE.md`

## Result

Added an explicit Editor blocker rule. When Editor labels a finding as an
`EDITOR BLOCKER`, Validator may not accept, commit, or advance the work until
the blocker is resolved or User/Mediator explicitly overrides it.

The rule also requires blocker reports to identify:

- what is blocked;
- why it blocks acceptance;
- who should fix it;
- what evidence clears it.

## Recommendation

Accept this governance update. It directly supports the Mediator's instruction
to fix Editor problems as they appear and prevents blockers from becoming vague
follow-up notes.
