# Router-Only Protocol

The Router is a non-thinking message transport layer between project roles.

It exists to remove manual copy-paste while preserving governance separation
between Builder, Validator, Editor, and User.

The Router is not a fourth agent. It has no judgment, no interpretation, and no
authority. It is a courier.

## Core Rule

The Router routes messages exactly as written.

It must not:

- summarize;
- rewrite;
- improve wording;
- interpret intent;
- merge messages;
- decide whether a claim is valid;
- authorize execution;
- patch canonical documents;
- infer what one role really meant.

If the Router changes message content, governance is broken.

## Roles

| Role | Function |
| --- | --- |
| `Builder` | Produces implementation, artifacts, assumptions, and build reports. |
| `Validator` | Reviews artifacts, issues rulings, declares blockers, and authorizes execution. |
| `Editor` | Refactors, improves structure, executes authorized file cleanup, and reports factual outputs. |
| `User` | Mediates the system and may message any role. |
| `Router` | Moves messages unchanged and logs the transfer. |

## Allowed Routes

```text
Builder -> Validator
Validator -> Builder
Validator -> Editor
Editor -> Validator
User -> Builder
User -> Validator
User -> Editor
User -> Router
```

## Restricted Routes

`Builder -> Editor` is normally forbidden. Builder defines and implements, but
Validator authorizes Editor execution.

`Editor -> Builder` is normally forbidden. Editor reports to Validator or User;
Validator decides whether Builder must respond.

`Builder -> Canon`, `Validator -> Canon`, and `Router -> Canon` are forbidden.

`Editor -> Canon` is allowed only after Validator/User authorization and should
be represented as an execution directive plus factual report.

## Required Metadata

Each routed message records:

- routing id;
- source role;
- target role;
- phase;
- message type;
- title;
- timestamp;
- copied message path;
- original body path;
- SHA-256 hash of exact copied body.

## Router Tool

Use:

```powershell
python tools/agent_router.py routes

python tools/agent_router.py route `
  --phase "Research Study Framework" `
  --source Validator `
  --target Builder `
  --type "EXECUTION DIRECTIVE" `
  --title "Create study manifest helper" `
  --body-file "path\to\message.md"

python tools/agent_router.py inbox --role Builder

python tools/agent_router.py export `
  --phase "Research Study Framework" `
  --output "agent-relay\exports\research-study-framework.md"

python tools/agent_router.py verify
```

Runtime files live under:

```text
agent-relay/
```

## What Router Logs Prove

Router logs prove that a specific body was sent from one role to another at a
specific time and preserved with a hash.

Router logs do not prove that the content is correct, approved, complete, or
safe. Those judgments remain with the proper role.
