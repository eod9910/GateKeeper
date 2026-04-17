# WORKSPACE META SKILL
# Workspace + Skill + Tool Architecture
# Non-Negotiable Workspace Construction Mode

---

## WHEN TO USE

Use this skill when:

- creating a new workspace
- updating an existing workspace
- adding a new workspace skill
- deciding whether something should be a workspace, a skill, or a runtime tool
- wiring a workspace into the app
- making `TOOLS.md` match runtime reality

---

## SOURCE OF TRUTH

Start here:

- `workspace/WORKSPACE_ARCHITECTURE.md`

That file is the canonical repo guide for:

- workspace anatomy
- runtime loading order
- workspace vs skill vs tool decisions
- standard build process

Do not re-derive workspace architecture from scratch if that file already answers the question.

---

## CORE DECISION RULE

Use this test first:

- analyst role / reasoning contract changed -> create or update a workspace
- reusable procedure inside a role -> create or update a skill
- executable fetch/compute capability -> create or update a runtime tool
- runtime identity / workspace binding -> update `backend/src/services/visionService.ts`

---

## WORKFLOW

1. Read `workspace/WORKSPACE_ARCHITECTURE.md`.
2. Decide whether the request needs:
   - a workspace
   - a workspace skill
   - a runtime tool
   - or some combination
3. If creating a workspace, start from:
   - `workspace/_templates/Standard Workspace/`
4. Fill the core files first:
   - `IDENTITY.md`
   - `SOUL.md`
   - `AGENTS.md`
   - `TOOLS.md`
5. If the workspace needs a reusable procedure, add `skills/<skill-id>/SKILL.md`.
6. If the workspace claims a tool, make sure the tool actually exists in runtime code.
7. If the workspace should be active in the app, wire it through:
   - `backend/src/services/visionService.ts`
8. If executable tools are needed, implement or update runtime tooling in:
   - `backend/src/services/copilotTools.ts`
   - and any supporting backend service files
9. Make sure `TOOLS.md` matches runtime truth.
10. Test one realistic end-to-end prompt or page flow.

---

## RUNTIME TRUTH

`TOOLS.md` is not executable.

It is workspace documentation and prompt material only.

Actual runtime behavior is controlled by code, especially:

- `backend/src/services/visionService.ts`
- `backend/src/services/copilotTools.ts`

If a tool is mentioned in `TOOLS.md` but not implemented in runtime code, it is aspirational, not live.

---

## STANDARD CHECKS

Before finishing:

- confirm the workspace role boundary is explicit
- confirm the skill list is intentional
- confirm claimed tools are real
- confirm `visionService.ts` wiring exists if the workspace should run in-app
- confirm the template or workspace files do not duplicate large reference material unnecessarily

---

## ANTI-PATTERNS

- Do not create a new workspace when a skill is enough.
- Do not create a skill when a runtime tool is actually needed.
- Do not treat `TOOLS.md` as if it makes a tool real.
- Do not assume adding a skill folder auto-enables it at runtime.
- Do not let workspace behavior live only in terminal memory.
- Do not grep the repo from scratch every time if `workspace/WORKSPACE_ARCHITECTURE.md` already answers it.

---

## FAST PATH

For most new workspace work:

1. copy `workspace/_templates/Standard Workspace/`
2. rename the folder
3. define role and posture
4. add only the needed skills
5. wire runtime in `visionService.ts`
6. align `TOOLS.md` with actual tool code

---

## PRACTICAL RULE OF THUMB

If the question is:

- "How should this analyst think?" -> workspace file
- "How should this reusable procedure work?" -> skill
- "How does the app actually fetch or compute it?" -> runtime tool or backend service
- "How does the app know to use this workspace?" -> `visionService.ts`

---

END OF SKILL
