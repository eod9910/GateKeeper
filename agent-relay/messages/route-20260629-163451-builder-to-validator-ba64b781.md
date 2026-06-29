# Builder Report: Ledger Heading Folding

## Scope Completed

Updated the relay router and routed-message protocol so generated relay ledgers use plain Markdown route headings instead of HTML `<details>` / `<summary>` wrappers.

## Files Changed

- `agent-relay/tools/agent_router.py`
- `agent-relay/protocols/ROUTED_MESSAGE_PROTOCOL.md`
- `agent-relay/transcripts/agent-relay-ledger.md`
- relay calendar archive transcript files under `agent-relay/transcripts/archive/agent-relay/`

## Organization Boundary

All changes stayed inside `agent-relay/`. The router remains the owner of generated ledger and archive transcript files.

## Verification

- `python -m py_compile .\agent-relay\tools\agent_router.py`
- `python .\agent-relay\tools\agent_router.py regenerate`
- `python .\agent-relay\tools\agent_router.py verify`

## Result

The ledger now starts with the title and generated timestamp, then each routed message appears as a foldable Markdown `##` route heading. The HTML wrapper is no longer part of the generated ledger structure.
