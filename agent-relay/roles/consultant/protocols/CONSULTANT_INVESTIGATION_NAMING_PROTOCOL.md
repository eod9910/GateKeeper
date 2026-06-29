# Consultant Investigation Naming Protocol

## Purpose

Group related research documents so they sort together in file listings.
Each investigation may produce three documents that share a common prefix.

## Document Types

Each investigation may produce:

1. **PRD** - The framing, hypothesis, requirements, and test design. Written
   before execution.
2. **CHECKLIST** - Derived from the PRD. Tracks pass/fail gates and execution
   status.
3. **REPORT** - Results, evidence, claim boundaries, and recommended next steps.
   Written after execution.

## Naming Convention

```text
<PREFIX>_PRD.md
<PREFIX>_CHECKLIST.md
<PREFIX>_REPORT.md
```

Where `<PREFIX>` is a short uppercase investigation name, for example:

```text
VALUATION_SIGNAL_ROBUSTNESS_PRD.md
VALUATION_SIGNAL_ROBUSTNESS_CHECKLIST.md
VALUATION_SIGNAL_ROBUSTNESS_REPORT.md
```

## Rules

- All files in a set share the same prefix.
- The PRD defines the investigation.
- The checklist is derived from the PRD.
- The report references both the PRD and checklist when they exist.
- Older documents that predate this convention do not need renaming.

## Location

All investigation documents live in:

```text
agent-relay/roles/consultant/reports/
```

When a report is complete, summarize it in the mailbox using the Consultant
Mailbox Protocol.
