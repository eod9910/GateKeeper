# App Inception Protocol

## Purpose

This protocol governs what happens when an instantiated relay is present but no
application exists yet.

Bootstrap installs the relay, protocols, roles, tools, and reusable package
templates. Bootstrap does not decide what app to build and does not scaffold the
app by default. The instantiated repo's Validator owns app inception.

## Ownership

- Bootstrap owns reusable package definitions and relay templates.
- Validator owns detecting whether an app exists, deciding whether app
  inception is needed, gathering minimum product intent, choosing the package
  after Experience direction is frozen, and defining the project skeleton.
- Experience owns the look-and-feel direction before Validator finalizes the
  technical skeleton for a user-facing app.
- Builder scaffolds only after Validator chooses a package and creates or
  authorizes planning docs and, when UI exists, after Experience creates the
  experience brief.
- Editor reviews structure and implementation fit.
- Experience reviews the first usable app surface.

## App-Exists Check

At the start of a new repo or when the user asks to build an app, Validator must
check whether an actual app already exists.

Evidence may include:

- source folders such as `src/`, `app/`, `apps/`, `backend/`, `frontend/`,
  `server/`, or `web/`
- package or build files such as `package.json`, `pyproject.toml`, `setup.py`,
  `vite.config.*`, `next.config.*`, or equivalent
- runnable commands documented in `README.md`
- existing UI, API, routes, tests, or deployment files

If there is no app, Validator must not let Builder improvise a skeleton.
Validator must run app inception first.

## User Conversation

When no app exists, Validator asks only the minimum product-intent questions
needed to route the user to Experience.

Validator should learn:

- who the app is for
- the primary job the app must do
- whether it is a prototype, internal tool, dashboard, long-lived product, or
  production system
- expected screens or workflows

Validator should avoid premature architecture questions before the product
surface is shaped, unless the user volunteers a hard constraint. Experience is
routed next and guides the user through concrete look-and-feel options.

Experience must create an experience brief before Validator finalizes the
technical skeleton for a new user-facing app. Experience first generates
concrete look-and-feel examples for user/Validator selection, then writes the
final brief. The brief follows
`agent-relay/protocols/EXPERIENCE_BRIEF_PROTOCOL.md` and may use
`agent-relay/roles/Experience/resources/` for reusable surface patterns, visual
directions, and templates.

## Architecture Conversation

After Experience routes the final brief back to Validator, Validator asks any
remaining architecture questions needed to choose the package and skeleton.

Validator should learn:

- whether a backend is needed
- whether auth, persistence, background work, uploads, or integrations are
  needed
- what data the first workflow creates, reads, updates, or deletes
- whether the app must be local-only, server-backed, or deployment-ready
- whether the user expects the app to grow into multiple domains
- whether the selected look and feel implies special UI needs such as canvas,
  charts, rich editing, media, maps, or complex state

The Experience brief informs the architecture conversation. Validator should not
choose a heavier package just because the app should look polished, but should
choose a package that can support the approved first-screen and workflow
direction without immediate rework.

## Package Selection

Validator chooses the smallest package that fits the user's intent.

Default packages are owned by bootstrap:

```text
bootstrap/packages/small-node-static-web/
bootstrap/packages/medium-large-modular-web/
```

Use `small-node-static-web` for:

- small apps
- prototypes
- internal tools
- simple dashboards
- one-command apps where speed and readability matter more than frontend
  architecture

Use `medium-large-modular-web` when:

- several product domains are known
- frontend state, routing, charting, or settings will be substantial
- backend needs durable module boundaries
- multiple agents may work on separate areas
- the project is expected to become a long-lived product

Start small unless medium/large signals are explicit.

## Required Planning Docs

Before Builder scaffolds an app, Validator creates or authorizes an app
inception work package. For app inception, the planning package may be opened
after minimum intent is known, but it is not complete until the Experience
brief and package decision are recorded:

```text
agent-relay/planning-docs/ongoing/app-inception/app-inception.prd.md
agent-relay/planning-docs/ongoing/app-inception/app-inception.checklist.md
```

The PRD must record:

- app purpose
- intended user
- selected package
- product domains or initial screens
- app feel and UX expectations
- path to the Experience-authored look-and-feel brief when UI exists
- selected look-and-feel option or approved blend/revision
- approved root files and top-level folders
- verification command

The checklist must include:

- scaffold according to the selected package
- implement the Experience brief when UI exists
- record package choice in `AGENTS.md` and `README.md`
- keep root files within `REPO_ORGANIZATION_PROTOCOL.md`
- create one-command startup
- provide a first usable screen or workflow
- run verification
- route Builder report to Validator
- route Editor review
- route Experience review against the brief when UI exists

## Handoff Flow

1. Validator checks if an app exists.
2. If no app exists, Validator asks minimum product-intent questions.
3. Validator opens or authorizes the app inception planning package.
4. Validator routes the user/app concept to Experience before final package
   selection.
5. Experience creates two or three concrete look-and-feel examples and routes
   them to Validator, using `agent-relay/roles/Experience/resources/` as
   reusable local design guidance when helpful.
6. Validator gets user selection or chooses the option when already authorized.
7. Experience creates the final look-and-feel brief and routes it to Validator.
8. Validator asks remaining architecture questions, using the brief as context.
9. Validator chooses `small-node-static-web` or `medium-large-modular-web`.
10. Validator completes the app inception PRD/checklist with the brief,
   architecture decisions, package, approved root/top-level folders, and
   verification command.
11. Validator routes a scaffold directive to Builder referencing the package and
   Experience brief.
12. Builder scaffolds according to the selected package and Experience brief.
13. Editor reviews code structure and organization.
14. Experience reviews the first usable app surface against the brief.
15. Validator accepts, requests repair, or asks the user for a new decision.

## Stop Conditions

Stop and return to the user when:

- the user has not described the app purpose
- Experience has not frozen the look-and-feel brief for a user-facing app
- the package choice is ambiguous
- the requested app requires a stack outside the available package definitions
- the first app skeleton would require unapproved root files or top-level folders
- the desired experience needs brand/product direction the user has not provided
