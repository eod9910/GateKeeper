# Market Intelligence — API Fixtures (Phase 0)

Canonical example responses (and a few example requests) for every endpoint in
[`market-intelligence-api-contract.md`](../../market-intelligence-api-contract.md).

> **Source-of-truth rules:**
> 1. The contract document wins over these fixtures.
> 2. The TypeScript types in `backend/src/types/marketIntelligence.ts` win over the contract.
> 3. These fixtures are illustrative — they are NOT auto-checked against runtime responses yet
>    (Phase 5 deliverable: schema-validated fixture suite + CI gate).

## How fixtures were generated

| Group | Origin |
|---|---|
| `get_*.json` (Phase 1 endpoints) | Live capture from `http://localhost:3002/api/market-intelligence/*` (server build still on `expected_schema_version=2`; live DB is at v5) |
| `get_emerging_topics*`, `get_coverage_tiers_*`, `get_scenarios_id_candidates.json` | Hand-written from contract examples — endpoints not yet implemented |
| `post_*.json` / `put_settings.json` | Hand-written from contract §3 + §4 examples — endpoints not yet implemented or not exercised live |

## File layout

| File | Endpoint | Source |
|---|---|---|
| `get_healthcheck.json` | `GET /healthcheck` | live |
| `get_themes.json` | `GET /themes` | live |
| `get_settings.json` | `GET /settings` | live |
| `get_scheduler_status.json` | `GET /scheduler/status` | live |
| `get_scenarios_default.json` | `GET /scenarios` (no params) | live |
| `get_scenarios_id_detail.json` | `GET /scenarios/:id_or_slug` | live |
| `get_scenarios_id_evidence.json` | `GET /scenarios/:id_or_slug/evidence` | live |
| `get_scenarios_id_candidates.json` | `GET /scenarios/:id_or_slug/candidates` | hand (Phase 3) |
| `get_emerging_topics.json` | `GET /emerging-topics` | hand (Phase 2) |
| `get_emerging_topics_id_authenticity.json` | `GET /emerging-topics/:id/authenticity` | hand (Phase 2) |
| `get_coverage_tiers_symbol.json` | `GET /coverage-tiers/:symbol` | hand (Phase 2) |
| `put_settings.json` | `PUT /settings` | hand |
| `post_recompute_all.json` | `POST /recompute-all` | hand (Phase 2) |
| `post_scheduler_start.json` | `POST /scheduler/start` | hand |
| `post_scheduler_stop.json` | `POST /scheduler/stop` | hand |
| `post_scheduler_config.json` | `POST /scheduler/config` | hand |
| `post_scheduler_jobs_action.json` | `POST /scheduler/jobs/:name/{run,enable,disable}` | hand |
| `post_collectors_run.json` | `POST /collectors/:source_type/run` | hand |
| `post_scenarios_id_recompute.json` | `POST /scenarios/:id_or_slug/recompute` | hand (Phase 2) |
| `post_scenarios_id_state.json` | `POST /scenarios/:id_or_slug/state` | hand (Phase 3) |
| `post_scenarios_id_exposure.json` | `POST /scenarios/:id_or_slug/exposure` | hand (Phase 3) |
| `post_emerging_topics_id_recompute_authenticity.json` | `POST /emerging-topics/:id/recompute-authenticity` | hand (Phase 2) |
| `post_emerging_topics_id_promote.json` | `POST /emerging-topics/:id/promote` | hand (Phase 3) |
| `post_coverage_tiers_recompute.json` | `POST /coverage-tiers/recompute` | hand (Phase 2) |
| `post_tracked_concepts_id_status.json` | `POST /tracked-concepts/:id/status` | hand (Phase 2) |

## Hand-written fixture conventions

- Top-level `_meta` block describes the endpoint, method, and example URL.
- `request_body` is the example POST/PUT body (or `null` for body-less requests).
- `response_status` is the documented success status.
- `response_body` is the success-case payload.
- `_alt_error_*` blocks document representative error responses where the contract calls them out.

## Refreshing live fixtures

```powershell
$base = "http://localhost:3002/api/market-intelligence"
$dir  = "agent-relay/planning-docs/ongoing/market-intelligence-scenario-engine/api-fixtures/market-intelligence"
curl.exe -sS --max-time 10 "$base/healthcheck" | Out-File -Encoding utf8 "$dir/get_healthcheck.json"
# …then re-pretty-print with python:
py -c "import json,glob; [open(f,'w',encoding='utf-8').write(json.dumps(json.load(open(f,'r',encoding='utf-8-sig')),indent=2)+'\n') for f in glob.glob('$dir/get_*.json')]"
```

## Known drift between fixtures and live server (2026-04-27)

- Live fixtures have `schema_version: 2` in scenario rows because the running
  Node build is stale. Hand fixtures use `schema_version: 1` per the frozen contract.
  Both must converge to **v1** once the server is restarted to pick up the
  recent commits — see `market-intelligence-checklist.md` "Open infrastructure" section.
