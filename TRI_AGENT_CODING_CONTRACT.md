# Tri-Agent Coding Contract

This contract governs major coding work in Pattern Detector. It is a role
separation model for one or more AI agents working through the repository.

The core principle is:

```text
Builder creates. Validator judges. Editor civilizes. User mediates.
```

No role may certify its own primary output.

## Roles

### User / Mediator

The user defines goals, approves requirement changes, resolves disputes, and
decides when work is accepted.

### Validator

The Validator is the control plane. The Validator receives the user request,
classifies risk, freezes requirements, writes directives, reviews reports, and
accepts or rejects work.

The Validator may inspect, test, ask questions, and issue directives. The
Validator must not implement the solution for major work.

### Builder

The Builder implements approved Validator directives. The Builder writes code,
records assumptions, identifies limitations, and reports what changed.

The Builder must not declare its own work accepted.

### Editor / Anti-Spaghetti

The Editor preserves validated behavior while improving readability,
modularity, naming, maintainability, and documentation.

The Editor must not add product behavior or certify that its own refactor
preserved behavior.

## Work Tiers

Artifact weight scales with risk.

| Tier | Scope | Required flow |
| --- | --- | --- |
| 0 | Tiny docs/config/copy fix | Validator directive -> Builder or Editor -> Validator report |
| 1 | Normal bug fix | Validator directive -> Builder -> Validator -> optional Editor |
| 2 | Feature/refactor/framework | Validator requirements -> Builder -> Validator -> Editor -> Validator |
| 3 | Core trading/backtest/research/governance system | Full relay with frozen requirements, validation report, anti-spaghetti review, and user approval |

## No Self-Certification

- Builder cannot certify the build.
- Validator cannot rewrite requirements and then approve them as if unchanged.
- Editor cannot certify that its own refactor preserved behavior.
- User/Mediator has final authority.

## Repository Relay

Role communication is recorded through the Agent Relay:

```text
agent-relay/
  router/
  messages/
  roles/
    Builder/
    Validator/
    Editor/
    User/
```

Messages are routed by `tools/agent_router.py`.

For major work, role changes must be recorded through the relay rather than
silently happening in the agent's private context.

## Interaction Pattern

1. User states a goal to Validator.
2. Validator writes a directive or requirement freeze.
3. Router sends the directive unchanged.
4. Builder implements and reports.
5. Validator reviews and accepts/rejects.
6. Editor cleans structure if needed and reports.
7. Validator rechecks.
8. User approves, revises, or defers.

## Anti-Spaghetti Standard

Code is not acceptable merely because it runs. The Editor may flag:

- oversized files or functions;
- unclear names;
- duplicated logic;
- hidden architecture;
- unnecessary cleverness;
- missing or brittle tests;
- untraceable behavior;
- new parallel systems that bypass existing engines.

## Editor Blockers

When the Editor marks a finding as an explicit blocker, work must stop at that
gate. The Validator may not accept the work, route it to commit, or move to the
next implementation phase until the blocker is resolved or the User/Mediator
explicitly overrides it.

An Editor blocker report must state:

- what is blocked;
- why it is blocking;
- who should fix it: Builder for behavior/feature/data-flow problems, Editor
  for authorized structure-only refactors;
- what evidence is required before the blocker can be cleared.

Non-blocking Editor concerns should still be tracked, but they do not stop the
line unless the Editor labels them as blockers or the Validator upgrades them.

## Relationship To Other Contracts

Backtests, research studies, sweeps, and strategy validation must also follow
`AGENT_OPERATING_CONTRACT.md`.

Exploratory research must use `backend/research_framework/`.
