# Co-Pilot AI App Knowledge (Grep-Based Retrieval)

**Status:** IMPLEMENTED

## Problem

The Co-Pilot AI chat (OpenAI) has no knowledge of what the app's settings, buttons, and features do. If a user asks "what does Max Drawdown mean?" or "how does the Options sizing work?", the AI can't answer — it only knows about Wyckoff patterns and the current trade context.

## Solution

Give the AI the same search primitives used in Cursor IDE: **glob**, **grep**, and **read**. These run on the backend (Node.js) and inject relevant help content into the AI prompt only when needed.

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
