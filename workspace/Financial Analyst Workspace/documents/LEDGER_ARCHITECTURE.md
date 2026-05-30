# Ledger Architecture

## Purpose

This document explains how Ledger, the Financial Analyst workspace, actually works inside Pattern Detector.

Use this when the valuation flow feels confusing or when you need to remember which layer is responsible for reasoning, tools, math, evidence, and final explanation.

## Short Version

Ledger is the agent layer.

The backend is the data and math layer.

The workspace is Ledger's doctrine layer.

The valuation engine is not supposed to decide the whole investment judgment by itself. It should return structured math and model outputs. Ledger should interpret those outputs using the workspace instructions, skill files, data contract, and evidence context.

## Runtime Flow

1. The user asks Ledger a company, valuation, risk, or financial-analysis question.
2. `visionService.ts` builds Ledger's system prompt.
3. The prompt loads workspace documents such as `AGENTS.md`, `TOOLS.md`, `DATA_CONTRACT.md`, and relevant `skills/*/SKILL.md` files.
4. Ledger decides which runtime tool to call.
5. The runtime tool gathers filing/vendor context and calls the backend engine.
6. The backend engine performs structured math and returns a typed valuation or analysis result.
7. Ledger explains the result in human language, separating facts, assumptions, derived math, and judgment.

## Main Code Paths

Prompt and agent assembly:

- `backend/src/services/visionService.ts`
- Key functions:
  - `buildFinancialAnalystPrompt`
  - `resolveFinancialAnalystWorkspaceSkills`
  - `buildWorkspacePrompt`

Workspace skill loading:

- `workspace/Financial Analyst Workspace/skills/*/SKILL.md`
- These are prompt doctrine, not separate running agents.

Tool contract:

- `backend/src/services/copilotTools.ts`
- Key functions:
  - `getCopilotToolsForAnalyst`
  - `buildCopilotToolPromptAppendixForAnalyst`
  - `executeCopilotToolCall`
  - `buildLedgerWorkflowResult`

Valuation math:

- `backend/src/services/ledgerEngines.ts`
- Key functions:
  - `runValuationEngine`
  - `resolveValuationEngineClass`
  - `runDcfValuationEngine`
  - `runReitAffoValuationEngine`
  - `runFinancialCompanyValuationEngine`
  - `runSalesScenarioValuationEngine`
  - `runSpecialSituationValuationEngine`

## Skills Are Not Subagents

Ledger skills are markdown instruction files loaded into the Ledger prompt.

They do not run independently. They do not spin up separate agents. They tell Ledger how to think, what evidence matters, what tool to call, and how to explain the result.

Examples:

- `financial-analysis` tells Ledger how to produce a full company review.
- `dcf-valuation` tells Ledger how to reason about valuation method selection.
- `reit-affo-nav-valuation` tells Ledger how to avoid forcing REITs into normal DCF logic.
- `special-situation-valuation` tells Ledger how to treat bankruptcy, restructuring, signed deals, CVRs, liquidation, and other hard events.

## Tools Are Backend Entrypoints

Ledger does not directly read databases or calculate valuation math in the prompt.

Ledger calls tools such as:

- `get_ledger_context`
- `run_financial_analysis`
- `run_earnings_quality`
- `run_dcf_valuation`
- `refresh_filing_coverage`
- `verify_special_situation_web`

The tool name `run_dcf_valuation` is legacy. It should be understood as the valuation dispatcher, not always a literal DCF.

## Valuation Dispatch

The intended valuation routing is:

| Company or situation | Engine class | Backend engine | Primary frame |
|---|---|---|---|
| Normal operating company | `dcf_operating` | `runDcfValuationEngine` | Operating DCF |
| REIT / real estate income structure | `reit_affo` | `runReitAffoValuationEngine` | AFFO / FFO / NAV |
| Bank, insurer, lender, broker, asset manager | `roe_book_value` | `runFinancialCompanyValuationEngine` | ROE / book value |
| Pre-profit or unstable cash-flow growth company | `sales_scenario` | `runSalesScenarioValuationEngine` | Revenue scenario / EV-sales |
| Bankruptcy, restructuring, signed deal, CVR, liquidation, hard event | `special_situation` | `runSpecialSituationValuationEngine` | Event value / post-reorg equity waterfall |

## How Special Situations Should Work

If filing evidence shows Chapter 11, restructuring, going-concern risk, covenant breach, forbearance, signed deal terms, cash consideration, CVR, liquidation, delisting, restatement, auditor-integrity risk, or another hard flag, Ledger should stop treating the company as a normal standalone valuation case.

The correct flow is:

1. Detect the hard flag from Ledger evidence.
2. Route valuation to `special_situation`.
3. Use the special-situation skill to frame the analysis.
4. Use backend math for deal value, break value, post-reorg equity waterfall, or probability-weighted scenarios.
5. Explain the result as special-situation valuation, not DCF.

For post-bankruptcy cases like WOLF, the required anchors are:

- post-reorg cash
- post-reorg debt
- post-reorg share count
- warrants, convertibles, contingent shares, or remaining claims
- liquidity runway
- revenue ramp
- margin recovery
- capex burden
- time to free-cash-flow breakeven
- EV/Sales, normalized EBITDA, or normalized FCF cross-check

## Workspace Versus Backend

The workspace should answer:

- What kind of company or event is this?
- Which valuation method is appropriate?
- What evidence matters?
- What should Ledger say or refuse to say?
- What assumptions must be disclosed?

The backend should answer:

- What facts are available?
- What are the calculated metrics?
- Which valuation engine did the dispatcher choose?
- What are the scenario outputs?
- What are the missing inputs?
- What are the model limitations?

Ledger's final answer should combine both:

- facts from the data layer
- math from the engine
- doctrine from the workspace
- judgment from the agent

## Common Failure Modes

1. Treating `run_dcf_valuation` as always a DCF.
   It is currently the legacy-named valuation dispatcher.

2. Assuming a workspace reference folder automatically changes backend behavior.
   It does not. The backend must explicitly load config or implement routing.

3. Adding a skill without engine support.
   The agent may know the right method, but the math layer will still be missing.

4. Adding an engine without skill support.
   The backend may calculate something, but Ledger may explain it with the wrong doctrine.

5. Ignoring hard flags.
   A hard flag should change the regime: deal analysis, distress, forensic accounting, listing risk, financing event, legal-event risk, or post-reorg valuation.

## Current Design Rule

When adding a new valuation model, update all four layers:

1. Workspace reference material under `references/valuation-models/`.
2. Workspace skill under `skills/`.
3. Backend engine and dispatcher in `ledgerEngines.ts`.
4. Tool docs / response formatting in `TOOLS.md`, `copilotTools.ts`, and `visionService.ts`.

If only one or two layers are updated, Ledger can drift: it may know the right idea but call the wrong tool, or the backend may return the right math but Ledger may explain it incorrectly.
