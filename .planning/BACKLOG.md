# Feature Backlog

> Ideas and planned features. Each item gets its own plan in `.planning/plans/` when it moves to NEXT UP.

---

## Chat Transcript Storage & Search

**Priority:** High
**Depends on:** AI App Knowledge (grep utilities)

Save every Co-Pilot chat exchange with metadata (symbol, timestamp, instrument type, verdict, trade levels). Enable searching by symbol so loading an IBM chart pulls up all IBM conversations.

- New endpoint: `/api/chat-history` (or field on trade records)
- Storage: `backend/data/chat-history/{symbol}_{timestamp}.json`
- Search: grep by symbol, date range, keywords
- UI: conversation history panel alongside chart, linked to saved charts and trades

---

## Semantic Search for AI Knowledge

**Priority:** Medium
**Depends on:** Chat Transcript Storage

Add meaning-based search so the AI can find relevant content even without exact keyword matches. E.g., "how should I handle a losing streak?" finds content about consecutive loss limits and circuit breakers.

- Embed help docs + chat transcripts using OpenAI `text-embedding-3-small`
- Store embeddings in JSON file (no vector DB needed at this scale)
- Cosine similarity search at query time
- Fallback: still use grep if embedding search returns low confidence

---

## AI Function Calling / REPL Pattern

**Priority:** Medium
**Depends on:** Semantic Search

Give the Co-Pilot AI actual tools it can call mid-conversation: query trade history, calculate position sizes, look up help docs. Uses OpenAI function calling.

- Define tools: `lookup_help(topic)`, `query_trades(filter)`, `calculate_size(params)`
- Two-round-trip pattern: AI decides to call tool → backend executes → AI responds with result
- More flexible than grep-inject but higher latency and cost

---

## Trading Hours Awareness

**Priority:** Low

Add market hours checks to the verdict engine. Futures and forex have specific trading sessions. Warn if setting up a trade outside primary hours.

- Futures: RTH vs ETH session awareness
- Forex: Sydney → Tokyo → London → New York session rotation
- Crypto: 24/7 (no restriction)
- Stocks: 9:30-16:00 ET, pre/post-market flags

---

## Greeks-Aware Options Sizing

**Priority:** Low
**Depends on:** Options position sizing (implemented)

Enhance options sizing with delta exposure calculation. Instead of just premium-based sizing, factor in delta to understand directional exposure equivalent.

- Add delta input to options settings
- Directional exposure = contracts × delta × 100 × stock price
- Useful for comparing options positions to equivalent stock positions

---

## Sector/Correlation Exposure Tracking

**Priority:** Low
**Depends on:** Chat Transcript Storage (needs trade history)

Track sector exposure across open positions. Warn if too concentrated in one sector (e.g., 3 tech longs).

- Map symbols to sectors (manual tags or API lookup)
- Layer 3 risk check: `sectorExposure + thisPosition > maxSectorExposure`
- Dashboard showing exposure by sector

---

## Self-Hosted Deployment (B-Link Mini PC)

**Priority:** Future

Deploy the full stack to the planned B-Link mini PC for local, always-on access.

- Docker containerization
- Reverse proxy with HTTPS
- Automated backups of `backend/data/`
- Ollama for local AI (no OpenAI dependency)

---

## Adaptive Swing Point Detection

**Priority:** Medium
**Depends on:** RDP Swing Detection (implemented)

Currently the swing sensitivity slider (epsilon_pct) is a manual setting (1-15). An adaptive version would automatically calibrate epsilon based on the instrument's volatility (ATR), timeframe, and price scale — so a volatile crypto asset like ATOM and a stable blue-chip like IBM both get appropriate swing detection without the user adjusting the slider.

- Calculate ATR-based epsilon: `epsilon_pct = base_epsilon × (ATR / price) × timeframe_factor`
- Timeframe scaling: daily charts need different sensitivity than 5-minute charts
- Asset class defaults: crypto (wider), stocks (medium), forex (tighter)
- Keep manual override: user slider takes precedence if explicitly set
- Could also auto-adjust the Wyckoff markdown threshold (currently fixed 70%) based on asset volatility
- **Partially addressed**: `detect_swings_rdp` now has adaptive epsilon that halves and retries if < 4 significant points found (floor: 0.2%). Full ATR-based calibration still TODO.

---

## Live Market Price Feed for Open Position P&L

**Priority:** Medium
**Depends on:** Auto P&L Calculator (implemented)

Currently live P&L only shows on the Co-Pilot chart via crosshair. Add real-time price polling for open positions so the Trade History page shows live unrealized P&L without needing to have the chart open.

- Poll Yahoo Finance or similar API every 30-60 seconds for open position symbols
- Update open trade cards in history.js with live unrealized P&L
- Optional: browser notifications when P&L hits stop loss or take profit level

---

## Multi-Timeframe Analysis

**Priority:** Medium

Allow viewing the same instrument across multiple timeframes simultaneously. Weekly trend + Daily entry + 4H timing.

- Split-pane or tabbed chart view with 2-3 timeframes
- Synchronized symbol across panes
- Trend alignment indicator comparing higher vs lower timeframe trends
- Useful for confirming trend direction before entry

---

## Git Init & CI/CD

**Priority:** High

The project has no version control. Initialize git, create `.gitignore`, and make first commit.

- `.gitignore`: node_modules, data/, .env, __pycache__, *.pyc
- Rotate OpenAI API key before committing (current key may be in code)
- Consider GitHub Actions for basic linting/type checking
