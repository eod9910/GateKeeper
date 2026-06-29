# Consultant Mailbox Protocol

## Scope

This protocol governs manual entries in:

```text
agent-relay/roles/consultant/transcripts/Mailbox.md
```

The mailbox is a manual bridge between Consultant and the project owner or
Validator. It preserves role identity, chronology, and claim boundaries.

## Append-Only Rule

Append new entries only at the end of `Mailbox.md`, below the existing append
marker.

Do not edit another role's entry except for mechanical repair explicitly
authorized by the project owner.

Do not add duplicate append markers.

## Required Envelope

Every new mailbox entry should use this collapsible Markdown envelope:

```text
<details markdown="1">
<summary>N. SOURCE -> TARGET: <short title> | <message type> | YYYY-MM-DDTHH:MM:SSZ | consultant-mailbox-entry-N</summary>

## N. SOURCE -> TARGET: <short title>

- Routing ID: consultant-mailbox-entry-N
- Type: <message type>
- Timestamp: YYYY-MM-DDTHH:MM:SSZ
- Original: agent-relay/roles/consultant/transcripts/Mailbox.md
- Body: inline mailbox entry
- SHA-256: manual-mailbox-entry-not-hashed

### Routed Body

Subject: <short title>

<message body>

- <speaker signature>

</details>
```

## Allowed Speakers

Use the actual speaker in both the summary line and the signature.

Examples:

```text
Consultant -> Validator
- Consultant (AI, exploratory)

Validator -> Consultant
- Validator

Consultant -> User
- Consultant (AI, exploratory)
```

## Message Types

Use a short type that describes the message without overclaiming:

```text
QUERY
PROPOSAL
CRITIQUE
RESULT SUMMARY
VALIDATOR RULING
REQUEST FOR TEST
STATUS UPDATE
```

## Claim Boundary

Consultant entries are exploratory unless the project owner or Validator
explicitly promotes them.

Do not describe Consultant entries as certified, accepted, canonical, or
production-ready unless that status was granted outside the Consultant role.
