# Validator Directive: Add Meta-Conversation Transcripts

- Date: 2026-06-16
- Phase: tri-agent-governance
- From: Validator
- To: Builder
- Work tier: Tier 2 governance infrastructure

## Mediator Need

Role-specific files are correct for the framework, but humans also need a
single readable meta-conversation view showing Validator directives, Builder
reports, Editor reviews, and Validator follow-up in order.

## Required Work

Add a first-class transcript view generated from the existing router log and
message bodies.

Preserve the existing model:

- role-authored files remain the source artifacts;
- `agent-relay/messages/` remains the immutable routed copy location;
- `agent-relay/router/routes.jsonl` remains the audit log.

Add:

- `agent-relay/transcripts/`;
- phase transcript generation;
- an all-phases transcript;
- a router command to regenerate inboxes and transcripts.

