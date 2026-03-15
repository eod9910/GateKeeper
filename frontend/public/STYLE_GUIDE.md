# Pattern Detector Style Guide (v1)

This guide is based on the current Indicator Studio visual language and is now the baseline for all pages.

## 1) Visual Principles

1. Neutral dark surfaces for structure.
2. One blue interaction family for hover/focus.
3. Color emphasis on interaction states, not static fills.
4. Semantic colors (green/red/yellow) only for true trading meaning.

## 2) Core Tokens

Defined in `styles.css` `:root`:

1. `--color-accent`, `--color-accent-hover`, `--color-accent-soft`
2. `--ui-hover-border`, `--ui-hover-bg`, `--ui-hover-text`, `--ui-hover-shadow`
3. `--ui-active-border`, `--ui-active-bg`

## 3) Button System

All `.btn`, `.btn-primary`, and `.btn-ghost` follow the same interaction behavior:

1. Rest: neutral surface, muted text, border visible.
2. Hover: light blue border glow, subtle blue fill, lifted text color.
3. Active: slight press (`translateY(1px)`).
4. Transition: smooth 140-220ms.

Notes:

1. `.btn-primary` indicates priority via stronger resting border, not heavy fill.
2. `.btn-success` is reserved for semantic trade outcomes/actions.

## 4) Chat Panels

Use shared chat styling pattern:

1. Panel background: `var(--color-surface)`
2. User bubble: `var(--color-accent-soft)` + accent-border
3. Input row/action row: `var(--color-surface)`
4. Send button follows global hover system

## 5) Tab Controls

Tabs should not use different base colors between pages.

1. Inactive: neutral surface.
2. Active: dark accent border + subtle inset accent line.
3. Hover: same button hover language as `.btn`.

## 6) Exceptions

Allowed semantic colors:

1. P&L positive/negative values.
2. Pass/fail verdict badges.
3. Risk/warning/error states.

Not allowed:

1. Random blue hex values per page.
2. Per-page button color systems that diverge from shared tokens.

## 7) Implementation Rule

When adding UI:

1. Prefer shared classes/tokens in `styles.css`.
2. Avoid inline color styling on buttons.
3. If a one-off control is needed, derive from existing token values.
