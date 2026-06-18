# Coding Conventions

Analysis date: 2026-06-02
Status: Current orientation reference

## General

- Prefer existing local patterns over new abstractions.
- Keep edits scoped to the feature area.
- Preserve user/worktree changes you did not make.
- Use `rg` for search.
- Use `apply_patch` for manual file edits.
- For code changes, follow GitNexus impact/change-check requirements in `AGENTS.md`.

## File Naming

- Backend route files use camelCase or domain names: `marketIntelligence.ts`, `ledgerHydration.ts`, `savedCharts.ts`.
- Backend service files use camelCase: `visionService.ts`, `marketIntelligenceDb.ts`, `sweepEngine.ts`.
- Python files use snake_case: `fundamentals_pit_store.py`, `run_fundamental_backtester.py`.
- Frontend page files generally use kebab-case HTML and matching or domain-specific JS: `market-intelligence.html`, `market-intelligence.js`, `fundamental-backtester.js`.
- Planning files use lowercase kebab-case PRD/checklist pairs.

## Backend TypeScript

- Strict TypeScript is enabled.
- Most backend code uses CommonJS output with ES2020 target.
- Route files should validate/normalize request inputs and delegate work to services.
- Service files should hold durable domain logic, persistence helpers, schedulers, and integrations.
- Keep API routes stable where frontend pages already depend on them.

## Frontend

- The frontend is static HTML/CSS/JS without a bundler.
- Many pages use globals and page-specific modules.
- Shared behavior exists but is not fully modularized.
- Avoid breaking script load order.
- For UI changes, match the app's dense, work-focused design language.

## Python

- Python services/scripts are mixed between runtime services and research utilities.
- Runtime-ish services include validator, strategy runner, plugin service, fundamentals/PIT, quote, ledger, social, and symbol catalog pieces.
- Research scripts are often one-off but may become important artifacts; do not delete them casually.

## Planning

- Active/TODO/completed work should use PRD/checklist pairs.
- Reference docs live under `.planning/plans/REFERENCE`.
- Read `.planning/plans/PLAN_CONVENTIONS.md` before reorganizing planning files.

## Testing

- Prefer the narrowest relevant test first.
- For backend service changes, look for a matching `npm run <domain>:test`.
- For Python changes, use `py -m py_compile` and relevant unittest/script smoke tests.
- For frontend changes, use `node --check` on touched JS and visual inspection when layout matters.
