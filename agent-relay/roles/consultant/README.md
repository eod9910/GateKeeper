# Consultant

## Canonical Location

```text
agent-relay/roles/consultant/
```

## Folder Structure

```text
agent-relay/roles/consultant/
|-- data/                   - Exploratory probe outputs
|-- papers-to-validator/    - Formal handoffs when a Validator role exists
|-- phases/                 - Optional phase-specific research state
|-- protocols/              - Consultant governance protocols
|-- reports/                - Research PRDs, checklists, findings, reports
|-- transcripts/            - Mailbox and live transcript mirror
|-- CONSULTANT_AGENT.md     - Research-mode agent manual
|-- README.md               - This file
`-- ROLE.md                 - Role authority and restrictions
```

## Status / Disclaimer

- Nothing in this folder is automatically validated.
- Treat findings here as leads, not final results.
- Anything worth promoting must pass through the project's normal review or
  Validator process.

## Mailbox

Manual Consultant messages live in:

```text
agent-relay/roles/consultant/transcripts/Mailbox.md
```

All mailbox entries must follow:

```text
agent-relay/roles/consultant/protocols/CONSULTANT_MAILBOX_PROTOCOL.md
```

Key rules:

- Append-only.
- Preserve chronology.
- Sign entries with the speaker identity.
- Keep exploratory claim boundaries explicit.

## Reports

Research investigations should use the PRD/checklist/report convention in:

```text
agent-relay/roles/consultant/protocols/CONSULTANT_INVESTIGATION_NAMING_PROTOCOL.md
```

Default location:

```text
agent-relay/roles/consultant/reports/
```

## Transcript Mirror

The Consultant mirror captures the current Cursor IDE chat, not the Codex CLI
session mirror.

Start:

```powershell
.\agent-relay\tools\start_consultant_transcript_mirror.ps1
```

Output:

```text
agent-relay/roles/consultant/transcripts/live/decoded/latest-session.md
agent-relay/roles/consultant/transcripts/live/mirror-metadata.json
```
