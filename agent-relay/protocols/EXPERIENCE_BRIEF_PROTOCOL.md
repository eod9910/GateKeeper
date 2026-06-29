# Experience Brief Protocol

## Purpose

Experience creates the app's look-and-feel direction before Validator finalizes
the technical skeleton and before Builder creates the first user-facing surface.

Validator owns minimum product intent, the final project skeleton decision,
package, product scope, top-level folders, and implementation boundaries.
Experience owns the product surface direction: visual feel, interaction model,
workflow ergonomics, and first-screen expectations.

Builder implements both the Validator-approved skeleton and the
Experience-authored brief. The brief should normally exist before Validator
asks final architecture/package questions, so technical choices are made around
the approved product surface rather than the other way around.

Before the brief is frozen, Experience should make the look and feel concrete
for the user with examples. Examples prevent vague style words from becoming
accidental product direction.

Experience may use `agent-relay/roles/Experience/resources/` as its local-first
design resource set. Those files are reusable references and templates; the
project-specific options and final brief still belong in the active planning
package.

## When Required

An Experience brief is required when:

- there is no app yet and Builder will scaffold a user-facing app
- a new major UI surface is being introduced
- the user asks for look, feel, style, polish, UX, or app aesthetics
- Validator cannot confidently describe the desired product surface

## Required File

Store concept examples and the final brief inside the active planning package:

```text
agent-relay/planning-docs/ongoing/<work-package-slug>/<work-package-slug>.experience-options.md
agent-relay/planning-docs/ongoing/<work-package-slug>/<work-package-slug>.experience-brief.md
```

Optional templates live at:

```text
agent-relay/roles/Experience/resources/templates/experience-options.template.md
agent-relay/roles/Experience/resources/templates/experience-brief.template.md
```

For app inception:

```text
agent-relay/planning-docs/ongoing/app-inception/app-inception.experience-options.md
agent-relay/planning-docs/ongoing/app-inception/app-inception.experience-brief.md
```

## Concept Examples

Experience should generate two or three concrete look-and-feel options before
freezing the brief.

Use the lightest example format that makes the choice visible:

- written concept boards for very small or text-only apps
- ASCII or markdown wireframes for layout direction
- static HTML/CSS mockups for app screens or landing pages
- screenshots from local mockups when a browser is available
- generated visual references when the user needs to choose visual mood,
  composition, imagery, or brand direction

Each option must include:

- name
- intended feeling
- first-screen layout
- visual hierarchy
- color/typography direction
- primary workflow
- what this option is good for
- tradeoffs

Validator or the user chooses one option, or asks Experience to combine/revise
options. The final brief records the chosen option.

## Required Sections

```text
# Experience Brief: <app or surface name>

## Product Surface

What app surface, workflow, page, or component this brief governs.

## Selected Concept

Which concept option the user or Validator selected, including the path to the
options file and any requested blend/revision.

## Intended User Feeling

How the app should feel to the target user.

## Visual Direction

Density, tone, layout character, typography expectations, color constraints,
and whether the surface should feel operational, friendly, editorial,
expressive, technical, calm, playful, etc.

## First Screen

What the first viewport should communicate and what the user should be able to
do immediately.

## Core Workflows

The primary interactions that must feel clear and ergonomic.

## Components And Controls

Expected controls, navigation, empty states, loading states, error states, and
feedback patterns.

## Accessibility And Responsiveness

Contrast, keyboard/focus expectations, mobile/desktop behavior, and text
overflow rules.

## Non-Goals

Visual styles, interaction patterns, or features that should not be introduced.

## Experience Acceptance Criteria

Concrete checks Experience will use in the follow-up review.
```

## Handoff Rules

- Validator routes the app/surface concept to Experience when the brief is
  needed, after minimum product intent is known and before final package
  selection for a new app.
- Experience creates concept examples and routes them to Validator.
- Validator gets user selection or chooses the option when the directive already
  gives enough authority.
- Experience writes the final brief and routes it back to Validator.
- Validator uses the brief while asking remaining architecture questions,
  choosing the package, and writing the Builder directive.
- Validator references the brief in the Builder directive.
- Builder implements the surface according to the brief and reports any
  conflicts.
- Experience reviews the implemented surface against the brief.

## Stop Conditions

Experience stops and returns to Validator when:

- the target user is unclear
- the app purpose is unclear
- the desired tone or workflow is contradictory
- the requested look and feel would require product requirements Validator has
  not approved
