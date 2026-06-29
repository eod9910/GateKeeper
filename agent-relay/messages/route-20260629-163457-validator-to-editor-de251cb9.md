# Validator Directive: Ledger Heading Folding

## Scope

Update the relay ledger generation so `agent-relay/transcripts/agent-relay-ledger.md` folds by normal Markdown headings in the raw editor.

## Affected Files Or Areas

- `agent-relay/tools/agent_router.py`
- `agent-relay/protocols/ROUTED_MESSAGE_PROTOCOL.md`
- regenerated relay transcript files under `agent-relay/transcripts/`

## Organization Boundary

This change stays inside `agent-relay/`. The router remains the owner of generated relay ledger and archive transcript files. No root files, product source, backend runtime data, or frontend files are in scope.

## Builder Instructions

- Remove HTML `<details>` / `<summary>` wrappers from generated routed transcript entries.
- Keep each route entry as a Markdown heading under the ledger title so raw-editor folding arrows work.
- Keep routed message body headings nested below the route heading.
- Update `ROUTED_MESSAGE_PROTOCOL.md` so the protocol matches the router behavior.

## Out Of Scope

- Do not change route hashing, routed message body copies, allowed route pairs, or inbox semantics.
- Do not change Codex or Cursor live transcript mirror formats.

## Verification Gate

- `python -m py_compile .\agent-relay\tools\agent_router.py`
- `python .\agent-relay\tools\agent_router.py regenerate`
- `python .\agent-relay\tools\agent_router.py verify`
- Confirm `agent-relay/transcripts/agent-relay-ledger.md` has foldable Markdown route headings and no structural `<details>` wrappers.

## Stop Conditions

Stop if route hashes no longer verify, if ledger regeneration edits non-relay files, or if the fix requires changing the live transcript mirror.
