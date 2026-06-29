# Routed Message Protocol

## Scope

This protocol governs every formal message routed through `agent-relay/tools/agent_router.py` for the active coding roles:

- Validator
- Builder
- Editor
- User, as a route source only
- Router

The routed transcript should contain role-to-role messages only. Substantive directives, reports, reviews, and rulings belong inside routed message bodies or role-owned canonical files that are routed.

## Canonical Source And Routed Copy

Each formal message starts as a role-owned canonical file:

```text
agent-relay/roles/Validator/directives/YYYY-MM-DD-<slug>.md
agent-relay/roles/Builder/reports/YYYY-MM-DD-<slug>.md
agent-relay/roles/Editor/reports/YYYY-MM-DD-<slug>.md
agent-relay/roles/Validator/rulings/YYYY-MM-DD-<slug>.md
```

The router copies the body into:

```text
agent-relay/messages/route-*.md
```

The routed copy is the transcript source of truth for that route. Do not hand-edit routed message copies unless the user explicitly authorizes mechanical repair and the route hash is updated.

## Required Route Shape

Every routed transcript entry must be produced by `agent-relay/tools/agent_router.py route`. Do not manually paste ordinary chat text into `agent-relay/transcripts/agent-relay-ledger.md`.

Allowed role pairs are defined in `agent-relay/tools/agent_router.py`. The standard coding flow is:

```text
Validator -> Builder: EXECUTION DIRECTIVE
Builder -> Validator: BUILDER REPORT
Validator -> Editor: REVIEW DIRECTIVE
Editor -> Validator: EDITOR REVIEW
```

Validator rulings may be stored under `agent-relay/roles/Validator/rulings/`. The default portable router does not route `Validator -> User`, so final user-facing rulings are reported in normal conversation unless the router allowlist is intentionally extended.

## Required Transcript Envelope

Every transcript entry generated into `agent-relay/transcripts/*.md` must use this collapsible Markdown envelope:

```text
<details markdown="1">
<summary>N. SOURCE -> TARGET: <short title> | <message type> | <timestamp> | <routing id></summary>

## N. SOURCE -> TARGET: <short title>

- Routing ID: `<routing id>`
- Type: `<message type>`
- Phase: `<phase>`
- Timestamp: `<timestamp>`
- Original: `<original body path>`
- Body: `<routed body path>`
- SHA-256: `<sha256>`

### Routed Body

<message body>

</details>
```

`agent-relay-ledger.md` and calendar archive transcripts should contain a
sequence of these envelopes only, plus the transcript title and generated
timestamp.

Phase-specific relay transcripts are work-package evidence. They belong under
`agent-relay/planning-docs/ongoing/<work-package-slug>/` while active, and under
`agent-relay/planning-docs/finished/<work-package-slug>/` after Validator
acceptance.

## Transcript Calendar Archives

Calendar archive ownership is defined in
`agent-relay/protocols/TRANSCRIPT_ARCHIVE_PROTOCOL.md`.

The live relay ledger remains:

```text
agent-relay/transcripts/agent-relay-ledger.md
```

The router must also regenerate routed-message transcript archives by calendar
grain:

```text
agent-relay/transcripts/archive/agent-relay/daily/YYYY/YYYY-MM/YYYY-MM-DD.md
agent-relay/transcripts/archive/agent-relay/weekly/YYYY/YYYY-Www.md
agent-relay/transcripts/archive/agent-relay/monthly/YYYY/YYYY-MM.md
```

The Codex user-to-Validator live transcript remains:

```text
agent-relay/transcripts/codex-live/user-to-validator.md
```

The Codex mirror must also maintain user-to-Validator archives by calendar
grain:

```text
agent-relay/transcripts/codex-live/archive/user-to-validator/daily/YYYY/YYYY-MM/YYYY-MM-DD.md
agent-relay/transcripts/codex-live/archive/user-to-validator/weekly/YYYY/YYYY-Www.md
agent-relay/transcripts/codex-live/archive/user-to-validator/monthly/YYYY/YYYY-MM.md
```

When rendering the routed body into a transcript, preserve the body text but
demote Markdown headings so they remain inside the envelope hierarchy:

```text
# Message body H1  -> #### Message body H1
## Message body H2 -> ##### Message body H2
### Message body H3 and deeper -> ###### Message body H3 and deeper
```

This keeps sections like `Review Scope`, `Editor Checks`, `Result`, `Findings`,
and `Residual Risk` visually under their parent routed message instead of
appearing as separate top-level transcript entries.

## Required Message Body Header

Every canonical message file should start with one H1 title:

```text
# <Role Message Type>: <short title>
```

Examples:

```text
# Validator Directive: Add Cursor Mirror Stop Script
# Builder Report: Cursor Mirror Stop Script
# Editor Review: Cursor Mirror Lifecycle
# Validator Ruling: Cursor Mirror Lifecycle Accepted
```

## Required Sections

Each message type has its own protocol file, but all routed messages should include:

- **Purpose or Scope** - what this message is about.
- **Evidence or Instructions** - facts, files, commands, or steps relevant to the role.
- **Boundaries** - what is out of scope or must not be changed.
- **Verification or Decision** - how success is checked, or what decision is being reported.

## Formatting Rules

- Use concise Markdown.
- Keep file paths in backticks.
- Do not include ordinary chat transcript text unless it is quoted as evidence.
- Do not include tool-output dumps unless the exact output is necessary evidence.
- Prefer short sections over long prose.
- Use `EDITOR BLOCKER` only in Editor reports.

## Integrity Rules

- Route commands must run one at a time.
- Run `python agent-relay\tools\agent_router.py verify` after routing.
- If a routed message body is mechanically repaired, update the route hash or reroute a corrected message.
- Do not leave orphan reviews that lack the corresponding Validator directive in the same phase unless explicitly documenting a historical correction.
