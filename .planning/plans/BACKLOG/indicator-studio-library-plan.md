# Indicator Studio and Library Plan

Status: Backlog  
Owner: Indicator Studio / Plugin Authoring  
Last Updated: 2026-03-06

## Purpose

Keep one backlog plan for the Indicator Studio and Indicator Library surface.

This file replaces:

- `indicator-studio-library-plan.md`
- `indicator-library-execution-plan.md`
- `indicator-library-external-memory-plan.md`

## Goal

Turn Indicator Studio into a coherent feature area with two responsibilities:

1. `Builder`
   create, test, edit, and register indicators
2. `Indicator Library`
   browse, inspect, filter, load, and manage the registered indicator catalog

The library also needs to support AI workflows:

- awareness of existing indicators before generation
- metadata autofill consistency
- duplicate detection
- compact external memory instead of dumping registry content into prompts

## Scope

### In scope

1. Indicator Studio naming and information architecture
2. Builder and Library sub-navigation
3. library read APIs
4. registry-backed metadata normalization
5. duplicate detection rules
6. generated library memory artifact for AI
7. load-from-library into Builder

### Out of scope

1. execution engine redesign
2. major strategy-page redesign
3. broad plugin runtime changes

## Product Shape

### Builder

Purpose:

- AI-assisted indicator creation
- source editing
- testing
- registration

Required behavior:

- AI should return usable metadata by default
- Builder can open an existing indicator from the library
- register/update should refresh library state

### Indicator Library

Purpose:

- catalog of all indicators and patterns
- searchable/filterable human review surface
- source for duplicate checks and metadata consistency

Core sections:

1. summary stats
2. search and filters
3. result list
4. details panel
5. `Load to Builder` action

## Data Model

Canonical source:

- `backend/data/patterns/registry.json`

Derived artifact:

- `backend/data/patterns/indicator-library.md`

The markdown artifact is derived only from the registry and should never become a hand-edited source of truth.

## API Direction

Keep or add these read surfaces:

1. `GET /api/plugins`
   registry/category listing
2. `GET /api/plugins/:id`
   full definition
3. `GET /api/plugins/:id/source`
   source code for Builder loading
4. library summary endpoint if needed for cleaner UI reads
5. markdown endpoint if AI context needs the generated library view

## Duplicate and Metadata Rules

AI-generated indicators should always produce:

1. `pattern_name`
2. `pattern_id`
3. `category`

Duplicate policy:

- high-confidence duplicate
  block or require confirmation
- medium-confidence duplicate
  warn
- low-confidence duplicate
  allow

Normalization should be based on canonical registry values, not free-form prompt memory.

## Implementation Phases

### Phase 1: Studio shell

1. stabilize `Indicator Studio` naming
2. add `Builder` and `Indicator Library` tabs or routes
3. keep Builder behavior intact

### Phase 2: Library read surface

1. fetch registry-backed library data
2. render filters and list
3. show detail panel
4. add `Load to Builder`

### Phase 3: Metadata discipline

1. enforce metadata defaults in generation output
2. add duplicate warnings
3. regenerate derived library memory on register/update

### Phase 4: AI context integration

1. preload compact library context
2. let AI see existing indicators before generating new ones
3. stop name/id/category drift

## Acceptance Criteria

This backlog item is done when:

1. Indicator Studio has a usable library surface
2. Builder and Library stay in sync after registration
3. duplicate checks run before register
4. AI-generated indicators default to valid metadata
5. registry and derived library memory do not drift

## Related Plans

- `REFERENCE/builder-composite-awareness.md`
- `REFERENCE/design-system-v4.md`
- `REFERENCE/strategy-authoring-guide.md`
