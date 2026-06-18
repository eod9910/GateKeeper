# Workspace Tools

## Active Runtime Tools

The deterministic training coach is already active in backend code:

- `GET /api/training/coach`
  - backend route: `backend/src/routes/training.ts`
  - engine: `backend/src/services/training/coachEngine.ts`
  - purpose: computes baseline stats, diagnostics, slices, and ranked rule-based observations.

- `GET /api/training/report`
  - backend route: `backend/src/routes/training.ts`
  - engine: `backend/src/services/training/reportEngine.ts`
  - purpose: returns broader session and backtest-style training summaries.

## Skill To Tool Map

- `training-coach`
  - active deterministic input: `GET /api/training/coach`
  - supporting report input: `GET /api/training/report`
  - planned LLM endpoint: `POST /api/training/ai-coach`
  - backend prompt service: planned `backend/src/services/training/aiCoachEngine.ts`

## Tool Boundaries

- The AI coach must not recompute the user's official stats.
- The AI coach must not infer hidden trade outcomes from chart appearance.
- The AI coach may interpret provided metrics, observations, and recent attempts.
- The deterministic report remains the source of truth for numbers.
- The planned LLM endpoint should receive a compact summary, not the full database.

## Planned Future Tools

- `POST /api/training/ai-coach`
  - accepts deterministic coach report, recent attempts, session context, and optional user question.
  - returns structured coaching JSON.
  - should cache responses until a new attempt is resolved or the user explicitly refreshes.

- `GET /api/training/ai-coach/cache`
  - returns latest cached AI coach read for the active contract.

- `GET /api/training/ai-coach/input-preview`
  - returns the exact compact payload that would be sent to the LLM for transparency.

