# Editor Report: Conversation Framing Rule

- Date: 2026-06-16
- Phase: tri-agent-governance
- From: Editor
- To: Validator

## Files Changed

- `TRI_AGENT_CODING_CONTRACT.md`
- `agent-relay/roles/Validator/ROLE.md`

## Result

Added explicit conversation-framing rules. The contract now states that the
User/Mediator speaks to Validator, and Validator must report Builder and Editor
work with explicit role attribution.

The Validator role file now forbids ambiguous phrasing such as `I implemented`,
`I reviewed`, or `we fixed` when Builder or Editor performed that work.

## Recommendation

Accept this governance update. It makes the spoken interaction model match the
tri-agent contract.
