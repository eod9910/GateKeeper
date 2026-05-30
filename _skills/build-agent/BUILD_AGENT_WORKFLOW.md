# Build an Agent (Pattern Detector)

This is the canonical reference for how agents are built in Pattern Detector. Read this before building any new agent, workspace, skill, tool, or engine.

Ledger, the `Financial Analyst Workspace`, is the canonical completed example. When this document describes an agent, workspace, skill, reference library, runtime tool, or engine, it should match the Ledger pattern unless the project intentionally changes Ledger and this guide together.

## When to Use

- "Build a new agent"
- "Create a workspace for `<role>`"
- "Add a new AI analyst"
- "Wire up tools for an agent"
- "How do we structure agents?"
- "Add a skill to an existing workspace"
- "How does the agent prompt system work?"

## Core Principle

An agent is not a single monolithic prompt. It is a **three-layer stack** where each layer has a distinct job.

```
┌─────────────────────────────────────────────────┐
│  Layer 1: Workspace Contract                    │
│  (markdown files — defines HOW the agent thinks)│
├─────────────────────────────────────────────────┤
│  Layer 2: Runtime Binding                       │
│  (TypeScript — assembles the prompt, routes     │
│   tools, selects skills)                        │
├─────────────────────────────────────────────────┤
│  Layer 3: Executable Capability                 │
│  (TypeScript engines + Python data pipeline —   │
│   the actual computation the agent can invoke)  │
└─────────────────────────────────────────────────┘
```

**Layer 1** is the agent's mind — identity, reasoning doctrine, procedural playbooks.
**Layer 2** is the wiring — loads the right docs, injects live context, dispatches tool calls.
**Layer 3** is the muscle — data assembly, analysis engines, external integrations.

The LLM sits between Layer 1 and Layer 3: it reads engine output and explains it in the workspace voice, following the skill's procedural steps and the soul's reasoning doctrine.

---

## Layer 1: Workspace Contract

A workspace lives in `workspace/<Name> Workspace/` and consists of markdown files loaded in a fixed order:

Use `workspace/Financial Analyst Workspace/` as the template of record. It has the root workspace files, a `skills/` folder, and a `references/` library folder. Do not invent a separate `documents/` folder convention for new agents unless Ledger is migrated first.

### File Inventory

| File | Purpose | Required? |
|------|---------|-----------|
| `BOOTSTRAP.md` | First-load checklist. What to read and in what order. | Yes |
| `IDENTITY.md` | Surface persona: name, vibe, tone, emoji, one-liner. | Yes |
| `SOUL.md` | Deep reasoning doctrine. Worldview, instincts, beliefs. The most important file. | Yes |
| `AGENTS.md` | Standing orders. Permanent rules, failure conditions, output discipline. | Yes |
| `TOOLS.md` | Tool inventory. What exists, when to use each, boundaries. | Yes |
| `USER.md` | Assumptions about the human collaborator. | Optional |
| `MEMORY.md` | Durable learnings and repo-specific conventions. | Optional |
| `HEARTBEAT.md` | Operating rhythm and check-in cadence. | Optional |
| `DATA_CONTRACT.md` | Formal input/output payload shape. | Optional |

### How to Write Each File

**IDENTITY.md** — Keep short. Name, creature type, vibe, one-line identity, presentation style. This makes the agent recognizable. Example: Ledger is "calm, skeptical, plainspoken" and sounds like "a trusted advisor walking into the room."

**SOUL.md** — The agent's worldview. Not personality traits — reasoning principles. For a financial analyst: "a company is worth the PV of future cash flows, adjusted for risk." The soul should be 40-80 lines: long enough to shape behavior, not so long it gets diluted.

**AGENTS.md** — Numbered standing orders. Guardrails that prevent drift. Examples: "separate fact from inference," "show numbers before conclusions," "if evidence is insufficient, say so plainly." Rules a senior person would enforce in every meeting.

**TOOLS.md** — For each tool: what it does, when to call it, what it returns. Also: tool boundaries (what this agent should NOT use), and planned future tools. This file is prompt material, not executable code.

### Skills

Skills live in `workspace/<Name> Workspace/skills/<skill-id>/SKILL.md`.

A skill is a **reusable procedural playbook** within a workspace.

Key properties:
- Not always loaded — loaded only when the runtime determines it is relevant
- Should declare its **runtime contract**: which tool triggers it, which backend engine backs it
- Should define a **workflow** (ordered steps) and an **output contract** (required sections)
- Can reference **workspace reference PDFs** for grounding

### Reference Library

Ledger stores its analyst library in `workspace/Financial Analyst Workspace/references/`.

Use this same `references/` folder name for future workspaces. It is where PDFs, source manuals, research methods, and long-form grounding material live. Skills may point to these files with relative paths, but runtime does not automatically load the full reference library into every prompt.

Do not call this folder `documents/` in new architecture docs unless the actual Ledger workspace and runtime references are migrated too.

### When to Create What

| You need... | Create... |
|-------------|-----------|
| A distinct role with its own reasoning, voice, and tool boundaries | A new workspace |
| A reusable procedure within an existing role | A new skill |
| A new executable capability the agent can invoke | A new runtime tool + backend service |

---

## Layer 2: Runtime Binding

Lives in `backend/src/services/visionService.ts`.

### What it does

1. **Selects the workspace** based on the analyst/page flow
2. **Loads workspace markdown files** in canonical order (BOOTSTRAP → IDENTITY → SOUL → AGENTS → TOOLS → USER → MEMORY → HEARTBEAT → DATA_CONTRACT)
3. **Selects skills** based on the user's question
4. **Injects live instructions** — session-specific guardrails
5. **Injects dynamic context** — current symbol, scanner state, etc.
6. **Appends tool prompt appendix** from `copilotTools.ts`
7. **Assembles the final system prompt** and sends to LLM

### Key Functions

- `buildSystemPromptForRole()` — routes to the right workspace prompt builder
- `buildWorkspacePrompt()` — generic workspace prompt assembler
- `buildCopilotToolPromptAppendixForAnalyst()` — generates tool-use instructions and tool list

### Live Instructions Pattern

```typescript
liveInstructions: [
  'Use filing-backed Ledger context as the primary financial truth layer.',
  hasImage
    ? 'Treat the attached chart image as secondary context.'
    : 'No image is attached. Focus on the business read.',
],
```

These supplement standing orders in AGENTS.md with context the workspace files cannot know at authoring time.

---

## Layer 3: Executable Capability

### Tool Layer — `copilotTools.ts`

Where tools become callable. Each tool:
1. Validates the request (symbol matches active context)
2. Fetches data (via internal API calls or Python subprocess)
3. Transforms data into a clean shape for the LLM
4. Returns `CopilotToolResult` with `ok`, `tool`, `data`, optional `error`

Key patterns:
- **Summarization**: Raw data is too large for context. Every tool summarizes before returning.
- **Evidence merging**: Some tools do a second "probe" query for things the primary query might miss.
- **Workflow tools**: Composite tools that call other tools, run engines, and return complete results.

### Engine Layer

Engines are **pure computation functions** that take structured input and return structured output. They do not call the LLM.

Engine design rules:
- Deterministic given the same input
- Never call external APIs or spawn processes
- Return structured JSON the LLM then interprets
- Handle missing data gracefully (null propagation, "unknown" classifications)
- Include confidence levels in output

### Data Pipeline — Python services

Assembles raw context that engines consume. Examples:
- `ledgerContext.py` → assembles statement backbone + documents + filing retrieval
- `ledgerCoverage.py` → determines coverage tier
- `ledger_hydration.py` → multi-stage per-symbol data hydration

---

## The Complete Request Flow

```
User asks: "What is AAPL worth?"

1. visionService.ts selects Financial Analyst Workspace
2. Loads IDENTITY + SOUL + AGENTS + TOOLS + DATA_CONTRACT as available, plus selected skills such as skills/dcf-valuation
3. Injects live instructions + dynamic context
4. Sends system prompt + user message to LLM

5. LLM decides to call run_dcf_valuation tool

6. copilotTools.ts:
   a. Calls get_ledger_context (→ Python → SQLite)
   b. Does a second hard-flag probe query
   c. Merges evidence from both queries
   d. Builds the workflow base (derives margins, etc.)
   e. Runs runDcfValuationEngine() — pure TypeScript
   f. Checks for corporate actions, web verifies if needed
   g. Returns structured result + output_contract

7. LLM reads the engine output
8. Follows the selected workspace skill's procedure
9. Explains the result in Ledger's voice (SOUL + IDENTITY)
10. Formats per the output contract (AGENTS standing orders)
```

---

## Workflow: Building a New Agent

```
1. Define the role (distinct reasoning? distinct tools? distinct voice?)
2. If same role, different procedure → create a SKILL instead
3. Copy the Ledger-shaped workspace template: root markdown files + skills/ + references/
4. WRITE IDENTITY.md  → who is this agent?
5. WRITE SOUL.md      → how does it reason? what does it believe?
6. WRITE AGENTS.md    → what rules apply every session?
7. WRITE TOOLS.md     → what can it do?
8. Add skills only for reusable procedures within the role
9. If agent needs computation/data:
   a. Add runtime tools in copilotTools.ts
   b. Add engines in a dedicated service file if needed
   c. Add/extend Python data pipeline if needed
   d. Wire tool list into getCopilotToolsForAnalyst()
10. Bind workspace in visionService.ts:
    a. Add workspace name to analyst registry
    b. Add buildXxxPrompt() function
    c. Wire into buildSystemPromptForRole()
    d. Set toolRole to match copilotTools.ts
11. Test one realistic interaction end-to-end
```

## Definition of Done

- Workspace folder exists with core markdown files
- Workspace shape matches Ledger unless there is a deliberate migration
- Role is clearly distinct from other agents
- Skill list is intentional (not a dump)
- Reference/library files live under `references/`, matching Ledger
- Tool notes reflect what actually exists in runtime code
- Runtime binding exists in visionService.ts
- Claimed tools exist in copilotTools.ts
- One realistic interaction works

---

## Anti-Patterns

- **TOOLS.md as wish-list**: Do not list tools that do not exist in runtime code. The LLM will hallucinate tool calls.
- **Skill without runtime backing**: A skill referencing a nonexistent tool is aspirational, not working.
- **Workspace when a skill would do**: Same role, different procedure → add a skill.
- **Engine that calls the LLM**: Engines are pure computation. LLM reasoning happens in the prompt layer.
- **Data pipeline depending on engine output**: Data flows one way: pipeline → engine → LLM. No circular dependencies.
- **Prompt-only capability**: If the agent needs to fetch or compute, build a tool. Do not rely on the LLM to "just know."

---

## Naming Conventions

- Workspace folders: `<Role> Workspace` (e.g., `Financial Analyst Workspace`)
- Skill folders: lowercase kebab-case (e.g., `skills/dcf-valuation`)
- Engine functions: `run<Name>Engine()` (e.g., `runEarningsQualityEngine()`)
- Tool names: snake_case (e.g., `run_financial_analysis`)
- Python services: snake_case modules (e.g., `ledger_hydration.py`)

---

## Existing Workspaces (Reference)

| Workspace | Agent Name | Role |
|-----------|-----------|------|
| Financial Analyst Workspace | Ledger | Fundamental analysis, valuation, earnings quality |
| Scanner Copilot Workspace | — | Quick setup critique from scanner context |
| Trading Copilot Workspace | — | Trade execution, sizing, risk |
| Technical Analyst Workspace | — | Chart structure, pattern interpretation |
| Pattern Analyst Workspace | — | Deep pattern analysis with fundamentals |
| Literal Chart Reader Workspace | — | Reads chart images literally |
| Hypothesis Author Workspace | — | Strategy review and hypothesis generation |
| Statistical Interpreter Workspace | — | Validation and backtest interpretation |
| Compliance Officer Workspace | — | Rule compliance checking |
| Forensic Auditor Workspace | — | Trade forensics and post-mortem |
| Plugin Engineer Workspace | — | Primitive/plugin code generation |
| Blockly Composer Workspace | — | Visual strategy composition |
| Composite Architect Workspace | — | Multi-primitive composite design |

---

## Comparison: Our Architecture vs TradingAgents

### TradingAgents (GitHub, 55k stars)

Fixed pipeline of specialized LLM agents orchestrated by LangGraph:
```
Analyst Team (fundamentals, sentiment, news, technical)
    ↓
Researcher Team (bull vs bear debate)
    ↓
Trader Agent (buy/sell/hold + sizing)
    ↓
Risk Management → Portfolio Manager (approve/reject)
```

Every agent is an LLM call. 8-12+ LLM calls per analysis. Thin data layer (API pulls at runtime). Decision log with realized-return reflection for cross-session learning.

### Key Differences

| Dimension | Pattern Detector | TradingAgents |
|-----------|-----------------|---------------|
| Agent count | 1 agent per workspace with switchable skills | 6-8 agents in fixed pipeline |
| LLM calls | 1 (agent reads engine output, explains it) | 8-12+ (every agent is an LLM call) |
| Computation | TypeScript engines do math; LLM interprets | LLM does everything |
| Data depth | SEC filings → Docling → PIT → FTS retrieval → engines | API pulls at runtime |
| Identity | Rich workspace docs (SOUL, standing orders) | Simple role prompts |
| Cost | Low (1 LLM call + pre-computed engines) | High (8-12+ LLM calls) |
| Memory | Stateless per request | Decision log with reflection |
| Debate | None (single perspective) | Bull vs bear debate |

### Patterns Worth Borrowing

1. **Adversarial debate** — bull/bear researchers forcing both-sides consideration before a decision
2. **Decision memory with reflection** — log recommendations, check realized returns, feed learnings back
3. **Multi-agent approval chain** — risk-manager gate before recommendations ship

The patterns are more useful than the TradingAgents package itself (LangGraph + Alpha Vantage dependency is heavy).

## Reference Docs

| Doc | Purpose |
|-----|---------|
| `workspace/WORKSPACE_ARCHITECTURE.md` | Workspace system design rules |
| `workspace/_templates/Standard Workspace/` | Template for new workspaces |
| `backend/src/services/visionService.ts` | Runtime binding (prompt assembly) |
| `backend/src/services/copilotTools.ts` | Tool implementations |
| `backend/src/services/ledgerEngines.ts` | Engine layer (Ledger example) |
| `backend/services/ledgerContext.py` | Data pipeline (Ledger example) |

## Related Skills

- `pattern-detector/create-primitive` — build a new detector primitive
- `pattern-detector/create-strategy` — compose primitives into strategies
- `gitnexus/gitnexus-impact-analysis` — run before editing shared files
