# Trading Co-Pilot App Reference

This document is the AI's knowledge base. When you ask the Co-Pilot a question about any feature, setting, concept, or button, it searches this document and uses the matching section to answer you.

---

## Account Settings

### Account Size
Total capital in your trading account. Used to calculate risk budgets, position sizes, and percentage-based limits. Example: $4,000 for a micro futures account or $50,000 for a stock trading account.

### Available Balance
Capital available after accounting for open positions. May be less than Account Size if you have margin tied up in existing trades. Used by the verdict engine to check if you can afford a new trade.

### Daily Loss Limit
Maximum percentage of your account you're willing to lose in a single day. If your realized losses today plus the potential loss on a new trade exceed this limit, the verdict engine will DENY the trade. Example: 5% means on a $4,000 account, you stop trading after $200 in daily losses. Exception: if you're at the minimum 1 contract for futures, the first trade of the day is allowed with a warning.

### Max Open Positions
Maximum number of simultaneous open positions allowed. Prevents over-exposure to the market. The verdict engine checks your current open trades from trade history and denies new ones if you're at the limit. Example: 5 positions.

---

## Instrument Types

The Co-Pilot supports five instrument types. When you enter a symbol, it auto-detects the type and fills in the relevant settings from the built-in contract specs database.

### Stock / ETF
Equities and exchange-traded funds. Position size is calculated in whole shares: `floor(riskBudget / riskPerShare)`. No fractional shares. No special margin rules — cash account assumed. The simplest instrument type. Example: AAPL, MSFT, SPY.

### Futures
Futures contracts trade on margin and have a point value (multiplier) that determines dollar risk per price movement. Position size = `min(contractsByRisk, contractsByMargin)` — you can't exceed either your risk budget or your available margin. Whole contracts only — you cannot buy 0.5 contracts.

If your risk budget (e.g., 2% of $4,000 = $80) cannot afford even 1 contract (e.g., risk per contract = $350), the system allows **minimum 1 contract** as long as your account covers the margin. A warning shows the actual risk percentage. This is because futures have a minimum unit size — the system won't block you just because the math rounds to zero.

#### Margin per Contract
The margin (collateral) required to hold one futures contract. This is NOT the total cost — it's collateral your broker holds while the position is open. Varies by broker and can change over time. The margin field is auto-filled from the contract specs database but you can manually override it with your broker's current requirement.

Examples of approximate margins:
- MES (Micro E-mini S&P 500): ~$2,676
- MNQ (Micro E-mini Nasdaq): ~$1,760
- MGC (Micro Gold): ~$1,000
- MCL (Micro Crude Oil): ~$600

#### Point Value (Multiplier)
Dollar value of a 1-point price move per contract. This is what makes futures leveraged — small price moves create large dollar P&L. The point value is FIXED by the exchange and never changes, unlike margin.

Example: MES has a $5 point value. If MES moves from 5000 to 5010 (10 points), your P&L per contract = 10 × $5 = $50.

Key point values:
- MES (Micro S&P): $5/point
- MNQ (Micro Nasdaq): $2/point
- MYM (Micro Dow): $0.50/point
- MGC (Micro Gold): $10/point
- MCL (Micro Crude Oil): $100/point
- MBT (Micro Bitcoin): $0.10/point
- ES (E-mini S&P): $50/point (10x MES)

#### Tick Size
Minimum price increment the futures contract can move. The smallest possible price change. Examples:
- MES/ES: 0.25 (prices move in quarters: 5000.00, 5000.25, 5000.50, 5000.75)
- MYM: 1.0 (whole points only)
- MGC: 0.10
- MCL: 0.01

#### Micro vs Full-Size Contracts
Micro contracts are 1/10th the size of their full-size counterparts. They're designed for smaller accounts. Robinhood and most brokers offer micro futures. If you're trading a $4,000 account, micro contracts (MES, MNQ, MYM, M2K, MGC, SIL, MCL, MBT, MET) are appropriate. Full-size contracts (ES, NQ, YM, GC, CL) require significantly more margin and carry 10x the risk per point.

### Options
Options contracts give the right (not obligation) to buy (call) or sell (put) the underlying at a strike price. Each standard contract controls 100 shares.

#### Option Price (Premium)
The cost per share of the option contract. Total cost = premium × contract multiplier. For long options (buying calls or puts), the premium is your maximum possible loss — you can never lose more than what you paid. Example: premium $2.50 × 100 shares = $250 per contract.

#### Option Type
**Call** (bullish — right to buy the underlying at the strike price) or **Put** (bearish — right to sell the underlying at the strike price). Determines directional exposure.

#### Contract Multiplier
Number of shares each option contract controls. Standard equity options = 100. Position cost = option price × multiplier × number of contracts. Mini options (rare) = 10.

### Forex
Foreign exchange currency pairs. Traded in lots with leverage. Symbols end with =X (e.g., EURUSD=X).

#### Lot Size
Unit of trade size in forex:
- **Standard lot** = 100,000 units of base currency (e.g., 100,000 EUR in EUR/USD)
- **Mini lot** = 10,000 units
- **Micro lot** = 1,000 units

Smaller lots allow finer position sizing with less capital. For a $4,000 account with leverage, micro lots are appropriate.

#### Pip Value
Dollar value of a 1-pip move per standard lot. A "pip" is the smallest standard price increment — typically 0.0001 for most pairs (0.01 for JPY pairs). EUR/USD standard lot = $10/pip. For mini lots, divide by 10 ($1/pip); for micro lots, divide by 100 ($0.10/pip).

#### Leverage
Ratio of position size to required margin. 50:1 means $1 of margin controls $50 of currency. Higher leverage = less margin required but the SAME dollar risk. US regulated brokers cap leverage at 50:1 for major pairs. Example: a standard EUR/USD lot at 50:1 leverage requires $2,000 margin instead of $100,000.

### Crypto
Cryptocurrency trading. Key differences from stocks: fractional units allowed, 24/7 trading, exchange fees on each trade. Symbols end with -USD (e.g., BTC-USD, ETH-USD).

#### Exchange Fee
Percentage fee charged by the exchange on each trade. Applied on both buy and sell (round-trip). This directly reduces your profit and adds to your loss. Examples: Coinbase ~0.6%, Binance ~0.1%, Robinhood ~0%. The verdict engine factors round-trip fees into the total cost calculation.

---

## Trading Concepts

### Energy Indicator
The Energy indicator measures the "physics" of price movement using velocity, acceleration, and range compression. Think of it like a ball being thrown — it starts fast, slows down, and eventually stops before changing direction.

**Energy States:**
- **Expanding**: Price is moving fast in one direction with increasing momentum. Like a ball accelerating after being thrown. Strong trend in progress.
- **Compressing**: Price movement is slowing down and range is tightening. Like a spring being compressed. Often precedes a big move.
- **Exhausted**: The move has run out of steam. Velocity is low, acceleration is flat or reversing. This is often where reversals begin — the selling (or buying) energy has been spent.
- **Recovering**: Price is starting to move again after exhaustion. Early signs of a new trend forming.

**Energy Components:**
- **Velocity**: How fast price is moving (percentage change per period, normalized by ATR). High velocity = strong directional move.
- **Acceleration**: Whether velocity is increasing or decreasing. Positive = speed increasing. Negative = speed decreasing.
- **Direction**: Which way the energy is flowing — UP, DOWN, or NEUTRAL.
- **Energy Score**: 0-100 composite score combining all components.

**How to use it**: For long entries in a pullback, you want to see EXHAUSTED or RECOVERING energy — it means selling pressure has dissipated and the downward move is done.

### Selling Pressure
A 0-100 score measuring how much active selling is occurring. Calculated from down-volume, bearish candles, and price decline velocity.

- **0-20**: Very low selling pressure. Sellers are exhausted. Favorable for long entries.
- **20-40**: Low selling. Market is calming down.
- **40-60**: Moderate. Mixed signals — wait for clarity.
- **60-80**: High selling pressure. Sellers are active. Not ideal for longs.
- **80-100**: Extreme selling. Panic or capitulation. Could signal a bottom forming (contrarian), but risky.

**Selling Pressure Trend**: Shows if selling is INCREASING, DECREASING, or STABLE. For long entries, you want to see DECREASING — sellers are running out of ammunition.

**Peak Selling Pressure**: The highest selling pressure reading in the current move. Comparing current to peak shows how much selling has subsided.

### Retracement
How far price has pulled back from the high toward the low, expressed as a percentage. Measured within the analyzed price range.

- **0-25%**: Price is near the top. Premium zone. Wait for a deeper pullback.
- **25-38.2%**: Shallow pullback. Common in strong trends but offers less value.
- **38.2-50%**: Moderate pullback. Approaching the discount zone.
- **50-61.8%**: The "discount zone" — the sweet spot for value entries. Price has retraced at least half the range.
- **61.8-78.6%**: Deep pullback. Great value if the structure holds.
- **78.6-100%**: Very deep. Could be a structural failure rather than a pullback.

### Discount Zone
The discount zone is defined as price being at a 50% or greater retracement from the swing high to the swing low. This is where you get the best risk/reward ratio for long entries — you're buying at "half off" or better. The Co-Pilot flags when price is or isn't in the discount zone and recommends waiting if it hasn't pulled back enough.

### Fibonacci Levels
Fibonacci retracement levels are horizontal lines on the chart marking key percentages derived from the Fibonacci sequence. These levels often act as support and resistance.

**Standard Fibonacci Levels:**
- **23.6%**: Very shallow — first minor support level
- **38.2%**: Common pullback level in strong trends
- **50%**: The midpoint — psychologically significant, marks the discount zone boundary
- **61.8%**: The "golden ratio" — strongest Fibonacci level, deep pullback
- **78.6%**: Very deep pullback — last major support before failure

The Co-Pilot shows the nearest Fibonacci level to the current price and its dollar value. Use these as entry targets, stop placement guides, or take-profit levels.

### Swing Points
Swing highs and swing lows are the local peaks and valleys in price action. They define the structure of a trend — higher highs + higher lows = uptrend, lower highs + lower lows = downtrend.

The app uses the **Ramer-Douglas-Peucker (RDP) algorithm** to detect swing points. Instead of looking at fixed windows (e.g., "highest in 5 bars"), RDP simplifies the price curve to its essential shape — it finds the points that matter most in defining the overall movement.

**Swing Sensitivity**: A slider (1-10) that controls how many swing points are detected. Lower = fewer, larger swings (macro structure). Higher = more, smaller swings (micro structure). Default is 5.

### Wyckoff Method
The Wyckoff Method is a framework for identifying institutional accumulation and distribution in stock charts. The app focuses on **Wyckoff Accumulation** — a pattern where large players quietly buy shares over time before a markup.

**Wyckoff Accumulation Phases:**
1. **Peak**: The prior high before the decline begins
2. **Markdown**: The significant decline from peak (ideally 70%+ decline)
3. **Base (Accumulation Zone)**: Sideways trading range where institutions accumulate — price bounces between support and resistance
4. **Markup**: Price breaks above the base resistance — the first sign institutions are done accumulating
5. **Pullback**: Price pulls back toward the base after the initial breakout (ideally 70-79% retracement of the markup move)
6. **Breakout**: Second breakout above the markup high — confirms the pattern

### Trend Analysis
The Co-Pilot analyzes trends at two timeframes:

- **Primary Trend**: The larger, dominant trend direction (UPTREND, DOWNTREND, SIDEWAYS). Determined from longer-period moving averages and swing structure.
- **Intermediate Trend**: The shorter-term trend within the primary. Can diverge temporarily.
- **Trend Alignment**: Whether primary and intermediate trends agree:
  - **ALIGNED**: Both trends point the same direction. Stronger signal.
  - **CONFLICTING**: Trends disagree. Trade with caution — the intermediate trend may be a counter-trend move.

### Go / No-Go Verdict
The Co-Pilot's bottom-line recommendation after analyzing a symbol:

- **GO**: Conditions are favorable for a long entry. Selling pressure is low/decreasing, energy is exhausted/recovering, and price is in or near the discount zone.
- **NO-GO**: Conditions are unfavorable. Active selling, strong downward energy, or price at a premium. Wait.
- **WAIT**: Conditions are mixed. Some signals are favorable but key criteria aren't met yet. Monitor for changes.

**Go Reasons**: Specific conditions that favor the trade (e.g., "Selling pressure < 30", "Energy exhausted", "Price in discount zone").
**No-Go Reasons**: Specific conditions working against the trade (e.g., "Selling pressure > 50", "Price at premium", "Trend conflicting").

---

## P&L Calculator

### How P&L Works
The Co-Pilot automatically calculates profit and loss based on your entry, current price (or crosshair position), and instrument type.

**Stock P&L**: `(exitPrice - entryPrice) × shares × direction`
- Direction: +1 for long, -1 for short

**Futures P&L**: `(exitPrice - entryPrice) × pointValue × contracts × direction`
- Example: MES, entry 5000, exit 5010, long = (5010 - 5000) × $5 × 1 × 1 = $50 profit

**Options P&L**: `(exitPremium - entryPremium) × multiplier × contracts`
- Example: bought call at $2.50, now worth $4.00 = ($4.00 - $2.50) × 100 × 1 = $150 profit

**Forex P&L**: `(exitPrice - entryPrice) × pipValue × lotScale × direction`
- lotScale: 1 for standard, 0.1 for mini, 0.01 for micro

**Crypto P&L**: `(exitPrice - entryPrice) × units × direction - fees`

### Live P&L Panel
The panel below the trade levels showing real-time P&L:

- **Unrealized P&L ($)**: Dollar profit or loss at the current price
- **Unrealized P&L (%)**: Percentage return on the position
- **Position Size**: Number of shares/contracts/lots/units
- **Current Price**: The price at your cursor or the latest bar close
- **Target P&L**: Profit if price reaches your take-profit level
- **Max Loss**: Loss if price hits your stop loss

The Live P&L updates in real-time as you move your crosshair across the chart.

### Trade Direction
The **Long/Short toggle** buttons above the trade levels:

- **Long** (default): You profit when price goes UP. Entry below target, stop below entry.
- **Short**: You profit when price goes DOWN. Entry above target, stop above entry.

Direction affects all P&L calculations and position sizing. For futures shorts, the formula becomes: `(entryPrice - exitPrice) × pointValue × contracts`.

---

## Position Sizing

### How Position Sizing Works
Position sizing determines how many shares/contracts/lots to trade based on your risk tolerance.

**The formula**: `riskBudget / riskPerUnit`

Where:
- **Risk budget** = Account Size × Risk Percent (e.g., $4,000 × 2% = $80)
- **Risk per unit** = |entry - stop| × point value (for futures) or |entry - stop| (for stocks)

### Minimum Contract Rule (Futures/Options)
Futures and options trade in whole units — you cannot buy half a contract. If the risk-based calculation gives 0 (meaning 1 contract's risk exceeds your % budget), the system allows **minimum 1 contract** as long as you can afford the margin. A warning shows the actual risk percentage so you can make an informed decision.

Example: $4,000 account, 2% risk ($80), MES with 70-point stop = $350 risk per contract. Risk-based sizing = 0 contracts. But margin ($2,676) is covered, so the system sizes to 1 contract with warning: "Risk 8.8% of account (exceeds 2% target)."

---

## Risk Rules

### Risk per Trade (%)
Percentage of account size risked on each trade. This is the core position sizing input — it determines your risk budget: `accountSize × riskPercent / 100`. Example: 2% on $4,000 = $80 risk budget per trade. For futures at minimum 1 contract, the actual risk may exceed this — the system warns but allows it.

### Min R:R Ratio
Minimum acceptable reward-to-risk ratio. R:R = (distance to target) / (distance to stop). If below this threshold, the verdict engine denies the trade. Example: 1.5 means you need at least $1.50 potential reward for every $1.00 of risk. A 2:1 R:R means you can be wrong half the time and still break even.

### Max Position Size (%)
Maximum percentage of account that a single position can represent. Prevents any one trade from being too large relative to your account. Example: 25% means a $4,000 account limits any single position to $1,000 in margin.

### Max Daily Trades
Maximum number of trades allowed per calendar day. Overtrading protection — prevents revenge trading or impulsive entries after losses. The verdict engine counts today's trades from trade history.

### Consecutive Loss Limit
Number of consecutive losing trades that triggers a circuit breaker. After this many losses in a row, the verdict engine denies ALL new trades until you have a winning trade. Prevents emotional spiraling. Example: 3 means stop trading after 3 straight losses.

### Max Drawdown (%)
Maximum percentage decline from your account's peak balance that triggers a circuit breaker. The peak balance is the highest your account has ever been (tracked from trade history). If you've drawn down more than this percentage from peak, all new trades are denied.

Example: 10% max drawdown. Account peaked at $5,000, now at $4,400. Drawdown = ($5,000 - $4,400) / $5,000 = 12% > 10% limit — trading is suspended.

If you have no closed trades, your peak balance equals your account size and drawdown is 0%.

### Require AI Approval
When checked, the system sends the trade setup to OpenAI GPT-4o for a qualitative verdict in addition to the local 4-layer rules engine. The AI considers pattern quality, market context, and setup nuances that mechanical rules can't capture.

---

## Verdict Engine

The Co-Pilot uses a 4-layer verdict engine to evaluate every trade. Each layer can independently DENY a trade. ALL four layers must pass for the trade to be APPROVED.

### Layer 1: Account Constraints
Hard stops based on whether you can afford the trade:
- **Buying power**: Do you have enough capital/margin?
- **Risk budget**: Does the max loss fit within your risk % (with minimum-contract exceptions for futures)?
- **Daily loss limit**: Have you already hit your daily loss cap?
- **Max open positions**: Are you already at capacity?

### Layer 2: Instrument Rules
Instrument-specific validation:
- Can the position be sized? (units > 0)
- Futures: is margin covered?
- Options: can you afford the premium?
- Forex: is leverage/margin within limits?
- Crypto: are fees accounted for?

### Layer 3: Risk Management
Portfolio-level protection:
- R:R ratio vs your minimum requirement
- Position size vs maximum allocation
- Daily trade count vs limit
- Consecutive losses vs circuit breaker
- Drawdown vs circuit breaker

### Layer 4: Setup Quality (Advisory Only)
Pattern and setup analysis from the Co-Pilot scanner. This layer is **ADVISORY ONLY** — it adds warnings but NEVER hard-denies a trade:
- Trend alignment (primary + intermediate)
- Energy state (is the move exhausted?)
- Selling pressure (are sellers still active?)
- Retracement quality (is price in the discount zone?)

---

## Co-Pilot Analysis

### Analyze Button
Enter a symbol in the input field and click "Analyze" (or press Enter). The Co-Pilot fetches price data, calculates swing structure, Fibonacci levels, energy state, selling pressure, trend direction, and retracement — then delivers a Go/No-Go verdict with detailed reasoning.

### Analysis Output Fields
After analysis, the Co-Pilot displays:

- **Verdict**: GO / NO-GO / WAIT — the bottom-line recommendation
- **Current Price**: Latest price of the instrument
- **Retracement**: How far price has pulled back (percentage)
- **Primary Trend**: The main trend direction
- **Intermediate Trend**: The shorter-term trend
- **Trend Alignment**: Whether both trends agree
- **Nearest Fib Level**: The closest Fibonacci level and its price
- **Energy State**: Current energy character (expanding/compressing/exhausted/recovering)
- **Selling Pressure**: Current reading (0-100) and its trend
- **Range**: The high and low defining the analysis range
- **Commentary**: Written explanation of the verdict with Go/No-Go reasons

---

## Chart Features

### Chart Screenshot (Camera Button)
The camera button (📷) next to the chat Send button captures a screenshot of the current chart and sends it to GPT-4o for visual analysis. The AI can see your candlesticks, price lines (entry/stop/target), patterns, and annotations. Use it to ask the AI "what do you see on this chart?" or "does this look like a good setup?"

Requirements: A chart must be visible (run an analysis first). OpenAI API key must be configured.

### Timeframes
The chart supports multiple timeframes selectable from the dropdown:
- **Monthly (1M)**: Each candle = 1 month. Big picture view.
- **Weekly (1W)**: Each candle = 1 week. Intermediate trends.
- **Daily (1D)**: Default. Each candle = 1 trading day.
- **4-Hour (4H)**: Intraday swing trading.
- **1-Hour (1H)**: Intraday.
- **30-Min, 15-Min, 5-Min, 1-Min**: Short-term/scalping.

Changing the timeframe re-fetches data and updates the chart. Your entry/stop/target lines persist across timeframe changes.

### Drawing Tools
Interactive drawing tools on the chart:
- **Entry line (blue)**: Your planned entry price. Click Set Entry, then click the chart.
- **Stop loss line (red)**: Your risk exit. Click Set Stop Loss, then click the chart.
- **Take profit line (green)**: Your reward target. Click Set Take Profit, then click the chart.
- All lines are **draggable** — click and drag to adjust levels.

### Swing Sensitivity Slider
Controls the RDP algorithm's sensitivity for swing point detection (1-10 scale):
- **1-3**: Very few swing points detected. Shows only the largest, most significant highs and lows.
- **4-6**: Moderate. Good balance between structure and noise. Default: 5.
- **7-10**: Many swing points. Shows minor highs and lows too. Useful for short-term analysis.

---

## Contract Specs Database

The Co-Pilot has a built-in database of contract specifications. When you type a known symbol, settings auto-populate.

### Micro Index Futures (Robinhood)
| Symbol | Name | Point Value | Tick Size |
|--------|------|-------------|-----------|
| MES=F | Micro E-mini S&P 500 | $5 | 0.25 |
| MNQ=F | Micro E-mini Nasdaq-100 | $2 | 0.25 |
| MYM=F | Micro E-mini Dow | $0.50 | 1.0 |
| M2K=F | Micro E-mini Russell 2000 | $5 | 0.10 |

### Micro Commodity Futures
| Symbol | Name | Point Value | Tick Size |
|--------|------|-------------|-----------|
| MGC=F | Micro Gold | $10 | 0.10 |
| SIL=F | Micro Silver | $1,000 | 0.005 |
| MCL=F | Micro Crude Oil | $100 | 0.01 |
| MNG=F | Micro Natural Gas | $1,000 | 0.001 |

### Micro Crypto Futures
| Symbol | Name | Point Value | Tick Size |
|--------|------|-------------|-----------|
| MBT=F | Micro Bitcoin | $0.10 | 5.0 |
| MET=F | Micro Ether | $0.10 | 0.50 |

### Full-Size Index Futures
| Symbol | Name | Point Value | Tick Size |
|--------|------|-------------|-----------|
| ES=F | E-mini S&P 500 | $50 | 0.25 |
| NQ=F | E-mini Nasdaq-100 | $20 | 0.25 |
| YM=F | E-mini Dow | $5 | 1.0 |
| RTY=F | E-mini Russell 2000 | $50 | 0.10 |

Note: Margin values are estimates and vary by broker. The margin field is editable — always enter your broker's current requirement before trading.

---

## Discount Zone Scanner

### What It Does
The Discount Zone Scanner is a batch scanning mode on the Pattern Detector page. It scans a universe of ~200+ small-cap stocks and filters for those currently in the "discount zone" (50%+ retracement from swing high).

### Scan Modes
- **Wyckoff Pattern**: Scans for full Wyckoff accumulation patterns
- **Discount + Wyckoff (Chained)**: First filters for discount zone candidates, then runs Wyckoff detection on only those candidates (faster, more targeted)
- **Discount Zone (Pullback Only)**: Only checks for the 50% retracement criterion — no Wyckoff pattern required

### How to Use
1. Select scan mode from the dropdown on the Pattern Detector page
2. Click "Run Scan"
3. Results appear in the table — click any row to view its chart
4. Label candidates (Yes/No/Close) to build training data for future ML models

---

## Trade History

### Saving a Trade
After setting entry/stop/target on the Co-Pilot chart, click "Save Trade." This stores the complete trade setup including symbol, levels, position sizing, verdict, instrument type, chart image, and timestamp.

### Trade Statuses
- **Planned**: Trade is set up but not yet entered
- **Open**: Trade has been executed (you clicked "Execute")
- **Closed**: Trade is complete (you recorded an exit via Closeout)

### Closeout
To close a trade, click the Closeout button on the trade card. Enter your actual exit price. The system calculates your real P&L based on the instrument type (stocks use shares × price diff, futures use contracts × points × multiplier, etc.).

### Statistics
The trade history page shows:
- **Win Rate**: Percentage of closed trades that were profitable
- **Average R-Multiple**: Average of actual P&L divided by planned risk
- **Total P&L**: Sum of all closed trade profits and losses
- **Average P&L**: Mean dollar P&L per trade
- **Largest Win / Largest Loss**: Best and worst individual trades
- **P&L by Instrument**: Breakdown by stock, futures, options, forex, crypto
- **Open Risk**: Total dollar amount at risk in currently open positions

---

## AI Chat

### How the Chat Works
The chat panel on the Co-Pilot page lets you have a conversation with the AI about your trades. It has full context of your current symbol, analysis results, trade levels, and settings.

### What You Can Ask
- **"Should I enter this trade?"** — AI evaluates based on analysis data
- **"What's the selling pressure?"** — Returns current reading and trend
- **"What does energy mean?"** — Explains the concept (from this document)
- **"What is margin?"** — Explains the setting
- **"How does position sizing work?"** — Explains the calculation
- **"What do you see on this chart?"** — Use with the 📷 button for visual analysis
- Any question about any button, field, or concept in the app

### Chat with Chart (Camera Button)
Click 📷 to include a chart screenshot. The AI (GPT-4o) will visually analyze the candlestick pattern, support/resistance levels, and any drawn lines. Works only when a chart is displayed and OpenAI is configured.

---

## Buttons and Controls Reference

### Co-Pilot Page
| Button/Control | What It Does |
|----------------|-------------|
| Symbol input | Enter any ticker (e.g., MES=F, AAPL). Auto-detects instrument type. |
| Analyze | Runs full Co-Pilot analysis: swing structure, Fibonacci, energy, selling pressure, Go/No-Go verdict |
| Set Entry | Click to enter entry-placement mode, then click the chart |
| Set Stop Loss | Click to enter stop-loss-placement mode, then click the chart |
| Set Take Profit | Click to enter target-placement mode, then click the chart |
| Long / Short | Toggle trade direction. Affects P&L calculation and position sizing |
| Clear | Remove all drawn price lines from the chart |
| Save Trade | Save current setup to trade history |
| Calculate (green) | Run the 4-layer verdict engine on current levels |
| Send (chat) | Send a text message to the AI |
| 📷 (camera) | Capture chart screenshot and send to AI for visual analysis |
| Timeframe dropdown | Change chart timeframe (1M to 1min) |
| Swing Sensitivity | Adjust swing point detection sensitivity (1-10) |

### Sidebar Settings
| Setting | What It Does |
|---------|-------------|
| Account Size | Your total trading capital |
| Available Balance | Capital not tied up in positions |
| Risk per Trade % | Percentage risked per trade (e.g., 2%) |
| Min R:R | Minimum reward-to-risk ratio required |
| Max Position % | Maximum single position as % of account |
| Daily Loss Limit % | Daily loss circuit breaker |
| Max Open Positions | Maximum simultaneous positions |
| Max Daily Trades | Overtrading circuit breaker |
| Consecutive Losses | Losing streak circuit breaker |
| Max Drawdown % | Peak-to-trough drawdown circuit breaker |
| Instrument Type | Stock/Futures/Options/Forex/Crypto |
| Margin per Contract | Futures: margin required (editable) |
| Point Value | Futures: dollar per point (auto-filled) |
| Tick Size | Futures: min price increment (auto-filled) |
| Option Price | Options: premium per share |
| Option Type | Options: Call or Put |
| Contract Multiplier | Options: shares per contract (usually 100) |
| Lot Size | Forex: Standard/Mini/Micro |
| Pip Value | Forex: dollar per pip |
| Leverage | Forex: margin leverage ratio |
| Exchange Fee % | Crypto: per-trade fee |
| AI Provider | OpenAI or Ollama |
| Model | GPT-4o, GPT-3.5-turbo, or MiniCPM-V |
| Temperature | AI creativity (0 = precise, 1 = creative) |
| Require AI Approval | Enable AI-powered verdict |

---

## Indicator Studio

### Indicator Studio: Builder
The Builder is where you author and test one indicator artifact at a time. The left pane is your code + definition workspace. The right pane is Plugin Engineer chat.

### Pattern Name
Human-readable label shown in the library and scanner option lists. This is for readability; it is not the stable execution key.

### Pattern ID
Stable machine identifier used by scanner/validator/composites and stored in the registry. This should be unique and snake_case.

### Artifact Type
What kind of artifact this is:
- `indicator`: signal/decision logic used by scanner/strategy
- `pattern`: semantic classifier (for example Wyckoff phase/pipeline style artifacts)

`artifact_type` answers: **what is it?**

### Composition
How the artifact is built:
- `primitive`: one atomic unit with one job
- `composite`: combines/orchestrates multiple primitives into one verdict

`composition` answers: **how is it built?**

Quick examples:
- `rsi_cross_30_primitive` → `artifact_type: indicator`, `composition: primitive`
- `fib_energy` → `artifact_type: indicator`, `composition: composite`

### Category
Classification label used for grouping/filtering in the Indicator Library. Examples: `indicator_signals`, `structure`, `timing_trigger`, `entry_composite`.

### Status
Lifecycle tag shown in UI (for example draft/experimental/testing/approved). Status communicates maturity, not profitability.

### Test
Runs the current plugin code against selected symbol/interval in the test harness and prints pass/fail output in Test Output.

### Save Draft
Saves your current builder state locally (UI draft state). It does not publish the plugin to the global registry/library.

### Start Blank
Clears the current builder editor state (code + form + JSON) so you can begin from an empty workspace without deleting saved local drafts.

### Register Plugin
Publishes the current artifact(s) into the plugin registry and file store so Scanner/Validator/Library can use them.

### Pattern Definition (JSON)
Editable JSON contract for the indicator. Includes IDs, metadata, tunable params, composition, runner wiring, and defaults.

### Test Output
Console-style result panel for the latest test execution (success/failure, error text, and any diagnostics).

### Indicator Studio: Plugin Engineer Chat
Role-specific AI assistant for generating/editing plugin code and definitions. It can propose primitives/composites and load artifacts into the builder.

### Browse Existing
Chat shortcut that asks Plugin Engineer to review what already exists before generating new code.

### New Plugin
Chat shortcut that starts a fresh generation flow in Builder context.

### Indicator Studio: Pattern Scanner
Subpage for running a selected indicator against a symbol and inspecting candidate/chart output without leaving Indicator Studio.

### Indicator Studio: Indicator Library
Subpage listing registered indicators. Supports search/filter/detail inspection and loading an artifact into Builder.

### Load to Builder
Loads the selected library artifact's definition and code into the Builder editor for inspection or editing.

---

## Blockly Composer

### Blockly Composer
The Blockly Composer is a visual block-based tool for building composite indicators by wiring existing primitives together. It uses Google Blockly to provide typed sockets and drag-and-drop composition. The Composer generates JSON definitions only — it does not generate Python code. Primitives must be created first in the Indicator Builder (Plugin Engineer), then composed here.

The workflow is: create primitives in the Builder, then compose them in the Blockly Composer, then send the result back to the Builder for testing and registration.

### Blockly Composer: Pattern Name
Human-readable display name for the composite indicator. Used in the Indicator Library and scanner option lists. Example: "Pullback Entry Composite".

### Blockly Composer: Pattern ID
Auto-generated machine identifier derived from the Pattern Name. Always ends in `_composite` to distinguish composites from primitives. Must be unique, lowercase, and snake_case. This is the stable execution key used by the scanner, validator, and registry.

### Blockly Composer: Category
Classification label for grouping and filtering in the Indicator Library. Common values: `indicator_signals`, `structure`, `custom`. Default is `indicator_signals`.

### Blockly Composer: Status
Lifecycle badge indicating the maturity of the composite. New composites start as `experimental`. This communicates readiness, not profitability.

### Blockly Composer: Intent
Dropdown that defines what kind of composite you are building:
- **Entry**: Answers "Should I enter a trade now?" Requires Structure + Location + Timing Trigger. This is the most common type.
- **Exit**: Answers "Should I exit this trade now?" Same required stages as Entry but wired for exit logic (stop invalidation, target hit, etc.).
- **Analysis**: General-purpose analysis composite. No required stages — connect whatever primitives make sense.
- **Regime**: Market regime or state filter composite. Used to gate other indicators (e.g., "only trade in uptrends").

### Blockly Composer: Compose Indicator Block
The central block in the workspace. It has four typed input sockets on the left side and a reducer configuration at the top. You drag primitive blocks from the toolbox and snap them into the appropriate sockets. The block enforces type safety — you cannot connect a Structure primitive to a Timing socket.

### Blockly Composer: Reducer
Controls how connected primitives combine to produce the final GO/NO_GO verdict:
- **AND**: All connected stages must pass. Use when every condition is required (most common for entry signals).
- **OR**: Any one connected stage passing is sufficient. Use for broad/lenient signals.
- **N-of-M**: At least N out of M connected stages must pass. A middle ground between AND and OR.

### Blockly Composer: N Value
Only relevant when the Reducer is set to N-of-M. Specifies the minimum number of stages that must pass. For example, if you have 3 stages connected and N=2, any 2 passing is enough to produce a GO verdict.

### Blockly Composer: Structure Socket
Accepts primitives with the `anchor_structure` indicator role. These identify structural anchors in price data — swing highs, swing lows, pivots, RDP significant points. Examples: `rdp_swing_structure`, `swing_structure`.

### Blockly Composer: Location Socket
Accepts primitives with the `location` or `location_filter` indicator role. These identify price zones or levels — discount zones, Fibonacci retracement levels, premium/value areas. Examples: `fib_location_primitive`, `discount_zone`.

### Blockly Composer: Timing Trigger Socket
Accepts primitives with the `timing_trigger` or `trigger` indicator role. These detect specific events or crosses — RSI crossing a level, moving average crossovers, breakouts. Examples: `rsi_cross_30_primitive`, `fib_signal_trigger_primitive`, `ma_crossover`, `golden_cross_50_200_sma`.

### Blockly Composer: Regime Filter Socket
Optional socket that accepts primitives with `state_filter`, `regime_state`, or `pattern_gate` roles. Classifiers that label market behavior and act as permission gates. If connected, the composite only fires when the regime filter also passes. Examples: `regime_filter`, `energy_state_primitive`.

### Blockly Composer: Toolbox
The left-side panel in the Blockly workspace containing all available primitives, organized by category:
- **Composer**: Contains the Compose Indicator block itself
- **Structure**: All anchor/structure primitives (blue)
- **Location**: All location/zone primitives (green)
- **Timing Trigger**: All timing/event primitives (orange)
- **Regime Filter**: All state filter/regime/classifier primitives (purple)

Each primitive appears in exactly one category based on its `indicator_role`. The colored dots match the socket types, so you can visually identify which primitives fit which sockets.

### Blockly Composer: Validate Button
Checks whether the current composition is complete and valid. For Entry and Exit intents, all three required stages (Structure, Location, Timing) must be connected. Shows an alert with specific errors if validation fails.

### Blockly Composer: Copy JSON Button
Copies the generated composite JSON definition to your clipboard. Useful for manual inspection or pasting into other tools.

### Blockly Composer: Send to Builder Button
Exports the validated composite definition to the Indicator Builder page. The Builder will receive the JSON definition so you can test it against market data and register it. This is the primary way to finalize a Blockly composition.

### Blockly Composer: Composite Definition JSON
Collapsible dropdown below the workspace that shows a live preview of the JSON definition being generated from your block composition. Updates automatically as you connect/disconnect blocks. This is the same format as the Pattern Definition JSON in the Builder.

### Blockly Composer: Blockly Assistant
AI chat panel on the right side of the Composer page. Ask questions about how to use the Blockly workspace, what primitives are available, what each socket type means, or get suggestions for indicator compositions. The assistant knows about all registered primitives and can guide you through building effective composites.

---

## Strategy Details Page

### Strategy Details Page
Dedicated page for creating/editing strategy specs and launching validation for the selected strategy version.

### Edit Strategy
Switches from read-only details to editable fields for metadata, configs, and run settings.

### Asset Class
Declares market type (stocks/futures/options/forex/crypto). Used to resolve correct tier universes and validation assumptions.

### Validation Tier
Selects test depth for runs:
- Tier 1: fast kill test
- Tier 2: core validation
- Tier 3: robustness/stress

### Start Date / End Date
Date window for the validation run. Controls historical period used by the backtest run request.

### Run Validation
Starts validation directly from Strategy Details using current run settings (asset class, tier, date range).

### Save Changes
Persists edits to the current strategy version.

### Strategy Copilot Buttons
- **Summarize**: concise spec summary
- **Risk Gaps**: top missing/fragile risk controls
- **Test Plan**: ordered validation recommendations

---

## Backtesting & Validation — What It Is and How It Works

### What Is a Backtest?
A backtest simulates how a trading strategy would have performed on historical price data. You define the rules — entry signal, stop loss, profit target, position sizing — and the engine applies those rules to every bar of historical data across every symbol in your test universe, recording every trade that would have been triggered. At the end you get an aggregate report: total trades, win rate, expectancy, drawdown, profit factor, etc.

**What a backtest is not**: It is not a prediction of future performance. It tells you whether your rules had an edge in the past, on the data you tested. Whether that edge persists going forward depends on whether the market conditions that generated it still exist.

### What Makes a Backtest Statistically Valid?
Three things determine whether a backtest result means anything:

**1. Trade count (sample size)**
This is the most important factor. A small sample can produce extreme results purely by chance — like flipping a coin 10 times and getting 8 heads. The more trades, the more reliable the statistics:
- Under 100 trades: essentially meaningless — pure luck territory
- 100–200 trades: weak signal, treat with extreme skepticism
- 200–300 trades: minimum for a provisional result
- 300–500 trades: meaningful for initial validation
- 500–1,000 trades: statistically solid
- 1,000+ trades: strong confidence, Monte Carlo simulation becomes reliable

**2. Out-of-sample testing**
If you develop a strategy by looking at historical data, then test it on the *same* historical data, you will always find parameters that "worked" — this is called overfitting or curve-fitting. The only honest test is to run the strategy on data it has never seen before. We split the data: the "in-sample" period is used for development, the "out-of-sample" (OOS) period is held back and used only for testing. If performance degrades significantly on OOS data, the strategy is overfit.

**3. Robustness across conditions**
A real edge should work across different market regimes (trending vs. ranging), different time windows, and small parameter variations. If performance only appears in one specific year, or collapses when you change your stop from 1.5% to 1.6%, the edge is fragile — it's an artifact of the data, not a real pattern.

### Why Do We Have Three Tiers?
The three-tier system solves a resource problem: running a full robustness test on every idea is expensive and slow. Most ideas can be eliminated quickly and cheaply. We use progressive gates so you only spend compute on ideas that survive each stage.

**Tier 1 — Kill Test**
*Purpose: Kill bad ideas fast.*
Runs only the core backtest on a moderate universe. No out-of-sample split, no walk-forward, no Monte Carlo. The single question: does this strategy have a positive expectancy with enough trades to matter?
- Minimum trades to avoid automatic FAIL: 200
- Minimum trades for a clean PASS: 300
- Verdict: PASS / NEEDS_REVIEW / FAIL
- If FAIL at Tier 1, you're done — go back and redesign.
- Time: minutes to ~1 hour depending on universe size.

**Tier 2 — Core Validation**
*Purpose: Test whether the edge is real or overfit.*
Requires a Tier 1 PASS. Expands the universe and adds: out-of-sample split, walk-forward testing across rolling windows, Monte Carlo drawdown simulation, and parameter sensitivity checks. The question here: does this strategy hold up on data it hasn't seen, across multiple time windows?
- Minimum trades for FAIL threshold: 300
- Minimum trades for clean PASS: 500
- OOS degradation allowed: under 50% (less is better)
- Walk-forward: at least 60% of time windows must be profitable
- Monte Carlo p95 drawdown: must stay under ceiling (default 30%)
- Time: can take hours for large universes.

**Tier 3 — Robustness**
*Purpose: Stress test for survivors.*
Requires a Tier 2 PASS. Uses the largest, most diverse universe including sector ETFs and cross-asset stress. Tests regime consistency — does the strategy work in bear markets, not just bull markets? Only a Tier 3 PASS qualifies a strategy for production scanning.
- Minimum trades for FAIL threshold: 400
- Minimum trades for clean PASS: 800
- Time: can take many hours.

### The Trade Count Rule in Practice
The validator enforces minimum trade counts automatically. If your strategy fires too rarely on the test universe, you will get an explicit FAIL with a message like: "Too few trades for Tier 1 confidence: 147 < 200."

This is by design. A strategy that fires once a year per stock is not practically useful — even if every trade it triggered was a winner. You need enough occurrences to build a real equity curve and expose drawdown behavior. The trade count gate is the first thing to check when a test fails.

**How to get more trades if you're short:**
- Expand the symbol universe (more stocks)
- Extend the date range (more history)
- Loosen the entry filter slightly (more signals)
- Consider whether the pattern is too selective to be tradeable at scale

### Key Metrics Explained

**Expectancy (R)**: The average profit per trade, measured in R (units of risk). If you risk $100 per trade and expectancy is 0.5R, you expect to make $50 per trade on average. Above 0.3R is decent; above 0.5R is strong. Negative expectancy means the strategy loses money on average — automatic FAIL.

**Profit Factor**: Gross profits divided by gross losses. A profit factor of 2.0 means for every $1 lost, the strategy made $2. Above 1.5 is healthy; below 1.2 is fragile; below 1.0 means the strategy is a net loser.

**Win Rate**: Percentage of trades that were profitable. This number alone is meaningless without knowing the average win vs. average loss size. A 35% win rate with a 3R average winner beats a 65% win rate with a 0.5R average winner.

**Max Drawdown (%)**: The largest peak-to-trough decline in the simulated equity curve. A 25% drawdown means at some point the account was 25% below its previous high. Above 30% is concerning for most traders. This is the historical worst case — Monte Carlo gives you a more realistic estimate.

**Max Drawdown (R)**: Same drawdown expressed in R-multiples. A 10R drawdown means you could have lost the equivalent of 10 times your per-trade risk in a losing streak.

**Monte Carlo Drawdown (p95 / p99)**: The validator runs 1,000+ simulations by randomly shuffling the order of your trades. The p95 number means 95% of those simulations had a drawdown below that level — only 5% were worse. The p99 is the near-worst-case scenario. These are more realistic than the historical max drawdown because the historical sequence of trades is just one of many possible orderings.

**Longest Losing Streak**: The longest consecutive run of losing trades in the backtest. Important for psychology — can you stick to the strategy through this? And financially — does your account survive it?

**OOS Expectancy**: Expectancy on the out-of-sample data (the data the strategy was never shown during development). Should be close to in-sample expectancy. Large degradation = overfitting.

**OOS Degradation %**: How much expectancy dropped from in-sample to out-of-sample. Under 30% is acceptable. Over 50% is a red flag — the strategy may be curve-fit.

**Walk-Forward Consistency**: The validator splits the date range into multiple rolling windows and runs the strategy on each. The percentage of profitable windows tells you if the edge is consistent over time. 60%+ profitable windows is the minimum bar; 80%+ is strong.

**Parameter Sensitivity**: Tests what happens if you nudge your parameters slightly (e.g., RSI threshold from 30 to 32, stop from 1.5% to 1.7%). A robust strategy should not collapse from small changes. If it does, the parameters are over-optimized to historical noise.

**Sharpe Ratio**: Risk-adjusted return measure. Above 1.0 is acceptable; above 2.0 is strong. Less commonly the primary metric for discretionary-style strategies, but useful for comparison.

### What Is R-Multiple?
R is your unit of risk per trade. If your stop loss is $1.00 below entry on a stock and you buy 100 shares, your risk (1R) is $100. If the trade hits your 2:1 target, you made $200 = 2R. If it stops out, you lost $100 = -1R. Measuring all trades in R normalizes results regardless of position size, account size, or instrument, making statistics comparable across different tests and strategies.

### What Does NEEDS_REVIEW Mean?
NEEDS_REVIEW is a provisional verdict between PASS and FAIL. It means the strategy showed a positive expectancy and passed the basic quality checks, but the trade count fell in the gray zone (enough to avoid a hard FAIL, but not enough for a confident PASS). The system flags it for human review rather than automatically advancing it. You can choose to expand the universe and re-run, or accept it at your own discretion.

---

## Validator Reports Page

### Validator Reports Page
Landing/report workspace for selecting strategy versions and reviewing validation outcomes.

### Strategy List
Left panel grouped by strategy status/version. Selecting one loads reports and strategy context.

### Report Panel
Center panel with pass/fail verdict, metric blocks, reasons, and run details for the selected report.

### Validation Tier
Run-level selector for Tier 1/Tier 2/Tier 3 test scope and gate sequencing.

### Tier 1 - Kill Test
Fast falsification stage on a small fixed universe. Goal: reject weak ideas quickly with minimal compute.

### Tier 2 - Core Validation
Deeper stage with broader fixed universe and higher trade-count targets. Requires Tier 1 pass.

### Tier 3 - Robustness
Stress/robustness stage for survivors (regime consistency, fragility checks, worst-case behavior). Requires Tier 2 pass.

### Validator Symbol Library Page
Reference page showing what symbols belong to each asset class/tier universe so users can audit what is being tested.

### Run Status and Progress
Shows queued/running/completed state and progress details for active validation jobs.

### Cancel Run
Stops an in-progress validation job.

---

## Scanner Pages

### Training Data Page
Reference/management view for scanner training assets (symbols, candidates, labels, corrections).

### Saved Symbols Page
Saved watchlists/symbol sets used for repeat scanning.

### Scanner Settings Page
Scanner configuration area for runtime behavior and defaults.

### Forward / Back Buttons
Navigate through candidate set chart-by-chart without re-running the scan.

### Cancel Scan
Stops an active scanner universe run.
