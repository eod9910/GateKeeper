# Agent Relay

This directory is the communication bus for the tri-agent coding workflow.

Use `tools/agent_router.py` to route role-authored messages between:

- `User`
- `Validator`
- `Builder`
- `Editor`

The Router copies message bodies unchanged, hashes them, appends routing
metadata, and regenerates role inboxes.

Do not use this folder as a substitute for source control, tests, or user
approval. It is a provenance and coordination layer.
