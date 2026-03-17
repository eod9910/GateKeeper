# Builder Composite Awareness

> Teach the Plugin Engineer AI to check existing primitives before building, transparently report what's missing, ask the user before creating new primitives, and wire composites via JSON instead of generating monolithic Python.

## Status: Pending

## Todos

- [ ] Add GET /api/plugins/primitives endpoint to plugins.ts — returns all registered primitives with pattern_id, name, indicator_role, description
- [ ] In workshop.js: fetch primitives on page load, cache them, include in chat context
- [ ] In visionService.ts: read availablePrimitives from context, replace hardcoded list in prompt with live data
- [ ] In visionService.ts: strengthen conversation rules — hard rule to report missing primitives and ask user before generating code
- [ ] In workshop.js: update extractCodeFromResponse() to handle multiple PLUGIN_CODE/PLUGIN_DEFINITION pairs
- [ ] In workshop.js: update registerPlugin() to sequentially register each primitive before the composite

## Context

The Plugin Engineer system prompt was already updated with architecture rules (primitives vs composites, existing primitives list, composite_spec template). But the prompt alone isn't enough — the AI needs **live data** about what primitives actually exist in the registry, and the frontend needs to **send that data** as context with every chat message.

Currently the builder sends `currentCode`, `currentDefinition`, `chatHistory`, and `lastTestResult` as context. It does NOT send the list of registered primitives. The AI is working from a hardcoded list in the prompt, which will go stale as new primitives are added.

## What Needs to Change

### 1. Backend: Add primitives list endpoint

File: `backend/src/routes/plugins.ts`

Add `GET /api/plugins/primitives` that returns all registered primitives with their metadata:

```typescript
// Returns: { success: true, data: [{ pattern_id, name, indicator_role, composition, description }] }
```

Filter to only entries where `composition === "primitive"`. This gives the AI a live, accurate inventory.

### 2. Frontend: Fetch and send primitives as context

File: `frontend/public/workshop.js`

- On page load (or first chat), call `GET /api/plugins/primitives` and cache the result
- Include the primitives list in the `context` object sent with every `sendWorkshopChat()` call (line ~655):

```javascript
context.availablePrimitives = _cachedPrimitives; // [{pattern_id, name, indicator_role, description}]
```

### 3. Backend: Read primitives from context in system prompt

File: `backend/src/services/visionService.ts`

In `buildPluginEngineerPrompt()` (line ~917):

- Read `pluginContext.availablePrimitives` from context
- If present, replace the hardcoded primitives list in the prompt with the live list
- Format as a clear inventory table the AI can reference

Replace the static `## EXISTING PRIMITIVES` block with:

```
## EXISTING PRIMITIVES (live from registry)
${primitivesFromContext.map(p => `- \`${p.pattern_id}\` — ${p.name} (role: ${p.indicator_role})`).join('\n')}
```

### 4. Update system prompt conversation rules

File: `backend/src/services/visionService.ts`

Add explicit instruction to the prompt's conversation rules:

- "When the user asks for a composite indicator, FIRST check the EXISTING PRIMITIVES list. Report which primitives exist and which are missing."
- "If any primitives are missing, tell the user: 'We don't have a [X] primitive. I need to create that first. Here's what it will do: [description]. Want me to proceed?'"
- "Do NOT generate any code until the user confirms."
- "After confirmation, generate each missing primitive separately (code + definition), then generate the composite JSON wiring."

This is already partially in the prompt from the earlier update but needs to be stronger — make the ask-first behavior a hard rule, not a suggestion.

### 5. Handle multi-artifact responses in the frontend

File: `frontend/public/workshop.js`

The `extractCodeFromResponse()` function (line ~712) currently extracts ONE `===PLUGIN_CODE===` and ONE `===PLUGIN_DEFINITION===` block. For composites, the AI may output multiple primitives + one composite definition.

Update `extractCodeFromResponse()` to:

- Extract ALL `===PLUGIN_CODE===` / `===PLUGIN_DEFINITION===` pairs (not just the first)
- Return an array of artifacts: `[{ code, definition, pattern_id }]`
- The last definition (the composite) goes into the JSON editor
- Show a summary: "Generated 2 new primitives + 1 composite wiring"

### 6. Handle multi-artifact registration

File: `frontend/public/workshop.js` — `registerPlugin()` (line ~1080)
File: `backend/src/routes/plugins.ts` — `POST /api/plugins/register`

When registering a composite, the frontend needs to register each primitive first, then the composite. Options:

- **Option A (simpler)**: Sequential registration — call `/api/plugins/register` once per artifact
- **Option B**: Add a `/api/plugins/register-batch` endpoint that accepts multiple artifacts

Recommend Option A for now — simpler, and the builder UX can show a progress indicator: "Registering primitive 1/2... Registering composite..."

## Files to Change

| File | Change |
|---|---|
| `backend/src/routes/plugins.ts` | Add `GET /api/plugins/primitives` endpoint |
| `frontend/public/workshop.js` | Fetch primitives on load, send as context, handle multi-artifact extraction and registration |
| `backend/src/services/visionService.ts` | Use live primitives in prompt, strengthen ask-first rules |
