# Frontend React + TypeScript Migration - PRD

## Purpose

Migrate the frontend from static HTML plus large vanilla JavaScript files to an incremental React + TypeScript application architecture.

The goal is not a cosmetic rewrite. The goal is to make future frontend work safer, easier to extend, easier for AI coding agents to modify, and better aligned with the TypeScript backend contracts that already exist.

## Problem

The current frontend is served from `frontend/public` as static HTML and JavaScript. That worked well for fast iteration, but the UI has grown into a substantial application:

- Many large per-page scripts.
- Inline HTML event handlers.
- Shared globals attached to `window`.
- Manual DOM selection and `innerHTML` rendering.
- Ad hoc page-level state in module globals and localStorage.
- Backend TypeScript types that are not enforced in the frontend.

This makes changes increasingly risky. Adding features often requires knowing which DOM ids, globals, script order, and local state variables are involved. The system can still be extended, but the cost of understanding and safely modifying each screen is rising.

## Product Thesis

Pattern Detector is becoming a rich operator application: scanner, trading desk, validation, strategy builder, workshop, market intelligence, settings, history, execution, charts, and AI panels.

That shape fits a typed component architecture better than standalone HTML pages with global JavaScript. React + TypeScript should improve maintainability because the product already has:

- Reusable layout and panel patterns.
- Repeated chat panels.
- Repeated list/table/filter flows.
- Stateful modals and drawers.
- API-backed views.
- Backend type definitions that can become frontend contracts.
- Complex UI behavior that benefits from explicit component boundaries.

## Goals

1. Introduce a React + TypeScript frontend without breaking the existing static frontend.
2. Migrate new and high-change UI surfaces first.
3. Preserve the existing visual language from `frontend/public/styles.css` and `STYLE_GUIDE.md`.
4. Reuse backend TypeScript contracts where possible.
5. Reduce reliance on global `window` APIs and inline event handlers.
6. Make state ownership explicit at page, feature, and component boundaries.
7. Keep imperative chart/drawing engines working during migration.
8. Improve AI-agent editability through typed props, smaller files, and predictable structure.

## Non-Goals

1. Do not rewrite the entire frontend in one pass.
2. Do not replace charting, drawing, or Blockly engines unless a specific migration requires it.
3. Do not introduce an external UI component library.
4. Do not redesign the product visually.
5. Do not move backend routes or change API behavior solely for this migration.
6. Do not block current product work while migration infrastructure is being introduced.

## Current Frontend Assessment

Current state:

- Frontend static files live in `frontend/public`.
- Backend serves static frontend assets from `backend/src/server.ts`.
- HTML pages load shared and page-specific scripts directly.
- Large scripts include `market-intelligence.js`, `sweep.js`, `workshop-scanner.js`, `validator.js`, `history.js`, `index.js`, and others.
- Existing app-wide helpers are exposed via globals such as `window.AppState` and `window.AppCollapse`.
- Backend TypeScript types exist under `backend/src/types`.

Key risks if the current model continues:

- State changes are hard to trace across files.
- Script load order can become a hidden dependency.
- Inline event handlers couple markup to global function names.
- Large files make targeted AI edits less reliable.
- API response shape drift is caught late, usually at runtime.
- Reusable UI patterns are copied rather than encoded as components.

## Target Architecture

### High-Level Shape

Add a React + TypeScript app alongside the existing static frontend.

Suggested structure:

```text
frontend/
  public/
    legacy static HTML/CSS/JS
  app/
    package.json
    tsconfig.json
    vite.config.ts
    index.html
    src/
      main.tsx
      app/
        App.tsx
        routes.tsx
      components/
        layout/
        ui/
        charts/
        chat/
      features/
        scanner/
        market-intelligence/
        settings/
        documents/
      api/
        client.ts
        types.ts
      state/
      styles/
```

The exact folder names can change, but the core rule is:

- `components/` contains reusable UI.
- `features/` contains product-specific flows.
- `api/` contains fetch wrappers and typed response helpers.
- `state/` contains shared client state only when state crosses feature boundaries.

### Serving Strategy

Phase 1 should keep the backend serving `frontend/public` exactly as it does today.

The React app can be served in one of two ways:

1. Development mode: run Vite separately on a frontend dev port and proxy API requests to the backend.
2. Production/local integrated mode: build React assets and serve the built output from Express under a new route such as `/app` or as a gradually expanded replacement for static pages.

The first migration should avoid changing every route. A safe pattern is:

- Existing pages stay where they are.
- New React app is mounted under `/app`.
- Individual migrated workflows get React routes such as `/app/market-intelligence` or `/app/documents`.

### Type Sharing

The backend already has strict TypeScript types. The React app should consume shared API-facing types in a controlled way.

Acceptable initial options:

1. Import selected backend `src/types` files through a shared path if tooling supports it cleanly.
2. Copy API-facing types into `frontend/app/src/api/types.ts` during the first phase, then extract a proper shared package later.
3. Create a workspace-level `shared/` package once migration has enough surface area to justify it.

Do not create a complex monorepo package system before there is a migrated feature using it.

### State Management

Default to React local state and reducer state.

Use:

- `useState` for component-local UI state.
- `useReducer` for feature workflows with multiple transitions.
- URL query params for shareable filters and selected records.
- `localStorage` only behind small typed helpers.
- React context only for app-wide concerns such as user preferences, shell state, or shared service clients.

Avoid adding Redux, Zustand, or another state library until a specific cross-feature state problem proves local React state is insufficient.

### UI System

The migration should preserve the current product feel.

Rules:

- Reuse existing CSS variables and tokens from `styles.css`.
- Port shared layout primitives before redesigning screens.
- Build small internal components for buttons, tabs, panels, modals, tables, empty states, status badges, chat input, and file/upload controls.
- Do not add an external UI library.
- Keep charts and drawing tools wrapped in stable React boundaries rather than rewriting chart internals.

## Migration Phases

### Phase 0 - Inventory And Decision Gates

Deliverables:

- Frontend inventory by page, script, owner, dependencies, and risk.
- List of globals that need wrappers or retirement.
- Candidate migration order.
- Decision on Vite app location and route mounting strategy.
- Decision on first pilot feature.

Exit criteria:

- Existing static frontend still runs.
- No app behavior changes.
- Migration order is documented.

### Phase 1 - React + TypeScript Foundation

Deliverables:

- Vite React TypeScript app scaffold.
- TypeScript strict mode enabled.
- API client with typed response envelope support.
- Shared styling bridge that imports or mirrors current tokens.
- Basic app shell matching existing navigation language.
- Dev proxy to backend API.
- Build script and backend serving plan.

Exit criteria:

- `npm run dev` starts the React frontend.
- `npm run build` succeeds.
- A placeholder React route loads without breaking legacy pages.
- Backend API calls work from the React app in dev mode.

### Phase 2 - Pilot Feature

Recommended pilot: Document Upload + File Chat Starter UI, Settings, or another isolated workflow.

The pilot should prove:

- Component organization.
- Feature state management.
- Mock and real API boundaries.
- Form controls.
- List rendering.
- Chat panel behavior.
- Styling consistency.
- Test strategy.

Exit criteria:

- Pilot feature is feature-complete.
- No external UI library is used.
- State flow is documented.
- Audit compares React implementation against current vanilla patterns.

### Phase 3 - Shared UI And API Contracts

Deliverables:

- Shared internal UI components for common patterns.
- Typed API wrappers for high-use backend routes.
- Shared date/time, status, and formatting helpers.
- Error/loading/empty state conventions.
- Legacy-to-React route transition conventions.

Exit criteria:

- New React features no longer create one-off button/table/modal/chat implementations.
- API shape mismatches are caught by TypeScript wherever typed wrappers exist.

### Phase 4 - Migrate High-Change Pages

Prioritize pages that change often or have high state complexity.

Suggested order:

1. New document/upload/chat workflows.
2. Settings or operator tools.
3. Market Intelligence panels.
4. Strategy/validator workflows.
5. Scanner side panels and AI chat.
6. Execution/trading desk surfaces.
7. Chart-heavy and drawing-heavy screens last.

Exit criteria:

- Each migrated page has a documented owner, route, feature folder, and rollback path.
- Legacy page remains available until React parity is verified.
- Known high-risk workflows are smoke-tested after migration.

### Phase 5 - Legacy Retirement

Deliverables:

- Remove retired inline handlers and global exports only after migrated routes are verified.
- Delete or archive legacy scripts after no active route imports them.
- Simplify Express route serving once React owns the intended surface.
- Update docs and onboarding instructions.

Exit criteria:

- No active route depends on retired files.
- Build and smoke tests pass.
- GitNexus detect-changes review confirms expected impact before commit.

## Testing Strategy

Start pragmatic:

- TypeScript build as the first safety net.
- Focused unit tests for pure helpers and reducers.
- Component tests for high-value stateful components if test tooling is added.
- Playwright smoke tests for migrated user workflows.
- Manual screenshots for layout-sensitive pages.

Minimum smoke coverage for each migrated feature:

1. Page loads.
2. Primary data request succeeds or mock data renders.
3. Loading state appears where expected.
4. Error state appears when request fails.
5. Main user action works.
6. State persists or resets according to the feature contract.

## Risks

### Migration Takes Too Long

Mitigation:

- Migrate by route or feature.
- Keep legacy pages working.
- Do not block unrelated backend work.

### React App Diverges Visually

Mitigation:

- Reuse existing CSS variables.
- Create shared internal UI primitives early.
- Compare migrated routes against existing pages.

### Chart And Drawing Integrations Become Messy

Mitigation:

- Wrap imperative chart engines behind React components.
- Do not rewrite drawing internals during early phases.
- Use refs and lifecycle cleanup carefully.

### Type Sharing Becomes Overengineered

Mitigation:

- Start with copied or directly imported API-facing types.
- Extract a shared package only when duplication becomes a real problem.

### Legacy Globals Linger Forever

Mitigation:

- Track globals in the checklist.
- Mark each as keep, wrap, migrate, or delete.
- Require retirement notes for migrated pages.

## Success Criteria

The migration is working if:

- New frontend features are faster to add in React than in legacy JS.
- Large scripts stop growing for migrated surfaces.
- API response drift is caught at build time for typed routes.
- UI behavior is easier to reason about from component state.
- AI coding agents can modify features with fewer unrelated edits.
- The current static frontend remains usable during migration.

## Decision

Adopt React + TypeScript for new substantial frontend work.

Do not perform a big-bang rewrite. Build the React foundation, migrate one self-contained workflow first, then move high-change pages over in slices.

