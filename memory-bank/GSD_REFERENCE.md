# GSD (Get Shit Done) — Reference Guide

> Source: github.com/rmindel/gsd-for-cursor
> Extracted from: memory-bank/transcripts/gsd_v1.md
> Created: 2026-02-09

---

## What Is GSD

GSD is a structured development workflow system, originally built for Cursor with 27 slash commands and 11 specialized agents. We adapted it into a **reference library** approach.

- Spec-driven development — plan before you code
- Atomic commits, verification steps, phase-based execution
- Interview/questioning methodology for extracting requirements
- Codebase mapping with parallel sub-agents

---

## What Happened (History)

1. **Originally installed** from `github.com/rmindel/gsd-for-cursor` into `~/.cursor/` as slash commands
2. **Problem:** Auto-loading 27 commands, 11 agents, workflows, and templates into context on every session bloated the context window and degraded AI output quality
3. **Uninstalled** from `~/.cursor/` — deleted all commands, agents, hooks, cache, plans, settings
4. **Rebuilt as a reference library** — the workflow/template/reference files were extracted into a `gsd/` folder at project root
5. **Slash commands replaced with natural language** — instead of `/gsd/map-codebase`, you just say "map the codebase" and the AI reads the corresponding workflow file on demand

**The AI doesn't need GSD installed.** It already knows how to map codebases, write PRDs, break down phases, and execute with atomic commits. The GSD reference docs provide the *specific structured processes* (interview methodology, resume protocol, verification patterns) that give it a consistent framework.

---

## Installation Status

**Current setup:** GSD reference docs live in `gsd/` folder at project root.
- `gsd/workflows/` — how to do things (navigate when needed)
- `gsd/templates/` — output formats
- `gsd/references/` — methodology docs

**Rule:** NEVER install GSD into `.cursor/`. Keep it as a reference library on disk. Navigate on demand, never preload.

---

## Commands (Natural Language → Workflow File)

The original 27 slash commands were reduced to 11 essential workflows. Instead of slash commands, you just speak naturally:

| What you say | What the AI does | Workflow file |
|---|---|---|
| "map the codebase" | Spawns sub-agents to analyze stack, architecture, quality, concerns | `gsd/workflows/map-codebase.md` |
| "start a new project" | Runs discovery/interview process to extract requirements | `gsd/workflows/discovery-phase.md` |
| "discuss this phase" | Captures decisions, invariants, constraints before coding | `gsd/workflows/discuss-phase.md` |
| "plan this phase" | Creates executable plans with phases and tasks | `gsd/workflows/execute-plan.md` |
| "execute the plan" | Builds with atomic commits and tests | `gsd/workflows/execute-phase.md` |
| "verify the work" | Runs user acceptance testing | `gsd/workflows/verify-work.md` or `verify-phase.md` |
| "resume work" | Picks up where last session left off | `gsd/workflows/resume-project.md` |
| "diagnose issues" | Systematic debugging | `gsd/workflows/diagnose-issues.md` |
| "complete milestone" | Wraps up a milestone with summary | `gsd/workflows/complete-milestone.md` |
| "transition phases" | Moves between development phases | `gsd/workflows/transition.md` |
| "list assumptions" | Surfaces hidden assumptions in current phase | `gsd/workflows/list-phase-assumptions.md` |

The other 16 original commands (agent configs, hooks, checkpoint utilities, setup scripts) were eliminated — the cursor rules and reference library handle all of that.

**You lost:** Autocomplete from typing `/gsd/` and seeing a dropdown.
**You gained:** A clean context window. Just talk naturally.

---

## GSD Reference Docs

| File | Purpose |
|------|---------|
| `gsd/references/questioning.md` | Interview/questioning methodology for extracting requirements |
| `gsd/references/verification-patterns.md` | Structured UAT checklists |
| `gsd/references/planning-config.md` | Planning configuration |
| `gsd/references/tdd.md` | Test-driven development patterns |
| `gsd/references/checkpoints.md` | Checkpoint/gate definitions |
| `gsd/references/continuation-format.md` | How to continue across sessions |
| `gsd/references/git-integration.md` | Git workflow and atomic commits |
| `gsd/references/model-profiles.md` | Model selection guidance |
| `gsd/references/ui-brand.md` | UI/brand standards |

---

## GSD Templates

| File | Purpose |
|------|---------|
| `gsd/templates/project.md` | Project definition template |
| `gsd/templates/requirements.md` | Requirements document |
| `gsd/templates/roadmap.md` | Roadmap template |
| `gsd/templates/milestone.md` | Milestone definition |
| `gsd/templates/phase-prompt.md` | Phase prompt template |
| `gsd/templates/discovery.md` | Discovery output format |
| `gsd/templates/research.md` | Research output format |
| `gsd/templates/verification-report.md` | Verification report format |
| `gsd/templates/UAT.md` | User acceptance testing template |
| `gsd/templates/DEBUG.md` | Debug template |
| `gsd/templates/state.md` | Project state template |
| `gsd/templates/summary.md` | Summary template |
| `gsd/templates/context.md` | Context document |
| `gsd/templates/continue-here.md` | Session continuation |
| `gsd/templates/config.json` | Configuration |
| `gsd/templates/planner-subagent-prompt.md` | Prompt for planner sub-agents |
| `gsd/templates/debug-subagent-prompt.md` | Prompt for debug sub-agents |
| `gsd/templates/milestone-archive.md` | Milestone archive format |
| `gsd/templates/user-setup.md` | User setup instructions |

### Codebase Analysis Templates
| File | Purpose |
|------|---------|
| `gsd/templates/codebase/stack.md` | Tech stack analysis |
| `gsd/templates/codebase/architecture.md` | Architecture analysis |
| `gsd/templates/codebase/structure.md` | Code structure analysis |
| `gsd/templates/codebase/conventions.md` | Coding conventions |
| `gsd/templates/codebase/testing.md` | Testing analysis |
| `gsd/templates/codebase/integrations.md` | Integration points |
| `gsd/templates/codebase/concerns.md` | Tech debt and concerns |

### Research Project Templates
| File | Purpose |
|------|---------|
| `gsd/templates/research-project/SUMMARY.md` | Research summary |
| `gsd/templates/research-project/STACK.md` | Stack research |
| `gsd/templates/research-project/FEATURES.md` | Feature research |
| `gsd/templates/research-project/PITFALLS.md` | Known pitfalls |
| `gsd/templates/research-project/ARCHITECTURE.md` | Architecture research |

---

## GSD Output Structure (What It Produces)

When GSD runs, it produces docs in a `gsd/` folder:

```
gsd/
  PRD.md                  ← product requirements
  architecture.md         ← system architecture
  requirements.md         ← detailed requirements
  phases/
    phase-1-plan.md       ← phase plans
    phase-1-tasks.md      ← task breakdowns
    phase-2-plan.md
  decisions/
    2026-02-05-storage.md  ← architecture decisions
  verification/
    phase-1-report.md     ← UAT reports
```

---

## Map Codebase Workflow

`gsd/workflows/map-codebase.md` spawns 4 parallel sub-agents to analyze:

1. **Tech stack** — languages, frameworks, dependencies
2. **Architecture** — patterns, layers, data flow
3. **Quality** — conventions, testing
4. **Concerns** — tech debt, issues, fragile areas

In Cursor, use the `Task` tool with sub-agent types:
- `explore` — fast, specialized for codebase exploration
- `generalPurpose` — can search code, read files, execute tasks

Each agent writes findings to a file independently. Don't load their output into context — grep/read on demand.

---

## Discovery Phase (Interview Process)

`gsd/workflows/discovery-phase.md` is the interview/questioning process.
`gsd/references/questioning.md` has the specific question methodology.

Three depth levels depending on how much needs to be learned.

---

## The 3-Iteration Model

This is the agreed-upon development approach:

**Iteration 1 — Vibe Code (Prototype)**
- Fast, creative exploration
- Prove out concepts
- Discover what the system needs to do
- Expect bugs, duct tape, messy code — that's fine
- "Vibe coding isn't bad engineering. It's pre-engineering. It's the R&D phase."

**Iteration 2 — GSD Rebuild (Clean Build)**
- GSD maps the prototype, extracts a spec
- Write PRD, architecture, task breakdown
- Rebuild clean: proper architecture, tests, database, TypeScript everywhere
- Model-first trading logic baked into foundation
- "The prototype is the observation. The spec is the model. The rebuild is the derived behavior."

**Iteration 3 — Refinement**
- Use the clean build, discover new things
- Rebuild again — faster because architecture is solid
- "Each pass gets tighter. The prototype teaches you what. The spec teaches you why. The rebuild teaches you how it should actually work."

**Key insight:** Constraints survive each rebuild. Code doesn't need to.

---

## Two Parts of GSD

1. **GSD Engine** (workflows, templates, references) — tells AI *how* to run the process. Lives in `gsd/` folder as reference. Navigated on demand. This is the same across all projects — it comes from the master template.

2. **GSD Output** (PRD, architecture, phase plans, tasks) — what GSD *produces*. Lives in `planning/` folder as project-specific docs. Navigated on demand. This is unique to each project.

---

## Navigation Principle

**Rules are pointers, not content.**
- "When X happens, go read Y." NOT "here's the entire contents of Y."
- GSD docs are long-term memory on disk
- LATEST.md might say "currently implementing Phase 2 of GSD plan" → cue to grep `gsd/phases/phase-2-plan.md`
- Never preload GSD docs. Pull the specific workflow needed when the user asks.

---

## Memory Architecture

This system uses a **navigation-first** memory approach:

**Short-term memory (loaded on startup — keep lean):**
- `memory-bank/LATEST.md` — what happened last session
- `memory-bank/CHAT_MEMORY.md` — key decisions, preferences, open threads
- `memory-bank/PHASE.md` — current development phase (EXPLORE/SPEC/BUILD/ITERATE)

**Long-term memory (navigate on demand — never preload):**
- `memory-bank/transcripts/` — full session transcripts (grep for keywords)
- `memory-bank/GSD_REFERENCE.md` — this file (grep/read when GSD questions arise)
- `gsd/` — workflow/template/reference files (read the specific one needed)
- `planning/` — GSD output docs (read the specific one needed)

**Key principle:** Context window = short-term working memory. Disk = long-term memory. Rules are POINTERS to content, not the content itself. Every file read enters context and stays there — so only read what you need right now.

---

## Lessons Learned

1. **Don't install GSD into `.cursor/`** — it dumps agents, commands, workflows, templates that get auto-loaded into context. Killed performance. The original 27 commands + 11 agents consumed massive context on every session.
2. **Slash commands are unnecessary** — natural language triggers ("map the codebase") + cursor rules that point to workflow files achieve the same result with zero context overhead until the workflow is actually needed.
3. **Sub-agents must run in non-read-only mode** so they write to disk themselves. Otherwise their output floods the parent context.
4. **Content lives on disk, context stays lean.** Even GSD's own 50+ output files should never be loaded — navigate on demand.
5. **Fresh conversation for GSD work** — GSD needs its full context window for mapping and planning. Don't mix with ongoing work.
6. **OneDrive can lock files** — temp clones from git may get locked by OneDrive sync. Clean up later if needed.
7. **Global Cursor user rules override project rules** — if the global rule says "load everything," project-level `.mdc` rules can't stop it. Keep the global rule minimal: "Read ONLY LATEST.md, CHAT_MEMORY.md, PHASE.md on startup."
8. **Every tool read enters context permanently** — Grep results, Read output, even small snippets. There is no way to remove them. The only protection is to not read what you don't need.
