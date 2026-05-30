# Workspace Architecture

## Purpose

This file is the canonical guide for how workspaces work in this repo.

Use it when:

- creating a new workspace
- adding a new workspace skill
- deciding whether something belongs in a workspace file, a runtime tool, or backend code
- wiring a workspace into the app

The goal is simple:

- do not rediscover workspace architecture by grepping the repo every time
- keep future agent work aligned with Ledger, the most complete workspace implementation in this repo

## What A Workspace Is

A workspace is a role-specific prompt package for one analyst or copilot surface.

The reference implementation is:

- `workspace/Financial Analyst Workspace/`

Ledger is the template of record for how future agents should be shaped. If a template or build-agent skill disagrees with Ledger's folder shape, update the docs or template so they match Ledger.

A workspace is not:

- a backend service
- a tool registry by itself
- a random notes folder

A workspace is:

- a role
- a reasoning contract
- a voice and posture
- a bounded set of skills
- a documented tool contract

Examples in this repo include:

- `Financial Analyst Workspace`
- `Scanner Copilot Workspace`
- `Trading Copilot Workspace`
- `Technical Analyst Workspace`

## Runtime Truth

The runtime loader lives in:

- `backend/src/services/visionService.ts`

That file is the source of truth for:

- which workspace is bound to which analyst/page flow
- which workspace markdown files are loaded into the prompt
- which skills are loaded into the prompt

### Workspace Files Loaded At Runtime

`visionService.ts` currently loads these files, in this order, when present:

1. `BOOTSTRAP.md`
2. `IDENTITY.md`
3. `SOUL.md`
4. `AGENTS.md`
5. `TOOLS.md`
6. `USER.md`
7. `MEMORY.md`
8. `HEARTBEAT.md`
9. `DATA_CONTRACT.md`

Important:

- missing files are skipped safely
- order matters because earlier files shape the frame for later ones

### Skill Files Loaded At Runtime

Workspace skill content is loaded from:

- `workspace/<Workspace Name>/skills/<skill-id>/SKILL.md`

Only skills explicitly selected by the runtime path are loaded.

That means:

- putting a skill folder in `skills/` does not make it active by itself
- the app must reference that skill when building the workspace prompt

## Tool Truth

There are two different things people call "tools" in this repo.

### 1. Declarative Workspace Tool Notes

These live in:

- `workspace/<Workspace Name>/TOOLS.md`

This file explains:

- what tools the workspace should think it has
- how the workspace should use those tools
- tool boundaries and usage rules

This file is documentation and prompt material.

It is not executable.

### 2. Runtime Tools

Real runtime tools live in backend code, primarily:

- `backend/src/services/copilotTools.ts`

This is where tools actually become callable by the app.

If a tool is mentioned in `TOOLS.md` but not implemented in runtime code, it is only aspirational.

## The Three Layers

When adding workspace capability, think in these three layers:

### Layer 1: Workspace Contract

Lives in:

- workspace markdown files
- skill files

Defines:

- role
- posture
- reasoning style
- output contract
- intended tool behavior

### Layer 2: Runtime Binding

Lives in:

- `backend/src/services/visionService.ts`

Defines:

- which workspace is used
- which skills load
- which analyst identity is exposed to the user

### Layer 3: Executable Capability

Lives in:

- `backend/src/services/copilotTools.ts`
- backend services and routes behind those tools

Defines:

- what the app can actually do

## When To Create What

Use this decision rule.

### Create A New Workspace When

- the page or analyst has a distinct role
- the reasoning contract is materially different
- the voice and output shape should differ
- the tool boundaries differ

Examples:

- Ledger vs Scanner vs Trading Copilot

### Create A New Skill When

- the role stays the same
- but there is a reusable procedure within that role

Examples:

- `dcf-valuation`
- `earnings-quality`
- `buried-risk-review`

### Create A New Runtime Tool When

- the app needs a new executable capability
- the workspace should be able to fetch or compute something it cannot do from prompt instructions alone

Examples:

- filing coverage refresh
- DCF execution
- special situation web verification

## Standard Workspace Anatomy

Every serious workspace should usually have:

- `IDENTITY.md`
- `SOUL.md`
- `AGENTS.md`
- `TOOLS.md`
- `USER.md`
- `MEMORY.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md`

Optional:

- `DATA_CONTRACT.md`
- `references/`
- `skills/`

`references/` is the Ledger-style library folder. Use it for long-form grounding material such as PDFs, methodology notes, manuals, and research references. Do not introduce a parallel `documents/` convention for new workspaces unless Ledger and the architecture docs are migrated together.

### File Roles

`IDENTITY.md`

- who the analyst is
- tone
- surface identity
- how the analyst introduces itself

`SOUL.md`

- worldview
- deeper reasoning stance
- default instincts

`AGENTS.md`

- standing rules
- permanent operating instructions
- failure conditions
- output discipline

`TOOLS.md`

- tool inventory
- how tools should be used
- tool boundaries
- what is planned vs active

`USER.md`

- intended collaborator
- assumptions about user style
- collaboration posture

`MEMORY.md`

- durable learnings worth carrying
- current conventions
- repo-specific decisions that should not be rediscovered

`HEARTBEAT.md`

- operating rhythm
- check-in cadence
- what to monitor while working

`BOOTSTRAP.md`

- first-load checklist
- what to inspect before acting
- what context to establish at session start

`DATA_CONTRACT.md`

- app-facing payload shape
- expected inputs and outputs
- provenance or confidence rules when needed

## Standard Build Process

When adding a new workspace, follow this order.

1. Define the page or analyst role.
2. Decide whether it is actually a new workspace or just a new skill.
3. Copy the Ledger-shaped workspace pattern: root markdown files, `skills/`, and `references/`.
4. Fill in `IDENTITY.md`, `SOUL.md`, and `AGENTS.md` first.
5. Add `TOOLS.md` with the intended tool contract.
6. Add only the skills the workspace truly needs.
7. If the workspace needs executable capability, implement runtime tools in backend code.
8. Bind the workspace in `visionService.ts`.
9. Test one realistic prompt end to end.
10. Only then start expanding skills or references.

## Definition Of Done

A new workspace is not done until all of these are true:

- the workspace folder exists
- the workspace shape matches Ledger unless there is a deliberate migration
- core markdown files exist
- the role is clearly distinct
- the skill list is intentional
- long-form library material lives in `references/`
- tool notes reflect reality
- runtime binding exists in `visionService.ts`
- any claimed executable tools exist in runtime code
- one realistic analyst interaction works end to end

## Anti-Patterns

Do not do these.

- Do not treat `TOOLS.md` as if it makes a tool real.
- Do not create a new workspace when a new skill would do.
- Do not let workspace behavior live only in terminal memory.
- Do not dump random notes into `MEMORY.md` without deciding whether they are durable.
- Do not add a skill folder and assume the runtime will auto-load it.
- Do not create a workspace with no explicit role boundary.
- Do not make a workspace depend on tools that only exist in someone's head.

## Naming Conventions

Workspace folders:

- use explicit role names
- prefer `<Role> Workspace`

Skill folders:

- use lowercase kebab-case

Examples:

- `skills/dcf-valuation`
- `skills/setup-critique`
- `skills/trade-decision`

## Practical Rule Of Thumb

If the question is:

- "How should this analyst think?" -> workspace file
- "How should this reusable procedure work?" -> skill
- "How does the app actually fetch or compute it?" -> runtime tool/service
- "How does the app know to use this workspace?" -> `visionService.ts`

## Template

Use:

- `workspace/_templates/Standard Workspace/`

That folder exists to keep new workspace creation consistent and fast.
