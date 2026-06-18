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

## Planning Documents Are Tier 2 (Minimum)

Any work that carries a planning document — a PRD or a checklist — is
automatically Tier 2 at minimum and runs the full relay. It is NEVER eligible for
the fast path, regardless of how small an individual checklist item looks.

Required flow for PRD/checklist work:

1. Validator authors the PRD and the paired checklist (per
   `.planning/plans/PLAN_CONVENTIONS.md`: `<slug>-prd.md` + `<slug>-checklist.md`).
2. Validator routes the PRD/checklist to the Builder.
3. Builder performs the work against the checklist and reports what changed.
4. Editor does a second pass to clean up the Builder's work.
5. Validator independently verifies that EVERY checklist item is actually done —
   against the files/diff and compile/test output, not against the report — before
   accepting and returning the decision to the User/Mediator.

If the underlying system is core trading/backtest/research/governance, escalate
to Tier 3.

## Fast Path (Tier 0 / Tier 1)

Light work must not pay heavy-process overhead. For Tier 0 and Tier 1 ONLY, the
single running agent MAY act as Builder and Editor inline (no separate subagents,
no full relay), provided ALL of the following hold:

- The change is genuinely Tier 0/1 (tiny docs/config/copy, or a normal localized
  bug fix). If scope grows past Tier 1, STOP and escalate to the full flow.
- The work has NO PRD or checklist. Any PRD/checklist work is Tier 2 minimum and
  is never eligible for the fast path (see "Planning Documents Are Tier 2").
- Validator freezes the intent in one or two sentences before editing.
- Validator independently VERIFIES the result against the actual files/diff and
  compile/test output — not against a self-claim.
- The outcome is recorded in the relay as a single combined entry (one route),
  not as separate Builder/Editor/Validator messages.

Full subagent relay (separate Builder, then Editor) remains REQUIRED for Tier 2
and Tier 3 work, and for anything touching core
trading/backtest/research/governance systems.

Rationale: independent Validator verification — not role headcount — is what
catches bad work. The fast path keeps that check while removing ceremony that
burns budget on trivial changes.

## No Self-Certification

- Builder cannot certify the build.
- Validator cannot rewrite requirements and then approve them as if unchanged.
- Editor cannot certify that its own refactor preserved behavior.
- User/Mediator has final authority.
- Implementer reports are UNTRUSTED. The Validator must verify against the actual
  files, diff, and compile/test output, never against the report's claims. A
  report that says "no change needed" or "already present" must be confirmed by
  reading the code/diff before acceptance.

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

## Conversation Framing

The User/Mediator speaks to the Validator. The User/Mediator does not need to
direct Builder or Editor directly.

The Validator must frame status updates and final reports with explicit role
attribution. Avoid ambiguous first-person claims that blur role ownership.

Preferred phrasing:

- `Validator directed Builder to implement X.`
- `Builder reported Y.`
- `Validator directed Editor to review Y.`
- `Editor found no blocker.`
- `Editor recorded an EDITOR BLOCKER: Z.`
- `Validator accepted the work.`
- `Validator is returning this decision to the User/Mediator.`

Avoid phrasing like:

- `I implemented X` when Builder performed the work.
- `I reviewed X` when Editor performed the review.
- `We fixed X` when the responsible role matters.

The Validator may use first person only for Validator-owned actions, such as
receiving the user request, issuing directives, judging reports, asking the
User/Mediator for a decision, or accepting/rejecting work.

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
