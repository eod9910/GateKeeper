# Pattern Detector Development Cost Estimate

Analysis Date: 2026-06-02
Source Command: `agent-relay/planning-docs/Cost.md`
Status: REFERENCE

## Executive Summary

Pattern Detector is not a small scanner app anymore. It is a full research/trading decision platform with:

- Python quantitative research and market-data pipelines
- TypeScript backend APIs and services
- static frontend application pages with substantial JavaScript
- AI/Copilot/Ledger workflows
- Market Intelligence scenario infrastructure
- validator/backtesting/parameter sweep tooling
- point-in-time fundamentals and valuation research
- planning, methodology, and operational documentation

Estimated professional rebuild value:

| Scenario | Engineering Hours | Engineering Cost | Growth-Company Full Team Cost |
|---|---:|---:|---:|
| Conservative/high productivity | 12,403 hrs | $1.49M-$2.23M | $3.28M-$4.91M |
| Midpoint | 15,910 hrs | $1.91M-$2.86M | $4.20M-$6.30M |
| High complexity/low productivity | 21,023 hrs | $2.52M-$3.78M | $5.55M-$8.32M |

Recommended headline estimate:

**Engineering-only replacement value: ~$2.0M-$3.2M**

**Full product-team replacement value: ~$4.5M-$7.0M**

This is a replacement-cost estimate, not a sale price or valuation. It answers: "What would it likely cost a professional team to recreate this codebase and product state?"

## Codebase Metrics

Measured with `git ls-files` on the tracked repo. The worktree is currently dirty, so this is a tracked-code baseline and may undercount recent uncommitted work.

| Metric | Count |
|---|---:|
| Tracked files | 1,059 |
| Dirty/untracked status entries | 208 |
| Git commits | 32 |
| First commit | 2026-03-15 |
| Latest commit | 2026-05-29 |

Tracked lines by extension:

| Type | Files | Lines |
|---|---:|---:|
| Python | 276 | 95,969 |
| TypeScript | 115 | 60,171 |
| JavaScript | 64 | 60,125 |
| Markdown | 324 | 46,750 |
| JSON | 178 | 31,029 |
| HTML | 24 | 17,627 |
| CSS | 5 | 4,250 |
| Other text/scripts | 17 | 995 |

Implementation code by bucket:

| Bucket | Lines |
|---|---:|
| Backend Python | 89,291 |
| Backend TypeScript | 59,371 |
| Frontend JS/HTML/CSS | 81,964 |
| Tests | 5,647 |
| ML/tools/other scripts | 3,118 |
| Product/planning/docs | 46,750 |

## Complexity Factors

Key complexity drivers:

- multi-language backend: Python services plus TypeScript/Node routes
- market data ingestion, normalization, caching, and freshness semantics
- point-in-time financial/fundamental facts
- valuation/DCF research and signal studies
- strategy validation, parameter sweeps, and backtesting
- Ledger/Copilot/AI tool calls and structured financial analysis
- Market Intelligence scenario detection and calibration/replay concepts
- frontend tool surfaces for Scanner, Trading Desk, Validator, Market Intelligence, Parameter Sweep, Fundamental Backtester, Training, and Settings
- broker/execution concepts and real-money decision-support implications
- large planning/memory system that captures product evolution and methodology

There is no Swift, C++, Metal, AVFoundation, or CoreMediaIO in this repo. The `Cost.md` template was written for a different native macOS-style stack, so this estimate adapts the method to Pattern Detector's actual web/Python/TypeScript/AI/trading stack.

## Testing And Documentation

Testing exists but is not proportional to the codebase size:

- tracked test code: ~5,647 lines
- test scripts cover backend services, candidate filters, chart data, contracts, signal scanner, training forward resolver, PIT fundamentals, structure discovery, and validator fixtures
- total implementation code is ~238K lines, so tracked test code is roughly 2.4% of implementation LOC

Documentation/planning is unusually strong:

- Markdown: ~46.8K tracked lines
- planning folders now separate `ACTIVE`, `TODO`, `REFERENCE`, `COMPLETED`, `ARCHIVE`, and `BACKLOG`
- active/completed workstreams use PRD/checklist pairs

The docs are valuable, but the testing gap means a professional rebuild would need significant QA, regression, and integration time.

## Development Hours Estimate

Productivity assumptions:

| Work Type | High Productivity | Midpoint | Low Productivity |
|---|---:|---:|---:|
| Backend Python quant/data logic | 30 LOC/hr | 22 LOC/hr | 16 LOC/hr |
| TypeScript backend/services | 35 LOC/hr | 28 LOC/hr | 22 LOC/hr |
| Frontend JS/HTML/CSS app UI | 45 LOC/hr | 38 LOC/hr | 30 LOC/hr |
| ML/tools/scripts | 35 LOC/hr | 28 LOC/hr | 20 LOC/hr |
| Tests | 40 LOC/hr | 32 LOC/hr | 25 LOC/hr |

Base coding hours:

| Scenario | Base Coding Hours |
|---|---:|
| Conservative/high productivity | 6,704 |
| Midpoint | 8,600 |
| High complexity/low productivity | 11,364 |

Overhead assumptions applied to base coding time:

| Overhead | Percent |
|---|---:|
| Architecture and design | 15% |
| Debugging and troubleshooting | 25% |
| Code review and refactoring | 10% |
| Documentation | 10% |
| Integration and testing | 20% |
| Specialized learning curve | 10% |
| Total overhead | 85% |

Total engineering hours:

| Scenario | Base Coding | Overhead | Total Engineering Hours |
|---|---:|---:|---:|
| Conservative/high productivity | 6,704 | 5,699 | 12,403 |
| Midpoint | 8,600 | 7,310 | 15,910 |
| High complexity/low productivity | 11,364 | 9,659 | 21,023 |

## Calendar Time

These are one-engineer calendar estimates. A team can parallelize, but not perfectly because this codebase has high product/context coupling.

| Scenario | Solo/Lean 65% | Growth 55% | Enterprise 45% | Bureaucracy 35% |
|---|---:|---:|---:|---:|
| 12,403 hrs | 477 wks / 9.2 yrs | 564 wks / 10.8 yrs | 689 wks / 13.3 yrs | 886 wks / 17.0 yrs |
| 15,910 hrs | 612 wks / 11.8 yrs | 723 wks / 13.9 yrs | 884 wks / 17.0 yrs | 1,136 wks / 21.9 yrs |
| 21,023 hrs | 809 wks / 15.6 yrs | 956 wks / 18.4 yrs | 1,168 wks / 22.5 yrs | 1,502 wks / 28.9 yrs |

Practical team interpretation:

- 4 senior engineers at growth-company efficiency: roughly 3-5 years
- 8 senior engineers at growth-company efficiency: roughly 1.7-2.5 years
- Smaller/faster is possible only if the original product owner remains tightly involved, because much of the value is domain judgment rather than generic implementation.

## Market Rate Research

Sources checked on 2026-06-02:

- FreelanceCalculator United States software developer rates: entry $35/hr, mid $75/hr, senior $120/hr, expert $175/hr. Source: https://www.freelancecalculator.net/location/usa/developer
- Index.dev 2025 freelance developer rates: United States software rates around $95-$110/hr, AI/ML/cloud/cybersecurity around $100-$150/hr. Source: https://www.index.dev/blog/freelance-developer-rates-by-country
- Arc software developer freelance rates: software development freelancers average around $81-$100/hr, with variation by duration/location. Source: https://arc.dev/freelance-developer-rates/software
- ASI 2025 commercial labor schedule: senior software developer $200/hr, senior engineer $225/hr, senior UX analyst $195/hr, project manager senior $200/hr. Source: https://www.antechsystems.com/wp-content/uploads/2025/04/ASI-Commercial-Labor-Rates-Schedule-2025.pdf
- Second Talent 2026 AI developer guide: US AI developer/ML rates commonly around $100-$125/hr and higher for specialized work. Source: https://www.secondtalent.com/resources/freelance-ai-developer-hourly-rate/

Recommended engineering rates for this project:

| Rate Band | Hourly Rate | Rationale |
|---|---:|---|
| Low | $120/hr | Senior US full-stack contractor baseline |
| Average | $150/hr | Senior full-stack plus data/AI/trading complexity |
| High | $180/hr | Specialist/agency-grade quant-data/AI platform work |

## Engineering Cost

| Scenario | $120/hr | $150/hr | $180/hr |
|---|---:|---:|---:|
| 12,403 hrs | $1.49M | $1.86M | $2.23M |
| 15,910 hrs | $1.91M | $2.39M | $2.86M |
| 21,023 hrs | $2.52M | $3.15M | $3.78M |

Recommended engineering-only range:

**$2.0M-$3.2M**

## Full Team Cost

Using the team multipliers from `Cost.md`:

| Company Stage | Multiplier | Midpoint Engineering Cost | Full Team Cost |
|---|---:|---:|---:|
| Solo/founder | 1.0x | $2.39M | $2.39M |
| Lean startup | 1.45x | $2.39M | $3.46M |
| Growth company | 2.2x | $2.39M | $5.25M |
| Enterprise | 2.65x | $2.39M | $6.32M |

Growth-company role breakdown at midpoint:

| Role | Ratio | Hours | Rate | Cost |
|---|---:|---:|---:|---:|
| Engineering | 1.00x | 15,910 | $150/hr | $2.39M |
| Product management | 0.30x | 4,773 | $160/hr | $0.76M |
| UX/UI design | 0.25x | 3,978 | $140/hr | $0.56M |
| Engineering management | 0.15x | 2,387 | $190/hr | $0.45M |
| QA/testing | 0.20x | 3,182 | $100/hr | $0.32M |
| Program/project management | 0.10x | 1,591 | $125/hr | $0.20M |
| Technical writing | 0.05x | 796 | $100/hr | $0.08M |
| DevOps/platform | 0.15x | 2,387 | $160/hr | $0.38M |
| Approx total |  | 35,006 |  | $4.74M |

The multiplier method gives $5.25M. The explicit role breakdown gives ~$4.74M because role-rate choices are somewhat conservative. Treat the practical growth-company midpoint as:

**~$4.7M-$5.3M**

## Grand Total Summary

| Basis | Low | Mid | High |
|---|---:|---:|---:|
| Engineering only | $1.49M | $2.39M | $3.78M |
| Lean startup full team | $2.16M | $3.46M | $5.49M |
| Growth company full team | $3.28M | $5.25M | $8.32M |
| Enterprise full team | $3.94M | $6.32M | $10.03M |

Most defensible stakeholder number:

**Pattern Detector represents roughly $2M-$3M of senior engineering work, or $5M-ish of growth-company product-team work.**

## AI-Assisted Development Comparison

Using the midpoint estimate:

| Metric | Human Professional Rebuild | Cursor-Assisted Estimate |
|---|---:|---:|
| Engineering hours | 15,910 hrs | 665 hrs |
| Speed multiplier | 1.0x | 23.9x |
| Time savings | baseline | ~95.8% |
| Engineering replacement value | $2.39M | $2.39M produced |
| Effective value per active build hour | $150/hr | ~$3,588/hr |

The "effective value per hour" is not a billing recommendation. It is the implied replacement value created per active Cursor-assisted build hour.

## Cursor ROI Analysis

Git-history method:

- first commit: 2026-03-15
- latest commit: 2026-05-29
- total commits: 32
- commit clusters within 4-hour windows: 7
- estimated active Cursor hours from commit clustering: 12 hours

This is not reliable as the main method because the current worktree has 208 dirty/untracked status entries and many sessions appear to have happened without commits.

LOC fallback method:

- production implementation code: ~232,817 lines
- Cursor productivity assumption: 200-500 meaningful LOC/hour
- estimated Cursor active hours:
  - aggressive: 466 hrs
  - midpoint: 665 hrs
  - conservative: 1,164 hrs

Value per Cursor hour, using midpoint engineering value of $2.39M and growth-company full-team value of $5.25M:

| Cursor Hours | Engineering $/Cursor Hr | Growth-Team $/Cursor Hr | Speed vs Human Engineering |
|---:|---:|---:|---:|
| 466 | $5,126/hr | $11,277/hr | 34.2x |
| 665 | $3,588/hr | $7,893/hr | 23.9x |
| 1,164 | $2,050/hr | $4,510/hr | 13.7x |

Headline:

**If the LOC-based midpoint is roughly right, Cursor-assisted work produced about $3,600 of senior engineering replacement value per active Cursor hour, or about $7,900 per active Cursor hour on a full growth-team-equivalent basis.**

### Cost Comparison And ROI Multiple

Estimated Cursor direct cost is hard to reconstruct from repo history. A reasonable planning range for a project of this size is:

- Cursor subscription / local tooling: roughly $20-$200 per month
- API/model usage: unknown, estimated broadly at $200-$2,000 for the build period
- Total direct AI/tooling cost range: **~$300-$2,500**

Using the midpoint engineering replacement value:

| Basis | Amount |
|---|---:|
| Human engineering replacement cost | $2.39M |
| Estimated Cursor/tooling direct cost | $300-$2,500 |
| Net savings versus hiring | ~$2.384M-$2.386M |
| ROI multiple on direct AI/tooling spend | ~954x-7,955x |

Using growth-company full-team replacement value:

| Basis | Amount |
|---|---:|
| Full team replacement cost | $5.25M |
| Estimated Cursor/tooling direct cost | $300-$2,500 |
| Net savings versus team rebuild | ~$5.248M-$5.250M |
| ROI multiple on direct AI/tooling spend | ~2,100x-17,501x |

The headline number:

**Cursor-assisted development appears to have compressed a multi-million-dollar professional rebuild into hundreds of active build hours, with direct tooling ROI plausibly in the high hundreds to low thousands even under conservative assumptions.**

## Assumptions And Caveats

1. This is a replacement-cost estimate, not a business valuation.
2. The measured LOC uses tracked files. Dirty/untracked work likely increases the current value.
3. Some tracked code may be experimental, duplicated, or obsolete; the range accounts for this by using broad confidence intervals.
4. Documentation and planning are counted as product value but not priced line-by-line like production code.
5. Test coverage is materially lower than a professional organization would want, so QA/integration costs are meaningful.
6. The original developer/product-owner's domain learning is embedded in the app. A hired team would need extra discovery time to recreate that judgment.
7. Infrastructure, hosting, data vendor fees, legal/compliance, broker approvals, marketing, sales, and ongoing maintenance are not included.

## Bottom Line

Pattern Detector would not be cheap to recreate professionally. The codebase has the shape of a multi-year, multi-role product effort compressed through AI-assisted development and intense domain iteration.

Reasonable replacement-cost estimate:

- **Engineering only:** ~$2M-$3.2M
- **Full product team:** ~$4.5M-$7M
- **Cursor-assisted value creation:** likely thousands of dollars of replacement value per active Cursor hour
