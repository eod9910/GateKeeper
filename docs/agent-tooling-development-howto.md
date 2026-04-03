# Agent Tooling Development How-To

Date: 2026-04-01  
Status: Reusable internal playbook

## Purpose

This document captures the development patterns worth reusing from the Claude Code architecture material we reviewed, but translated into the actual needs of this repo.

This is not a generic multi-agent manifesto.

It is a practical guide for building and evolving:

- `Ledger`
- filing-analysis workers
- PIT-backed financial workflows
- isolated experiment labs
- reusable prompt/tool workflows
- memory and checkpoint discipline

Use this whenever we add a new agent, tool, workflow, experiment harness, or retrieval-backed analysis path.

## Why This Exists

We already have a strong `workspace-per-agent` pattern, but our development process can still drift into:

- one-off experiments with no manifest or report
- agent behavior that lives only in prompts and terminal memory
- tools with unclear trust and side-effect boundaries
- repeated rediscovery of the same extraction findings
- analysis paths that are hard to promote safely into production

This guide is meant to prevent that.

## What We Are Borrowing

From the Claude Code architecture material, the parts worth adopting are:

- a strict tool contract
- reusable skill/workflow packaging
- clear coordinator vs worker separation
- memory/checkpoint discipline
- explicit source and permission boundaries

What we are **not** trying to copy:

- unnecessary swarm complexity
- heavyweight orchestration for its own sake
- generic “agents everywhere” design without clear responsibilities

## Core Principles

### 1. Coordinator Thinks, Workers Execute

Use one top-level reasoning agent or app flow as the coordinator.

Its job is:

- decide what needs to be done
- choose which worker or workflow should do it
- synthesize results
- explain uncertainty

Worker responsibilities should be narrower:

- fetch filing package
- extract core facts
- scan narrative sections
- retrieve evidence chunks
- compare current and prior filing
- produce a focused result

The coordinator should not absorb every implementation detail.

### 2. Tools Are Contracts, Not Just Functions

Every meaningful capability should behave like a tool with a defined contract.

At minimum, every tool or script should have:

- a clear purpose
- explicit input shape
- explicit output shape
- side-effect notes
- permission/trust level
- concurrency expectation
- failure mode

If we cannot describe a tool this way, it is too vague to depend on.

### 3. Skills Are Reusable Workflows

A skill is not just a prompt.

For this repo, treat a skill/workflow as:

- a named reusable procedure
- with expected inputs
- an expected outcome
- optional tools/scripts it may call
- a consistent output contract

Examples we should eventually formalize:

- review latest filing
- compare two filings
- extract core facts
- detect hidden liquidity risk
- prepare backtest factor set

### 4. Sandboxes First, Promotion Second

Any risky, exploratory, or architecture-changing work should begin in an isolated lab.

Only promote it when:

- the quality improvement is measurable
- the validation panel does not regress
- the runner is reproducible
- the production responsibility is clear

### 5. Memory Must Be Deliberate

Do not rely on:

- terminal scrollback
- “I think we already proved that”
- ad hoc recollection across sessions

Every meaningful experiment or architecture decision should leave behind:

- a short note
- a machine-readable report
- a promotion decision or next-step gate

## Repo-Specific Architecture

This repo already has the right high-level separation.

### Shared Production Surface

The main repo is the production surface for:

- backend runtime
- PIT storage
- SEC and Docling scripts
- app contracts
- planning and memory

### Specialized Agent Workspaces

The repo also already uses specialized workspaces such as:

- `workspace/Financial Analyst Workspace`

That pattern should remain.

Each workspace should represent:

- a role
- a reasoning contract
- a clear input/output boundary

### Isolated Experiment Areas

Use isolated labs for anything we are not ready to trust yet.

Current model:

- `Financial data/docling_probe/experiments/xbrl_lab`

That is the correct pattern.

## Recommended System Shape

### Layer 1: System Of Record

Use SQLite/PIT for:

- structured facts
- document metadata
- coverage state
- evidence references
- derived risk signals
- run metadata where exact querying matters

### Layer 2: Provenance Files

Keep on disk:

- raw SEC HTML
- Docling JSON
- Docling markdown
- extracted artifacts
- experiment outputs

### Layer 3: Retrieval Layer

Use chunked filing narrative for:

- MD&A
- risk factors
- debt/covenant text
- accounting-policy changes
- unusual narrative disclosures

### Layer 4: Coordinator / Ledger Layer

Ledger should synthesize:

- structured facts from PIT
- retrieved narrative evidence
- explicit judgments with confidence and provenance

## Standard Roles We Should Use

### 1. Coordinator

Use for:

- deciding the analysis plan
- choosing workers
- collecting outputs
- producing the final user-facing synthesis

In our case this is effectively:

- Ledger app orchestration
- or the top-level financial-analysis request flow

### 2. Fact Worker

Use for:

- XBRL or `companyfacts` ingestion
- PIT statement loading
- exact point-in-time structured facts

### 3. Evidence Worker

Use for:

- retrieving filing sections
- chunk lookup
- note and MD&A evidence selection

### 4. Risk Review Worker

Use for:

- narrative risk scan
- contradiction checks
- change detection between filings

### 5. Experiment Worker

Use only in isolated labs for:

- parser comparisons
- extraction-family testing
- retrieval strategy experiments

## Standard Tool Model

When adding a new tool, script, or workflow, document it in this shape.

### Tool Definition Checklist

- Name
- Purpose
- Inputs
- Outputs
- Source(s) touched
- Side effects
- Read-only or mutating
- Concurrency-safe or not
- Retry/backoff expectations
- Provenance expectations
- Failure behavior

### Example: Filing Chunk Retrieval Tool

- Name: `retrieve_filing_chunks`
- Purpose: find relevant narrative evidence for a symbol and filing
- Inputs:
  - `symbol`
  - `form`
  - `query`
  - `asof_date`
  - optional section filters
- Outputs:
  - chunk ids
  - chunk text
  - section metadata
  - filing metadata
  - retrieval score
- Side effects: none
- Trust level: read-only
- Failure mode: return no chunks rather than inventing evidence

## Standard Workflow Model

Every reusable workflow should have:

- a name
- trigger conditions
- allowed tools/data sources
- expected outputs
- downgrade behavior when data is incomplete

### Example: Review Latest Filing

Inputs:

- `symbol`
- `asof_date`
- `coverage_tier`

Workflow:

1. resolve symbol coverage
2. fetch latest `10-K` and recent `10-Q` metadata
3. load structured statement backbone from PIT
4. retrieve relevant narrative chunks
5. run issue checks
6. return judgments plus evidence refs

Outputs:

- summary of what changed
- major risks
- contradictions between numbers and narrative
- confidence level
- evidence refs

## How To Build New Capabilities

Use this order every time.

### Step 1: Decide The Responsibility

Before coding, decide whether the new capability belongs to:

- PIT / structured facts
- retrieval / narrative evidence
- Ledger reasoning
- experiment harness

Do not mix these casually.

### Step 2: Pick The Right Surface

Use:

- main repo production code for stable functionality
- workspace docs/contracts for reasoning behavior
- experiment lab for uncertain approaches

### Step 3: Define Inputs And Outputs First

Before building a new worker, script, or tool, write down:

- what goes in
- what comes out
- what is optional
- what counts as insufficient evidence

### Step 4: Build The Smallest Useful Path

Do not start with universal scope.

Start with:

- one capability
- one metric family
- one retrieval path
- one validation panel

### Step 5: Validate By Family, Not By Issuer

This is one of the most important rules for Ledger.

If a new extractor or retrieval rule only works for one issuer, it is not ready.

Validation should be against a filing-family panel, for example:

- table-friendly issuer
- text-flattened issuer
- unusual date/period issuer
- sector/layout variation

### Step 6: Write A Report

Every meaningful experiment or rollout should leave:

- machine-readable report
- short findings summary
- promotion decision

### Step 7: Promote Carefully

Move something out of sandbox only if:

1. it improves quality materially
2. it does not regress the validation panel
3. it has a clear runtime owner
4. it has a rollback path

## Recommended Directory Pattern

For reusable experiments, prefer this shape:

```text
<experiment_root>/
  manifest.json
  runner.py
  reports/
    latest.json
    run_*.json
  FINDINGS.md
  PROMOTION.md
```

For reusable production workflows, prefer:

```text
<feature_root>/
  scripts/
  services/
  tests/
  README.md or contract doc
```

## Memory And Checkpoint Discipline

### Always Record

- what was tested
- what improved
- what failed
- what remains uncertain
- what should happen next

### Good Places To Record It

- `memory-bank/LATEST.md`
- active planning docs under `.planning/plans/ACTIVE/`
- experiment `FINDINGS.md`
- workspace contracts such as `workspace/Financial Analyst Workspace/DATA_CONTRACT.md`

### Avoid

- decision-making that only exists in shell history
- experiments with no manifest
- “temporary” scripts with no output report

## Permission And Trust Model

Treat every data source and workflow according to trust level.

### High-Trust Structured Sources

- `companyfacts`
- PIT rows already normalized and validated

### Medium-Trust Sources

- raw SEC filings
- Docling output
- retrieval chunks

### Lower-Trust Outputs

- heuristic extraction
- inferred periods
- language-model judgments over narrative text

The lower the trust, the more explicit the provenance and caveats must be.

## How To Add A New Financial Workflow

Use this checklist.

### Example: Add “Debt Risk Review”

1. Define the question.
   - “Is there meaningful debt, covenant, refinancing, or liquidity risk?”
2. Identify fact backbone.
   - debt facts
   - current liabilities
   - cash
   - operating cash flow
3. Identify retrieval targets.
   - liquidity section
   - debt footnotes
   - covenant disclosures
   - risk factors
4. Define evidence refs.
   - PIT fact ids
   - filing chunk ids
   - accession number
5. Define output.
   - finding
   - severity
   - confidence
   - evidence refs
6. Validate on several issuer families.
7. Record findings and promotion decision.

## How To Add A New Agent Workspace

Only add a new agent workspace when the role is stable enough to justify it.

A new workspace should have:

- a clear role name
- explicit inputs
- explicit outputs
- guardrails
- allowed inference scope
- memory file(s)
- one or more reusable workflows

Do not create a new workspace just because a task is large.

Create one when the role itself is durable.

## How To Evaluate A New Package Or Parser

Use this exact process.

### 1. Isolate It

Create a lab under an experiment root.

### 2. Define The Metric

Examples:

- `8/8` core metrics recovered
- exact period recovery
- zero-metric failure rate
- evidence quality

### 3. Use A Validation Panel

Do not cherry-pick only easy issuers.

### 4. Compare Against Current Baseline

Every report should say:

- current baseline
- candidate result
- delta

### 5. Decide

- promote
- park
- discard

## Ledger-Specific Implementation Guidance

For this repo, the recommended shape is:

### Structured Backbone

Prefer:

- `companyfacts`
- PIT statement facts

Use for:

- revenue
- margins
- assets
- liabilities
- equity
- cash flow
- capex
- derived free cash flow

### Narrative Insight Layer

Prefer:

- recent `10-K`
- recent `10-Q`
- chunked Docling narrative

Use for:

- management tone
- liquidity stress
- debt terms
- concentration
- accounting changes
- legal/regulatory issues
- hidden or understated risk

### Ledger Output Layer

Ledger should answer:

- what changed
- what matters
- what looks risky
- what contradicts the narrative
- what evidence supports the claim

## Anti-Patterns

Do not:

- let one issuer create a one-off permanent rule
- treat retrieval as source-of-truth for numeric facts
- let tools mutate state without clear contracts
- promote experiments with no reproducible runner
- rely on memory instead of reports
- let the coordinator become a giant all-purpose worker
- pretend low-confidence evidence is definitive

## Promotion Gate

Before moving a workflow or experiment into the main path, confirm:

1. the responsibility is clear
2. inputs and outputs are stable
3. the validation panel passes
4. provenance is preserved
5. downgrade behavior exists for weak coverage
6. the memory bank and relevant contracts are updated

## Suggested Near-Term Reuse In This Repo

The most immediate uses of this guide are:

- formalizing Ledger filing-review skills
- separating coordinator logic from fact/evidence workers
- turning retrieval chunking into a contract-backed tool
- standardizing experiment manifests and reports
- promoting the best `companyfacts + Docling` hybrid path safely

## Proactive Agent Mode

The Claude Code architecture material also describes a more ambitious idea:

- an always-on proactive assistant
- periodic heartbeat/tick prompts
- append-only logs
- background memory consolidation
- proactive notifications and scheduled work

We should treat that as inspiration, not as something to copy blindly.

### What Is Relevant To This Repo

For `pattern-detector`, the relevant idea is:

- a future `Ledger` mode that can notice important changes without waiting for a manual prompt

Examples:

- a new `10-Q` lands for a covered symbol
- a filing introduces new liquidity stress language
- a company adds dilution language or debt risk
- a backtest or factor run finishes with a meaningful result
- a tracked watchlist symbol materially deteriorates

The point is not “AI doing random things.”

The point is:

- background noticing
- disciplined action
- explicit logging
- user-visible notification only when warranted

### What To Borrow

The useful parts to borrow are:

- a periodic heartbeat model
- append-only action logs
- scheduled/recurrent tasks
- explicit notification channels
- background consolidation of notes/memory

### What Not To Borrow

Do not copy:

- unconstrained autonomy
- silent editing with weak auditability
- broad background write permissions
- a system that acts without clear boundaries

For this repo, any proactive mode must be:

- scoped
- auditable
- reversible
- coverage-aware

### Recommended `Ledger` Proactive Model

If we add proactive behavior later, it should be split into four phases.

#### 1. Notice

Background checks detect whether anything important changed.

Possible triggers:

- new filing for a `ledger_filing_eligible` symbol
- new earnings event
- material PIT fact change
- unusual retrieval hit in narrative evidence
- completed research/backtest run

#### 2. Evaluate

Before acting, run a narrow evaluation step:

- is this materially relevant?
- is coverage strong enough?
- is evidence sufficient?
- is this a true issue or just noise?

#### 3. Act

Allowed actions should be tightly scoped, for example:

- produce a review note
- update a watchlist/status artifact
- queue a deeper analysis task
- send a notification

High-risk actions should remain gated.

Examples of actions that should stay gated unless explicitly enabled:

- changing production code
- sending external messages
- publishing public content
- making trading decisions

#### 4. Log

Every proactive action should be recorded in an append-only style log:

- what was noticed
- what evidence was used
- what judgment was made
- what action was taken
- when it happened

### Good First Proactive Uses For This Repo

If we ever implement this, start narrow.

Best first candidates:

- new-filing detection for tracked symbols
- automatic “latest filing changed” review jobs
- nightly research/checkpoint summaries
- completed backtest notifications
- low-confidence data-quality alerts

Avoid starting with:

- autonomous code changes
- autonomous messaging to external parties
- broad self-directed task creation with no human review

### Suggested Proactive Data Contract

Any future proactive event should look like a structured record:

- `event_id`
- `event_type`
- `detected_at`
- `symbol`
- `coverage_tier`
- `trigger_source`
- `evidence_refs`
- `judgment_summary`
- `action_taken`
- `confidence`
- `requires_review`

### Suggested Proactive Modes

If we implement this later, define modes explicitly.

- `observe_only`
  - detect and log, but do not notify
- `notify_only`
  - detect, log, and notify
- `queue_analysis`
  - detect, log, and create a follow-up analysis task
- `assisted_action`
  - perform a narrow approved action after evaluation

Do not start with a fully autonomous mode.

### Guardrails For Future Implementation

Any proactive agent mode in this repo should satisfy these rules:

1. It must be coverage-tier aware.
2. It must not present vendor-only coverage as filing-backed certainty.
3. It must log every proactive action.
4. It must distinguish noticing from acting.
5. It must support silent dry-run / observe-only mode.
6. It must preserve evidence refs for every non-trivial claim.
7. It must be easy to disable.

### Near-Term Interpretation

We are not implementing a `KAIROS` clone now.

What we are doing now is laying the groundwork:

- stronger facts in PIT
- retrieval-ready filing chunks
- evidence contracts
- Ledger reasoning contracts
- reusable agent/workflow patterns

Those are the prerequisites for any future proactive mode that is actually useful instead of noisy.

## Related Internal Docs

- [workspace-agent-harness-plan.md](../.planning/plans/ACTIVE/workspace-agent-harness-plan.md)
- [ledger-data-storage-and-retrieval-architecture.md](../.planning/plans/ACTIVE/ledger-data-storage-and-retrieval-architecture.md)
- [DATA_CONTRACT.md](../workspace/Financial%20Analyst%20Workspace/DATA_CONTRACT.md)
- [ledger-normalization-family-design.md](../.planning/plans/ACTIVE/ledger-normalization-family-design.md)

## Practical Default

When in doubt, use this default:

1. start in an isolated lab
2. define the contract before the implementation
3. validate by family, not by issuer
4. write the report
5. promote only what is measurable and repeatable
