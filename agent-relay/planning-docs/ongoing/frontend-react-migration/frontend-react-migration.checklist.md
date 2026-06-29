# Frontend React + TypeScript Migration - Checklist

Percent complete: 1% (1 complete, 1 partial, 150 remaining)

PRD: frontend-react-migration-prd.md

Living tracker for migrating the Pattern Detector frontend from static HTML/vanilla JavaScript to React + TypeScript.

> **Companion to:** [`frontend-react-migration-prd.md`](./frontend-react-migration-prd.md)
> **Update protocol:** Tick a box only when the deliverable is shipped and verified, not when the code is merely started.

---

## Status Legend

- [x] Done and verified
- [ ] Not started
- [~] Partial or in progress

---

## Snapshot - Created 2026-05-10

Current frontend state:

- Legacy frontend lives in `frontend/public`.
- Backend serves static frontend files from `backend/src/server.ts`.
- Backend is already strict TypeScript.
- Frontend is plain JavaScript with static HTML pages.
- Several frontend files are large enough to justify migration planning:
  - `market-intelligence.js`
  - `sweep.js`
  - `workshop-scanner.js`
  - `blockly-composer.js`
  - `validator.js`
  - `history.js`
  - `index.js`
  - `settings.js`

Migration strategy:

- Keep legacy pages running.
- Add React + TypeScript alongside them.
- Migrate by feature/page.
- Wrap imperative chart/drawing/Blockly code instead of rewriting it early.

---

## Phase 0 - Inventory And Architecture Decisions

### Inventory

- [ ] Count all active HTML pages in `frontend/public`
- [ ] Count all active JS scripts in `frontend/public`
- [ ] Identify which pages are still used versus obsolete/mock pages
- [ ] Build a route map from Express routes to frontend files
- [ ] Build a script dependency map for each major page
- [ ] List all global `window.*` exports used by more than one file
- [ ] List all inline HTML handlers by page (`onclick`, `onchange`, `oninput`, etc.)
- [ ] Identify localStorage keys and ownership
- [ ] Identify duplicate UI patterns: chat panels, modals, drawers, tables, tabs, status badges, filters
- [ ] Identify API routes consumed by each frontend page

### Decisions

- [ ] Decide React app location (`frontend/app` recommended)
- [ ] Decide dev server and proxy strategy
- [ ] Decide production serving strategy (`/app` route recommended initially)
- [ ] Decide first pilot feature
- [ ] Decide whether Phase 1 type sharing is copied types, direct imports, or a shared package
- [ ] Decide which existing CSS files React should import initially
- [ ] Decide minimum test tooling for the pilot

### Exit Criteria

- [ ] Inventory doc exists or is appended to this checklist
- [ ] Migration order is documented
- [ ] Pilot feature is selected
- [ ] No runtime behavior has changed

---

## Phase 1 - React + TypeScript Foundation

### Scaffold

- [ ] Create React + TypeScript app scaffold
- [ ] Add `package.json` scripts for `dev`, `build`, `preview`, and type checking
- [ ] Add strict `tsconfig.json`
- [ ] Add Vite config
- [ ] Add root React entrypoint
- [ ] Add app shell route
- [ ] Add placeholder route under `/app`

### Backend Integration

- [ ] Configure dev proxy to backend API
- [ ] Decide where built React assets are emitted
- [ ] Add Express static serving for React build output if needed
- [ ] Ensure existing `frontend/public` routes still work
- [ ] Document local development commands

### Styling Foundation

- [ ] Import or mirror existing CSS variables from `frontend/public/styles.css`
- [ ] Port app-level layout tokens
- [ ] Create initial internal UI primitives:
  - [ ] Button
  - [ ] Input
  - [ ] Select
  - [ ] Textarea
  - [ ] Tabs
  - [ ] Modal
  - [ ] Panel
  - [ ] Status badge
  - [ ] Empty state
  - [ ] Loading state
  - [ ] Error state

### API Foundation

- [ ] Add typed API client
- [ ] Add typed API response envelope matching backend `ApiResponse<T>`
- [ ] Add fetch error handling convention
- [ ] Add abort/cancellation convention for request-heavy pages
- [ ] Add date/time formatting helper
- [ ] Add localStorage helper with JSON parse safety

### Verification

- [ ] React dev server starts
- [ ] React build succeeds
- [ ] Placeholder route loads
- [ ] Backend API call works from React dev app
- [ ] Legacy static pages still load through backend

---

## Phase 2 - Pilot Feature

Recommended pilot choices:

- Document Upload + File Chat Starter UI
- Settings page subset
- Market Intelligence operator subpanel
- Standalone research artifact viewer

### Pilot Requirements

- [ ] Feature has a dedicated folder under `features/`
- [ ] Feature has typed state
- [ ] Feature has typed props
- [ ] Feature uses shared UI primitives
- [ ] Feature avoids external UI libraries
- [ ] Feature does not rely on inline handlers
- [ ] Feature has loading, empty, and error states where applicable
- [ ] Feature has documented mock data or typed API client calls
- [ ] Feature preserves existing visual style
- [ ] Feature has a clear route

### Pilot State Management

- [ ] Identify state owner
- [ ] Use local component state where sufficient
- [ ] Use reducer if workflow has multiple events/transitions
- [ ] Persist only intentional state
- [ ] Document what state should reset on page refresh
- [ ] Document what state should survive navigation

### Pilot Verification

- [ ] TypeScript build passes
- [ ] Manual smoke test passes
- [ ] Feature can be modified without editing unrelated legacy scripts
- [ ] State flow is documented
- [ ] Follow-up gaps are listed

---

## Phase 3 - Shared UI, API, And Conventions

### Shared UI

- [ ] Promote pilot UI primitives into reusable components
- [ ] Add shared chat panel components
- [ ] Add shared table/list components if repetition appears
- [ ] Add shared filter controls
- [ ] Add shared drawer/modal pattern
- [ ] Add shared page header/action bar pattern
- [ ] Add shared form field pattern

### Shared API

- [ ] Type scanner candidate API calls
- [ ] Type market intelligence API calls
- [ ] Type strategy API calls
- [ ] Type validator API calls
- [ ] Type settings API calls
- [ ] Type execution/trades API calls
- [ ] Add one convention for query params
- [ ] Add one convention for POST/PUT payloads

### Shared State

- [ ] Identify truly app-wide state
- [ ] Keep route-local state inside route features
- [ ] Add React context only for shell-level concerns
- [ ] Avoid adding a state library until local state proves insufficient

### Verification

- [ ] New React feature can reuse shared primitives without one-off CSS
- [ ] API wrappers catch at least one class of shape errors at compile time
- [ ] No duplicate React button/modal/chat implementations appear after primitives exist

---

## Phase 4 - Page-By-Page Migration

### Candidate Migration Order

- [ ] New document/upload/chat workflows
- [ ] Settings/operator tools
- [ ] Market Intelligence panels
- [ ] Strategy workflows
- [ ] Validator workflows
- [ ] Scanner side panels and AI chat
- [ ] Execution/trading desk surfaces
- [ ] Chart-heavy scanner and drawing workflows
- [ ] Blockly/workshop composer flows

### Per-Page Migration Template

For each page:

- [ ] Define migration owner/scope
- [ ] Identify legacy HTML file
- [ ] Identify legacy JS files
- [ ] Identify consumed APIs
- [ ] Identify localStorage keys
- [ ] Identify global dependencies
- [ ] Identify visual parity requirements
- [ ] Build React route
- [ ] Build typed API layer
- [ ] Build components
- [ ] Preserve old page until parity is verified
- [ ] Smoke-test migrated route
- [ ] Document remaining legacy dependencies
- [ ] Decide whether to retire, wrap, or keep old JS

### Risk Gates

- [ ] Run GitNexus impact analysis before editing existing symbols
- [ ] Warn before proceeding if impact is HIGH or CRITICAL
- [ ] Run tests/build for migrated route
- [ ] Run `gitnexus_detect_changes()` before commit
- [ ] Confirm changed files match expected scope

---

## Phase 5 - Legacy Retirement

### Cleanup

- [ ] Remove retired inline handlers
- [ ] Remove retired `window.*` globals
- [ ] Remove retired script tags
- [ ] Delete obsolete JS files only after route parity is verified
- [ ] Delete obsolete HTML files only after route parity is verified
- [ ] Update Express route serving
- [ ] Update developer docs
- [ ] Update onboarding notes

### Final Verification

- [ ] Legacy routes that should remain still work
- [ ] React routes build and load
- [ ] TypeScript build passes
- [ ] Backend tests still pass where relevant
- [ ] Frontend smoke tests pass
- [ ] GitNexus detect-changes scope matches expected migration impact

---

## Open Questions

- [ ] Should React eventually replace the root `/` scanner route, or should the legacy scanner remain long-term?
- [ ] Should shared backend/frontend types live in a new `shared/` package?
- [ ] Should generated API schemas be introduced later?
- [ ] Which page changes most often and should be migrated first?
- [ ] Which legacy pages are obsolete enough to archive instead of migrate?
- [ ] Should Playwright be added during the pilot or after the first migrated route?

---

## Stack Recommendation

Use React + TypeScript for new substantial frontend work.

Keep vanilla JavaScript only for:

- Stable legacy pages that are not changing.
- Imperative chart/drawing internals already working well.
- Small static pages that do not justify migration.

React + TypeScript should become the default for:

- New stateful workflows.
- New API-backed pages.
- New chat, upload, settings, operator, validation, or market-intelligence UI.
- Any page expected to grow significantly.
