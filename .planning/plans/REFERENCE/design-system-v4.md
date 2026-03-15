# Pattern Detector — Design System V4

**Direction:** Clinical  
**Principle:** Money hates noise.  
**Rule:** Color lives in the chart. Nowhere else.  
**Reference mockup:** `../Pattern_Detector_Mockup/`

---

## 1. Design Philosophy

This is a trading engine. Not an app. Not a dashboard. Not a SaaS product.

The UI must reduce:
- Impulse
- Overconfidence
- Emotional reaction
- Visual stimulation

If the interface feels exciting, that's a red flag.  
If you removed all color and hierarchy is still clear, the structure is correct.

### Core Principles

| Principle | Rule |
|-----------|------|
| Calm | Low stimulus, low contrast, no decoration |
| Controlled | Every element has one job. No ambiguity |
| Emotionless | YES and NO have identical visual weight |
| High signal | Chart dominates. Everything else is metadata |
| No decoration | No gradients, no glow, no shadows, no playful color |
| Clinical | Feels like a lab instrument, not an app |

---

## 2. Color System

### Surfaces — cold, desaturated

| Token | Value | Usage |
|-------|-------|-------|
| `--color-void` | `#08080a` | Deepest background (chart bg, inputs, level boxes) |
| `--color-bg` | `#0d0d0f` | Page background |
| `--color-sidebar` | `#0a0a0c` | Sidebar background |
| `--color-surface` | `#111113` | Panel/card background |
| `--color-surface-alt` | `#161618` | Hover states, alternate surfaces |
| `--color-surface-hover` | `#1b1b1e` | Active/pressed states |

### Text — low contrast, easy on eyes for hours

| Token | Value | Usage |
|-------|-------|-------|
| `--color-text` | `#b8b8b4` | Primary text, values, button labels |
| `--color-text-muted` | `#636366` | Secondary text, field labels, metadata |
| `--color-text-subtle` | `#3a3a3d` | Tertiary text, inactive nav, decorative labels |

**Rule:** No pure white (`#fff`) anywhere. Maximum text brightness is `#b8b8b4`.

### Borders — barely visible

| Token | Value | Usage |
|-------|-------|-------|
| `--color-border` | `#1c1c1f` | Panel borders, dividers, input borders |
| `--color-border-subtle` | `#141416` | Chart grid lines, ultra-subtle separators |

### Accent — steel blue

| Token | Value | Usage |
|-------|-------|-------|
| `--color-accent` | `#5d7a92` | Primary button fill, active nav indicator, logo mark |
| `--color-accent-hover` | `#4e6a80` | Primary button hover |
| `--color-accent-soft` | `rgba(93, 122, 146, 0.08)` | User chat bubble background |

**Rule:** Accent is cold, technical, not emotional. Not yellow. Not blue. Steel.

### Semantic — financial meaning ONLY

| Token | Value | Usage |
|-------|-------|-------|
| `--color-positive` | `#4faa72` | P&L positive numbers ONLY |
| `--color-negative` | `#b05454` | P&L negative numbers ONLY |

**Rule:** Green and red appear ONLY on P&L numbers and inside the chart. Never on buttons. Never on labels. Never on badges. Classification is not celebration.

### Wyckoff Phase Colors — muted tints

| Phase | Border | Title |
|-------|--------|-------|
| Peak | `#7a4040` | `#a05858` |
| Distribution | `#7a5a35` | `#a07848` |
| Base | `#3a7a50` | `#50a068` |
| Markup | `#3a5a7a` | `#5080a0` |
| Pullback | `#7a7a3a` | `#a0a050` |
| Breakout | `#5a3a7a` | `#7858a0` |

**Rule:** Phase colors are muted. They help differentiate, not attract attention.

### Disabled

| Token | Value |
|-------|-------|
| `--color-disabled-bg` | `#0e0e10` |
| `--color-disabled-text` | `#2a2a2d` |

---

## 3. Typography

### Font Stack

| Token | Value | Usage |
|-------|-------|-------|
| `--font-sans` | `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif` | Body text, headings, labels |
| `--font-mono` | `JetBrains Mono, 'Fira Code', 'SF Mono', monospace` | Values, symbols, buttons, badges, metrics |

### Scale

| Token | Size | Usage |
|-------|------|-------|
| `--text-h1` | `1.75rem` | Page titles |
| `--text-h2` | `1.25rem` | Panel headers, trade symbols, P&L values |
| `--text-h3` | `1rem` | Section emphasis, R:R values |
| `--text-body` | `0.8125rem` | Body text, trade info, candidate values |
| `--text-small` | `0.75rem` | Buttons, labels, nav items, chat, metadata |
| `--text-caption` | `0.625rem` | Uppercase labels, badges, phase data, field labels |

### Line Height

| Token | Value | Usage |
|-------|-------|-------|
| `--leading-tight` | `1.2` | Headings |
| `--leading-body` | `1.5` | Body text, chat bubbles |

### Rules

- Headings: `font-weight: 500`, `letter-spacing: -0.01em`
- Labels: `text-transform: uppercase`, `letter-spacing: 0.06–0.08em`, `font-weight: 600`
- Monospace for all numerical values, symbols, buttons, and badges
- No font size below `0.625rem`

---

## 4. Spacing

| Token | Value |
|-------|-------|
| `--space-4` | `4px` |
| `--space-8` | `8px` |
| `--space-12` | `12px` |
| `--space-16` | `16px` |
| `--space-24` | `24px` |
| `--space-32` | `32px` |
| `--space-48` | `48px` |
| `--space-64` | `64px` |
| `--space-96` | `96px` |

**Rule:** Use only these values. No arbitrary pixel values.

---

## 5. Layout

### App Shell

- Fixed sidebar: `200px` width, collapsible to `44px`
- Sidebar state persisted in `localStorage`
- Main content: `margin-left` matches sidebar width, transitions on collapse
- Minimum viewport height: `100vh`

### Grid Rules

- Use CSS Grid for side-by-side panels
- Always set `align-items: start` on grid containers with panels
- Reset `.panel + .panel` margin inside grid contexts (adjacent sibling selector leaks)
- Panel gaps: `var(--space-24)`

### Border Radius

| Token | Value |
|-------|-------|
| `--radius` | `2px` |

**Rule:** Not 0 (brutalist). Not 8 (friendly). `2px` everywhere. Clinical.

---

## 6. Components

### Buttons

Almost everything is outline. Fill is earned, not default.

| Variant | Background | Border | Text | Usage |
|---------|-----------|--------|------|-------|
| Default (`.btn`) | transparent | `--color-border` | `--color-text` | Most actions |
| Primary (`.btn-primary`) | `--color-accent` | `--color-accent` | `--color-void` | ONE primary action per page |
| Ghost (`.btn-ghost`) | transparent | transparent | `--color-text-subtle` | Tertiary actions (Save chart) |
| Disabled | `--color-disabled-bg` | `--color-border` | `--color-disabled-text` | Inactive |

**Button typography:** `font-family: mono`, `font-size: --text-small`, `font-weight: 600`, `text-transform: uppercase`, `letter-spacing: 0.06em`

**Rule:** Reduce button fill usage by 30-40% compared to typical SaaS. Outline is the default.

### Label Buttons (YES / NO / Adjust / Skip)

- Identical visual weight. No color differentiation.
- Outline only. `font-size: --text-small`, `min-height: 44px`
- 2x2 grid layout
- On hover: border brightens, background shifts to `surface-alt`

**Rule:** YES and NO must feel identical in emotional temperature. Classification, not celebration.

### Panels

- Background: `--color-surface`
- Border: `1px solid --color-border`
- Radius: `--radius` (2px)
- Panel header: `min-height: 36px`, border-bottom separator
- Panel body: `padding: --space-16`

### Metrics

- Background: `--color-void`
- Border: `1px solid --color-border`
- Label: `--text-caption`, uppercase, `--color-text-muted`
- Value: `font-mono`, `--text-body` or `--text-h3` (large)

### Badges

- `font-mono`, `--text-caption`, uppercase
- Background: `--color-surface-alt`
- Border: `1px solid --color-border`
- Color: `--color-text-muted`
- Informational only. Not decorative.

### Trade Cards

- Grid: `90px 1fr auto` (symbol | info | P&L)
- Symbol: `font-mono`, `--text-h2`, `font-weight: 700`
- Info labels (Entry, Stop, Target): `--text-body`, `--color-text`
- Values: `font-weight: 700`
- P&L: `--text-h2`, semantic color (ONLY place outside chart)
- Date line: `--text-small`, `--color-text-muted`

### Chat Bubbles

| Speaker | Background | Border | Alignment |
|---------|-----------|--------|-----------|
| AI | `--color-surface` | `2px left, --color-border` | Left |
| User | `--color-accent-soft` | `2px left, --color-accent` | Right |

**Rule:** Clear speaker identification through alignment + border color. No avatars, no names.

### Inputs & Selects

- Background: `--color-void`
- Border: `1px solid --color-border`
- Font: `--font-sans`, `--text-small`
- Focus: `border-color: --color-accent`
- No outline ring. Border color change only.

### Direction Toggle (Long/Short)

- Identical emotional temperature
- Active state: `--color-accent` fill
- Inactive: `--color-surface` background, `--color-text-subtle` text

---

## 7. Interaction

| Token | Value |
|-------|-------|
| `--transition` | `120ms ease` |

**Rule:** Fast, no drama. No bouncy easing. No delay. 120ms for everything.

### Focus

- `outline: 2px solid --color-accent`
- `outline-offset: 2px`
- Visible only on `:focus-visible` (keyboard navigation)

### Hover

- Buttons: border brightens to `--color-text-subtle`
- Trade cards: border brightens
- Nav items: background shifts to `--color-surface`
- No color changes. No scale transforms. No shadows.

---

## 8. Hierarchy Rules

### Chart Dominance

The chart is the only thing that matters. Price is truth. Everything else is metadata.

- Chart height: `480px` (Scanner), `380px` (Co-Pilot)
- Chart background: `--color-void` (darkest surface)
- Chart grid: repeating gradient lines at `0.3` opacity
- All other panels are support

### Information Priority

1. **Chart** — dominates visually
2. **Candidate / Key Levels** — primary data
3. **Classification buttons** — primary action
4. **AI panel** — support, not feature
5. **Sidebar** — configuration, does not compete

### Color Priority

1. **Chart** — only place with meaningful color
2. **P&L numbers** — green/red semantic color
3. **Phase indicators** — muted tints
4. **Accent** — one steel-blue for primary action + active state
5. **Everything else** — grayscale

---

## 9. Accessibility

- Semantic HTML: `<nav>`, `<aside>`, `<main>`, `<footer>`
- ARIA labels on navigation and interactive regions
- `aria-current="page"` on active nav items
- Keyboard navigable: all buttons and links focusable
- `prefers-reduced-motion`: disables all transitions and animations
- Minimum touch target: `36px` height (buttons), `44px` (label buttons)
- Focus indicators: `2px solid accent` with `2px offset`

---

## 10. Responsive

- Below `768px`: sidebar hidden, grid collapses to single column
- Chat panel hidden on mobile
- Metric grids collapse from 4-5 columns to 2
- Level grids collapse from 4 to 2
- Phase grids collapse to single column

---

## 11. Anti-Patterns (Do NOT)

| Don't | Why |
|-------|-----|
| Use yellow as accent | Feels like a notification. Too emotional. |
| Color YES/NO differently | Creates dopamine reinforcement. Dangerous for trading. |
| Use red for "No" classification | Red = loss/danger. "No" is just classification. |
| Use purple for AI | Makes AI feel like a feature, not a tool. |
| Use gradients anywhere | Decoration. Noise. |
| Use shadows or glow | SaaS aesthetic. Not institutional. |
| Use border-radius > 2px | Friendly. Not clinical. |
| Put semantic color on buttons | Color should encode financial meaning, not action type. |
| Make the AI panel visually dominant | Chart dominates. AI is support. |
| Use bright white text | Too much contrast for extended use. Max is `#b8b8b4`. |

---

## 12. Implementation Notes

### Files

| File | Purpose |
|------|---------|
| `styles.css` | Complete design system + all component styles |
| `app.js` | Sidebar collapse toggle with localStorage persistence |
| `index.html` | Scanner page |
| `copilot.html` | Co-Pilot page |
| `history.html` | Trading Desk page |

### CSS Architecture

- Single flat CSS file. No preprocessor. No CSS-in-JS.
- CSS custom properties (variables) for all tokens.
- Component classes are flat (`.btn`, `.panel`, `.trade-card`), not nested.
- Modifier classes (`.btn-primary`, `.btn-ghost`, `.panel--fixed`).
- No utility framework. No Tailwind. Hand-authored.

### Migration Path

When implementing V4 into the real Pattern Detector:

1. Replace the existing CSS with `styles.css` from the mockup
2. Update HTML templates to use the new class names
3. Remove all inline color styles (green/red buttons, purple AI panels)
4. Ensure chart component renders into `--color-void` background
5. Map existing JavaScript interactions to the new DOM structure
6. Test sidebar collapse with localStorage across all pages
7. Verify accessibility: keyboard navigation, focus indicators, reduced motion

---

*Document created from V4 mockup. Direction: Clinical. Last updated: 2026-02-11.*
