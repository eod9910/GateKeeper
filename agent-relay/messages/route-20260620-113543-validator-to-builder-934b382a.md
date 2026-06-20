# Builder Directive: Sync Agent Memory Bootstrap Role Doctrine

## Objective

Update the `agent-memory-bootstrap/` documentation so a new repo bootstrapped
from this package receives the current Pattern Detector tri-agent doctrine, not
only the older mirror/router setup.

## Scope

Edit only:

- `agent-memory-bootstrap/IMPLEMENTATION_GUIDE.md`
- `agent-memory-bootstrap/ROUTER_WORKFLOW.md`

## Required Updates

1. Add a portable tri-agent doctrine snapshot covering:
   - Validator planning standard: self-contained PRDs/checklists/directives,
     repo evidence, exact scope, verification gates, STOP conditions, drift
     checks, and independently verifiable done criteria.
   - Builder elegance standard: smallest correct native implementation,
     local patterns, no unapproved parallel systems, and explicit reporting
     when scope expands.
   - Builder Elegance Result metric: when removing duplicate/unnecessary code,
     report before/after shape, LOC or duplicate paths removed, percent
     reduction when clear, behavior preserved, verification evidence, and
     safety boundaries not weakened.
   - Editor Ponytail-style anti-overengineering pass: `delete`, `stdlib`,
     `native`, `existing-dependency`, `yagni`, and `shrink` labels with the
     safety guardrails from the live Editor role.
2. Preserve the existing PRD/checklist convention. Do not introduce or imply
   external `plans/001-*` planning layout.
3. Fix `ROUTER_WORKFLOW.md` section 5.5 so it no longer tells users to route
   `Validator -> User`; the current router allowlist does not support that
   route.
4. Add checklist coverage so future bootstrap installs verify role files and
   router route docs are in sync.

## Verification

- Run `python tools\agent_router.py verify`.
- Report changed files and any residual bootstrap risk.
