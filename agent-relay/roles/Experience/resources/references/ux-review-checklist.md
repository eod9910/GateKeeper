# UX Review Checklist

Use this checklist when Experience reviews an implemented surface.

## Fit

- The surface matches the approved experience brief.
- The first screen makes the app's purpose and next action clear.
- The UI matches the domain: operational tools feel efficient; public surfaces
  make the subject visible.

## Workflow

- The primary workflow can be completed without unnecessary navigation.
- Inputs, commands, confirmations, and results are visually connected.
- Empty, loading, error, disabled, and success states are present where needed.

## Layout

- Visual hierarchy is readable at desktop and mobile sizes.
- Text and controls do not overlap, truncate badly, or resize the layout.
- Repeated UI uses stable dimensions and predictable spacing.
- Cards are used for actual items, modals, or framed tools, not nested page
  decoration.

## Controls

- Controls use familiar shapes: icons for tool actions, toggles for binary
  settings, sliders or inputs for numeric values, tabs for views, menus for
  option sets.
- Icon-only controls have accessible labels or tooltips.
- Primary and destructive actions are distinguishable.

## Accessibility

- Contrast is readable.
- Keyboard focus can reach key actions.
- Focus states are visible.
- Labels describe the action or field.
- Motion is helpful and not required to understand state.

## Review Output

Experience reports:

- `PASS` when the surface matches the brief.
- `NEEDS REPAIR` when concrete UX fixes are needed.
- `EXPERIENCE BLOCKER` when the surface is visibly broken, inaccessible,
  incoherent, or unfit for the approved workflow.
