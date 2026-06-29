# Page-Aware AI Help / App Knowledge PRD

Checklist: ai-app-knowledge-checklist.md

**Status:** TODO

## Product Goal

Every major page in Pattern Detector should have smart AI help. When the user asks "how do I use this page?", "what should I do next?", or "what does this control mean?", the app should answer using the current page, current workflow, selected symbol/config, and page-specific reference material.

This is broader than the earlier grep-based app knowledge slice. The earlier work may be a useful retrieval mechanism, but the product is not complete until page-level help exists across the app.

## Problem

The Co-Pilot AI chat has incomplete knowledge of what each app page, setting, button, and workflow does. If a user asks "how do I use Fundamental Backtester?", "what does Max Drawdown mean?", or "what should I test next on Parameter Sweep?", the AI should not give a generic answer. It should know the current page and workflow.

## Solution

Build a page-aware help layer:

- page-level reference content for each major screen
- current page/workflow context in help requests
- retrieval over app help content when needed
- answers that explain what to do inside the actual UI
- optional current symbol/config/result context when relevant

The earlier grep/search approach can remain one implementation path: give the AI the same search primitives used in Cursor IDE, then inject relevant help content into the prompt only when needed.
## Architecture

```
User: "what does pip value mean?"
  → Frontend sends message to /api/vision/chat
  → Backend detects help-related question (keyword match)
  → Backend greps app-reference.md for "pip value" section
  → Injects those 5-10 lines into THIS request's system prompt
  → OpenAI responds with full context
  → Non-help messages: zero extra context, same as before
```

## Components to Build

### 1. App Reference File (`backend/data/app-reference.md`)
- Structured markdown with `## Section` headers per feature area
- Sections: Account Settings, Instrument Types, Risk Rules, Verdict Engine, Chart Controls, AI Settings
- Each setting gets: name, what it does, how it affects trades, example values
- Designed to be greppable by section header

### 2. Search Utilities (`backend/src/services/searchService.ts`)
Three functions mirroring Cursor's search tools:

| Function | Purpose | Implementation |
|---|---|---|
| `globFiles(pattern, dir)` | Find files by name pattern | `fs.readdirSync` + minimatch or manual pattern |
| `grepFile(pattern, filePath)` | Search file contents by regex | `fs.readFileSync` + `RegExp` line matching |
| `readSection(filePath, sectionHeader)` | Read a markdown section by header | Read file, find `## header`, return lines until next `##` |

### 3. Help Detection (`backend/src/services/visionService.ts`)
- Before calling OpenAI, check if message matches help patterns:
  - "what does/is X", "explain X", "how does X work", "help with X"
  - X matches any known setting name or feature keyword
- If match: grep `app-reference.md` for relevant section, append to system prompt
- If no match: normal flow, no extra context

### 4. Context Enrichment for Current Settings
- Frontend already sends full `settings` object in chat requests
- Backend should include current instrument-specific settings in prompt when relevant
- E.g., if instrumentType is "options", include option price / type / multiplier in context

## Files to Change

- **Create:** `backend/data/app-reference.md` — the help reference
- **Create:** `backend/src/services/searchService.ts` — glob/grep/read utilities
- **Modify:** `backend/src/services/visionService.ts` — add help detection + injection in `buildCopilotSystemPrompt()`
- **Modify:** `frontend/public/copilot.js` — send full settings context (already done)

## What This Does NOT Include

- Semantic search / embeddings (future — see BACKLOG.md)
- Chat transcript storage (future — see BACKLOG.md)
- Function calling / REPL pattern (future — save for GSD rebuild)
