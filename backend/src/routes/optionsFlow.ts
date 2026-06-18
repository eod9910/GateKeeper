import { Router, Request, Response } from 'express';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import {
  getOptionsFlowForSymbol,
  getLatestOptionsFlow,
  getOptionsChainStats,
  getOptionsFlowAlerts,
  getOptionsOptionabilityStats,
  getTopAnomalies,
} from '../services/optionsFlowDb';
import { getSymbolClassification } from '../services/symbolCatalog';
import { loadLedgerWorkspaceSkill } from '../services/ledgerWorkspaceSkills';

const router = Router();
const COLLECT_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'collect_options_flow.py');

let _process: ChildProcess | null = null;
let _runtime: { running: boolean; last_message?: string; last_error?: string; last_finished_at?: string } = { running: false };

router.post('/run-collect', (req: Request, res: Response) => {
  try {
    if (_process && _runtime.running) {
      return res.json({ success: true, data: { started: false, message: 'Collection already running' } });
    }

    const symbols = req.body?.symbols || '';
    const top = Number(req.body?.top || 0);
    const args = ['--universe-source', 'optionable-clean', '--sleep-ms', '400'];
    if (symbols) {
      args.push('--symbols', String(symbols));
    } else if (top > 0) {
      args.push('--top', String(top));
    }

    _process = spawn('py', [COLLECT_SCRIPT, ...args]);
    _runtime = { running: true };

    let stdout = '';
    _process.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
      const lines = stdout.split('\n').filter(Boolean);
      if (lines.length > 0) {
        _runtime.last_message = lines[lines.length - 1].slice(0, 200);
      }
    });

    _process.stderr?.on('data', (d: Buffer) => {
      _runtime.last_error = d.toString().slice(0, 500);
    });

    _process.on('close', () => {
      _runtime.running = false;
      _runtime.last_finished_at = new Date().toISOString();
      _process = null;
    });

    res.json({ success: true, data: { started: true, message: 'Options flow collection started' } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/status', (_req: Request, res: Response) => {
  res.json({ success: true, data: _runtime });
});

router.get('/optionability', (_req: Request, res: Response) => {
  try {
    const data = {
      optionability: getOptionsOptionabilityStats(),
      chains: getOptionsChainStats(),
    };
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/symbol/:symbol', (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol || '').trim().toUpperCase();
    if (!symbol) return res.status(400).json({ success: false, error: 'symbol required' });

    const days = Math.min(Number(req.query.days) || 30, 90);
    const data = getOptionsFlowForSymbol(symbol, days);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/latest/:symbol', (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol || '').trim().toUpperCase();
    if (!symbol) return res.status(400).json({ success: false, error: 'symbol required' });

    const data = getLatestOptionsFlow(symbol);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/alerts', (req: Request, res: Response) => {
  try {
    const days = Math.min(Number(req.query.days) || 7, 30);
    const data = getOptionsFlowAlerts(days);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/anomalies', (req: Request, res: Response) => {
  try {
    const date = String(req.query.date || '').trim() || undefined;
    const directionRaw = String(req.query.direction || 'both').trim().toLowerCase();
    const direction = directionRaw === 'put' || directionRaw === 'call' ? directionRaw : 'both';
    const tierRaw = String(req.query.tier || 'heavy').trim().toLowerCase();
    const tier = tierRaw === 'elevated' || tierRaw === 'extreme' || tierRaw === 'absurd'
      ? tierRaw
      : 'heavy';
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 200);
    const data = getTopAnomalies(date, limit, direction, tier);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

const REPORTS_DIR = path.join(__dirname, '..', '..', 'data', 'options-reports');

router.get('/report/:symbol', async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol || '').trim().toUpperCase();
    if (!symbol) return res.status(400).json({ success: false, error: 'symbol required' });

    const optionsHistory = getOptionsFlowForSymbol(symbol, 10);
    const latest = optionsHistory[0] || null;
    const alerts = getOptionsFlowAlerts(7).filter(a => a.symbol === symbol);

    const classification = getSymbolClassification(symbol);
    const companyType = classification?.companyType || null;
    const valuationEngine = classification?.valuationEngineClass || null;

    let fundamentalsData: any = null;
    try {
      const fRes = await fetch(`http://localhost:${process.env.PORT || 3002}/api/fundamentals/${encodeURIComponent(symbol)}`);
      const fJson = await fRes.json() as any;
      if (fJson.success && fJson.data) {
        fundamentalsData = fJson.data.snapshot || fJson.data;
      }
    } catch { /* fundamentals service may not respond */ }

    const riskFlags = fundamentalsData?.riskFlags || [];
    const tags = fundamentalsData?.tags || [];

    let insiderTrades: any[] = [];
    try {
      const edgarDbPath = path.join(__dirname, '..', '..', 'data', 'edgar-filings.sqlite');
      if (fs.existsSync(edgarDbPath)) {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(edgarDbPath, { readOnly: true });
        try {
          insiderTrades = db.prepare(`
            SELECT filing_date, reporter_name, transaction_type, shares, price_per_share
            FROM insider_trades
            WHERE symbol = ?
            ORDER BY filing_date DESC LIMIT 10
          `).all(symbol) as any[];
        } finally { db.close(); }
      }
    } catch { /* edgar db may not exist */ }

    let socialBuzz: any = null;
    try {
      const bRes = await fetch(`http://localhost:${process.env.PORT || 3002}/api/fundamentals/${encodeURIComponent(symbol)}/buzz`);
      const bJson = await bRes.json() as any;
      if (bJson.success) socialBuzz = bJson.data;
    } catch { /* buzz may not be available */ }

    const verdict = buildVerdict(latest, riskFlags, insiderTrades);

    const vs = fundamentalsData?.valuationSnapshot || {};
    const re = fundamentalsData?.reportedExecution || {};
    const fe = fundamentalsData?.forwardExpectations || {};
    const hq = (fundamentalsData?.historicalStatements?.quarterly || []).slice(0, 3);

    const dataPack = {
      symbol,
      company_type: companyType,
      valuation_engine: valuationEngine,
      price: fundamentalsData?.currentPrice || latest?.stock_price || null,
      sector: fundamentalsData?.sector || null,
      industry: fundamentalsData?.industry || null,
      market_cap: fundamentalsData?.marketCap || null,
      options: latest ? {
        put_call_ratio: latest.put_call_volume_ratio,
        call_put_ratio: latest.call_put_volume_ratio,
        flow_bias: latest.flow_bias,
        dominant_volume_ratio: latest.dominant_volume_ratio,
        put_volume: latest.total_put_volume,
        call_volume: latest.total_call_volume,
        put_oi: latest.total_put_oi,
        call_oi: latest.total_call_oi,
        call_put_oi_ratio: latest.call_put_oi_ratio,
        iv_skew: latest.iv_skew,
        anomaly_flags: latest.anomaly_flags,
        trade_date: latest.trade_date,
      } : null,
      valuation: {
        fair_value_mid: vs.fairValueMid ?? null,
        valuation_state: vs.valuationState ?? null,
        quality_grade: vs.qualityGrade ?? null,
        quality_score: vs.qualityScore ?? null,
        valuation_gap_pct: vs.valuationGapPct ?? null,
        coverage_mode: vs.coverageMode ?? null,
      },
      financials: fundamentalsData ? {
        revenue: fundamentalsData.annualRevenue,
        revenue_growth_pct: fundamentalsData.revenueGrowthPct,
        earnings_growth_pct: fundamentalsData.earningsGrowthPct,
        gross_margin_pct: fundamentalsData.grossMarginPct,
        operating_margin_pct: fundamentalsData.operatingMarginPct,
        profit_margin_pct: fundamentalsData.profitMarginPct,
        debt_to_equity: fundamentalsData.debtToEquity,
        current_ratio: fundamentalsData.currentRatio,
        quick_ratio: fundamentalsData.quickRatio,
        total_cash: fundamentalsData.totalCash,
        total_debt: fundamentalsData.totalDebt,
        free_cash_flow: fundamentalsData.freeCashFlowTTM,
        operating_cash_flow: fundamentalsData.operatingCashFlowTTM,
        cash_burn: fundamentalsData.quarterlyCashBurn,
        cash_runway_quarters: fundamentalsData.cashRunwayQuarters,
        short_float_pct: fundamentalsData.shortFloatPct,
        short_ratio: fundamentalsData.shortRatio,
        institutional_pct: fundamentalsData.institutionalOwnershipPct,
        insider_pct: fundamentalsData.insiderOwnershipPct,
        beta: fundamentalsData.beta,
      } : null,
      earnings_execution: {
        score: re.score ?? null,
        eps_beat_streak: re.epsBeatStreak ?? null,
        avg_eps_surprise_pct: re.avgEpsSurprisePct ?? null,
        avg_sales_surprise_pct: re.avgSalesSurprisePct ?? null,
        latest_eps_surprise_pct: re.latestEpsSurprisePct ?? null,
        latest_period: re.latestPeriod ?? null,
        history: (re.history || []).slice(0, 4),
      },
      forward_expectations: {
        score: fe.score ?? null,
        signal: fe.signal ?? null,
        current_qtr_growth_pct: fe.currentQtrGrowthPct ?? null,
        next_qtr_growth_pct: fe.nextQtrGrowthPct ?? null,
        current_year_growth_pct: fe.currentYearGrowthPct ?? null,
        quarterly_revenue_growth_pct: fe.quarterlyRevenueGrowthPct ?? null,
        quarterly_earnings_growth_pct: fe.quarterlyEarningsGrowthPct ?? null,
      },
      quarterly_financials: hq.map((q: any) => ({
        period: q.period,
        revenue: q.metrics?.revenue,
        revenue_yoy_pct: q.metrics?.revenueYoYGrowthPct,
        eps: q.metrics?.eps,
        eps_yoy_pct: q.metrics?.epsYoYGrowthPct,
        operating_margin_pct: q.metrics?.operatingMarginPct,
        debt_to_equity: q.metrics?.debtToEquity,
        current_ratio: q.metrics?.currentRatio,
        total_cash: q.metrics?.totalCash,
        total_debt: q.metrics?.totalDebt,
      })),
      risk_flags: riskFlags,
      tags: Array.isArray(tags) ? tags.map((t: any) => typeof t === 'string' ? t : t.label || t) : tags,
      status_note: fundamentalsData?.statusNote || null,
      risk_note: fundamentalsData?.riskNote || null,
      hold_context: fundamentalsData?.holdContext || null,
      squeeze_pressure: fundamentalsData?.squeezePressureLabel || null,
      days_until_earnings: fundamentalsData?.daysUntilEarnings ?? null,
      insider_trades: insiderTrades.slice(0, 5),
      social_buzz_summary: socialBuzz ? (() => {
        const msgs = Array.isArray(socialBuzz.recent_messages) ? socialBuzz.recent_messages : [];
        const bySrc: Record<string, number> = {};
        for (const m of msgs) {
          const src = String(m.source || 'Unknown');
          bySrc[src] = (bySrc[src] || 0) + 1;
        }
        return {
          total_messages: msgs.length,
          by_source: bySrc,
          source_label: socialBuzz.source_label || 'StockTwits + Yahoo Finance',
          sentiment_label: socialBuzz.sentiment_label || null,
          sentiment_score: socialBuzz.sentiment_score ?? null,
          bullish_pct: socialBuzz.bullish_pct ?? null,
          bearish_pct: socialBuzz.bearish_pct ?? null,
          top_messages: msgs.slice(0, 5).map((m: any) => ({
            source: m.source,
            body: String(m.body || '').slice(0, 200),
            sentiment: m.sentiment,
          })),
        };
      })() : null,
      verdict,
    };

    let narrative: string | null = null;
    try {
      const { getConfiguredOpenAIKey } = require('../services/aiSettings');
      const apiKey = getConfiguredOpenAIKey();
      if (apiKey) {
        narrative = await generateNarrative(apiKey, dataPack);
      }
    } catch { /* LLM may not be available */ }

    const report = {
      symbol,
      company_type: companyType,
      valuation_engine: valuationEngine,
      generated_at: new Date().toISOString(),
      narrative,
      options_flow: {
        latest,
        history: optionsHistory,
        alerts,
      },
      fundamentals: {
        risk_flags: riskFlags,
        tags: dataPack.tags,
        status_note: dataPack.status_note,
        risk_note: dataPack.risk_note,
        hold_context: dataPack.hold_context,
        squeeze_pressure: dataPack.squeeze_pressure,
        valuation_snapshot: fundamentalsData?.valuationSnapshot ? {
          state: vs.valuationState ?? null,
          quality_grade: vs.qualityGrade ?? null,
          quality_score: vs.qualityScore ?? null,
          coverage_mode: vs.coverageMode ?? null,
          snapshot_price: vs.price ?? null,
          current_price: fundamentalsData.currentPrice ?? null,
          fair_value_low: vs.fairValueLow ?? null,
          fair_value_mid: vs.fairValueMid ?? null,
          fair_value_high: vs.fairValueHigh ?? null,
          valuation_gap_pct: vs.valuationGapPct ?? null,
          as_of: vs.asOfDate ?? null,
        } : null,
        dcf_summary: fundamentalsData ? {
          fair_value: vs.fairValueMid ?? fundamentalsData.fairValue,
          current_price: fundamentalsData.currentPrice,
          upside_pct: vs.valuationGapPct ?? fundamentalsData.upsidePct,
          valuation_label: vs.valuationState ?? fundamentalsData.valuationLabel,
          quality_grade: vs.qualityGrade,
          sector: fundamentalsData.sector,
          industry: fundamentalsData.industry,
          market_cap: fundamentalsData.marketCap,
          pe_ratio: fundamentalsData.peRatio,
          debt_to_equity: fundamentalsData.debtToEquity,
          current_ratio: fundamentalsData.currentRatio,
          revenue_growth: fundamentalsData.revenueGrowthPct,
          profit_margin_pct: fundamentalsData.profitMarginPct,
          free_cash_flow: fundamentalsData.freeCashFlowTTM,
          short_float_pct: fundamentalsData.shortFloatPct,
          short_ratio: fundamentalsData.shortRatio,
        } : null,
        earnings_execution: dataPack.earnings_execution,
        forward_expectations: dataPack.forward_expectations,
        quarterly_financials: dataPack.quarterly_financials,
      },
      insider_activity: insiderTrades,
      social_buzz: socialBuzz,
      verdict,
    };

    if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const reportFile = path.join(REPORTS_DIR, `${symbol}_${new Date().toISOString().slice(0, 10)}.json`);
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

    res.json({ success: true, data: report });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

function getSectorValuationGuidance(companyType: string | null, industry: string | null): string {
  if (companyType === 'reit') {
    return `
═══ SECTOR-SPECIFIC VALUATION GUIDANCE (REIT) ═══
CRITICAL: This is a Real Estate Investment Trust. Standard valuation metrics DO NOT APPLY in the normal way.

You MUST adjust your analysis for the following REIT-specific realities:
- CURRENT RATIO: REITs structurally run low current ratios (often 0.2-0.5). This is NORMAL for the business model, not a liquidity crisis. REITs fund obligations through recurring rent cash flows, revolving credit facilities, and commercial paper programs — not current assets.
- FREE CASH FLOW: Negative FCF for a REIT usually means the company is ACQUIRING PROPERTIES (investing outflows), not burning cash. This is normal growth behavior. Judge cash generation by Operating Cash Flow and AFFO (Adjusted Funds From Operations), not FCF.
- CASH BALANCE: Low cash on hand is standard for REITs. They have access to debt markets, equity issuance, and commercial paper programs. "Cash runway" metrics designed for operating companies are misleading here.
- CORRECT VALUATION METRICS: Use FFO/AFFO per share, dividend coverage ratio, P/AFFO multiple, NAV (Net Asset Value), cap rate spreads, and cost of capital vs acquisition yields. NOT standard DCF on free cash flow.
- DEBT: REITs use leverage by design. Debt/equity ratios of 50-100+ are common. Focus on fixed-charge coverage, debt maturity ladder, and access to unsecured funding — not raw leverage numbers.
- SHARE ISSUANCE: Equity issuance is a normal funding mechanism for REITs. It is dilutive, but not automatically negative. Judge it by whether acquisitions are accretive to AFFO per share.
- RISK FLAGS: If the system flagged "liquidity_crisis" or "heavy burn" based on current ratio or FCF, these flags are likely FALSE POSITIVES for a REIT. State this explicitly.

The REAL concerns for REITs are: (1) AFFO per share trajectory, (2) dividend coverage and sustainability, (3) tenant quality and concentration, (4) debt maturity schedule and refinancing risk, (5) acquisition spread vs cost of capital, (6) occupancy and same-store rent growth.

DO NOT call a REIT "distressed" based on low current ratio or negative FCF alone. That analysis is wrong for this business model.`;
  }

  if (companyType === 'financial_company') {
    return `
═══ SECTOR-SPECIFIC VALUATION GUIDANCE (FINANCIAL COMPANY) ═══
CRITICAL: This is a financial institution. Standard DCF and margin analysis DO NOT APPLY normally.

- CORRECT VALUATION: Use Price/Book, Price/Tangible Book, ROE vs Cost of Equity, Net Interest Margin (NIM), and efficiency ratio.
- CURRENT RATIO: Not meaningful for banks/financial companies. They hold deposits as liabilities by design.
- FREE CASH FLOW: Not the primary valuation metric. Focus on net interest income, fee income, provisions for loan losses, and return on assets.
- LEVERAGE: Financial companies are inherently leveraged. Focus on Tier 1 capital ratio, CET1, and regulatory capital adequacy.
- RISK: Focus on loan portfolio quality, non-performing loans, charge-off rates, and interest rate sensitivity.`;
  }

  if (companyType === 'preprofit_growth') {
    return `
═══ SECTOR-SPECIFIC VALUATION GUIDANCE (PRE-PROFIT GROWTH) ═══
This company is pre-profit or early-stage. Standard earnings-based metrics may be misleading.

- CORRECT VALUATION: Use revenue multiples (EV/Sales), Rule of 40 (revenue growth + margin), and TAM/penetration analysis.
- CASH BURN: Expected for this stage. Focus on cash runway, funding access, and path to profitability.
- MARGINS: Negative margins may be intentional investment in growth. Track gross margin trajectory and unit economics.
- RISK: Binary — depends on whether the company can reach profitability before capital runs out.`;
  }

  return '';
}

function getValuationMethodLabel(companyType: string | null, valuationEngine: string | null): string {
  if (companyType === 'reit' || valuationEngine === 'reit_affo') {
    return 'REIT AFFO/NAV valuation engine';
  }
  if (companyType === 'financial_company' || valuationEngine === 'roe_book_value') {
    return 'financial-company ROE/book-value valuation engine';
  }
  if (companyType === 'preprofit_growth' || valuationEngine === 'sales_scenario') {
    return 'growth-company sales-scenario valuation engine';
  }
  return 'operating-company DCF valuation engine';
}

async function generateNarrative(apiKey: string, data: any): Promise<string> {
  const fmtNum = (n: any, dec = 1) => n != null && isFinite(n) ? Number(n).toFixed(dec) : 'N/A';
  const fmtDollar = (n: any) => n != null && isFinite(n) ? '$' + Number(n).toLocaleString() : 'N/A';
  const fmtPct = (n: any) => n != null && isFinite(n) ? (n > 0 ? '+' : '') + Number(n).toFixed(1) + '%' : 'N/A';
  const valuationMethodLabel = getValuationMethodLabel(data.company_type, data.valuation_engine);

  const qtrLines = (data.quarterly_financials || []).map((q: any) =>
    `  ${q.period}: Rev ${fmtDollar(q.revenue)} (YoY ${fmtPct(q.revenue_yoy_pct)}), EPS $${fmtNum(q.eps, 2)} (YoY ${fmtPct(q.eps_yoy_pct)}), OpMargin ${fmtNum(q.operating_margin_pct)}%, D/E ${fmtNum(q.debt_to_equity)}, CurrentRatio ${fmtNum(q.current_ratio)}, Cash ${fmtDollar(q.total_cash)}, Debt ${fmtDollar(q.total_debt)}`
  ).join('\n');

  const earningsHistory = (data.earnings_execution?.history || []).map((h: any) =>
    `  ${h.period} (${h.date}): EPS actual $${fmtNum(h.epsActual, 2)} vs est $${fmtNum(h.epsEstimate, 2)} (${fmtPct(h.epsSurprisePct)} surprise), Sales $${fmtNum(h.salesActual, 1)}M vs est $${fmtNum(h.salesEstimate, 1)}M (${fmtPct(h.salesSurprisePct)} surprise)`
  ).join('\n');

  const riskFlagLines = (data.risk_flags || []).map((f: any) => {
    if (typeof f === 'string') return `  - ${f}`;
    return `  - [${(f.severity || '').toUpperCase()}] ${f.label || f.code}: ${f.short || ''} — ${f.detail || ''}`;
  }).join('\n');

  const tagLabels = (data.tags || []).map((t: any) => typeof t === 'string' ? t : t.label || t).join(', ');

  const sectorGuidance = getSectorValuationGuidance(data.company_type, data.industry);
  const valuationSourceGuidance = "Use the provided valuation output as Ledger's valuation source of truth. Do not invent a separate fair value in prose. If the valuation method is not operating-company DCF, do not describe it as DCF.";
  const ledgerDoctrine = loadLedgerWorkspaceSkill('market-intelligence-investigation', [
    'options-flow-report.md',
  ]);

  const prompt = `You are Ledger, a skeptical financial analyst inside a market-intelligence workstation.

Use the Ledger workspace doctrine below as your governing instructions. The evidence packet follows after the doctrine.

LEDGER WORKSPACE DOCTRINE:
${ledgerDoctrine}

${sectorGuidance}
${valuationSourceGuidance}
═══════════════════════════════════════════════════
SYMBOL: ${data.symbol}
COMPANY TYPE: ${data.company_type || 'operating_company'} (valuation engine: ${data.valuation_engine || 'dcf_operating'})
VALUATION METHOD: ${valuationMethodLabel}
PRICE: $${data.price || 'N/A'}
SECTOR: ${data.sector || 'Unknown'} / ${data.industry || 'Unknown'}
MARKET CAP: ${data.market_cap ? '$' + (data.market_cap / 1e9).toFixed(1) + 'B' : 'N/A'}

═══ OPTIONS FLOW (${data.options?.trade_date || 'today'}) ═══
Flow Bias: ${data.options?.flow_bias || 'N/A'}
Put/Call Volume Ratio: ${data.options?.put_call_ratio?.toFixed(2) || 'N/A'}
Call/Put Volume Ratio: ${data.options?.call_put_ratio?.toFixed(2) || 'N/A'}
Put Volume: ${data.options?.put_volume?.toLocaleString() || 0} | Call Volume: ${data.options?.call_volume?.toLocaleString() || 0}
Put OI: ${data.options?.put_oi?.toLocaleString() || 0} | Call OI: ${data.options?.call_oi?.toLocaleString() || 0}
IV Skew: ${data.options?.iv_skew != null ? (data.options.iv_skew * 100).toFixed(1) + '%' : 'N/A'}
Anomaly Flags: ${data.options?.anomaly_flags?.join(', ') || 'none'}

═══ VALUATION (${valuationMethodLabel}) ═══
Fair Value (mid): ${fmtDollar(data.valuation?.fair_value_mid)}
Valuation State: ${data.valuation?.valuation_state || 'N/A'}
Valuation Gap: ${fmtPct(data.valuation?.valuation_gap_pct)}
Quality Grade: ${data.valuation?.quality_grade || 'N/A'} (score: ${data.valuation?.quality_score ?? 'N/A'})
Coverage Mode: ${data.valuation?.coverage_mode || 'N/A'}

═══ BALANCE SHEET & KEY FINANCIALS ═══
Revenue (annual): ${fmtDollar(data.financials?.revenue)}
Revenue Growth: ${fmtPct(data.financials?.revenue_growth_pct)}
Earnings Growth: ${fmtPct(data.financials?.earnings_growth_pct)}
Gross Margin: ${fmtNum(data.financials?.gross_margin_pct)}%
Operating Margin: ${fmtNum(data.financials?.operating_margin_pct)}%
Profit Margin: ${fmtNum(data.financials?.profit_margin_pct)}%
Debt/Equity: ${fmtNum(data.financials?.debt_to_equity)}
Current Ratio: ${fmtNum(data.financials?.current_ratio)}
Quick Ratio: ${fmtNum(data.financials?.quick_ratio)}
Total Cash: ${fmtDollar(data.financials?.total_cash)}
Total Debt: ${fmtDollar(data.financials?.total_debt)}
FCF (TTM): ${fmtDollar(data.financials?.free_cash_flow)}
Operating CF (TTM): ${fmtDollar(data.financials?.operating_cash_flow)}
Quarterly Cash Burn: ${fmtDollar(data.financials?.cash_burn)}
Cash Runway: ${data.financials?.cash_runway_quarters ?? 'N/A'} quarters
Short Float: ${fmtNum(data.financials?.short_float_pct)}%
Short Ratio: ${fmtNum(data.financials?.short_ratio)}
Institutional Ownership: ${fmtNum(data.financials?.institutional_pct)}%
Insider Ownership: ${fmtNum(data.financials?.insider_pct)}%
Beta: ${fmtNum(data.financials?.beta)}

═══ QUARTERLY TREND (LAST 3 QUARTERS) ═══
${qtrLines || '  No quarterly data available.'}

═══ EARNINGS EXECUTION ═══
Execution Score: ${data.earnings_execution?.score ?? 'N/A'}/100
EPS Beat Streak: ${data.earnings_execution?.eps_beat_streak ?? 'N/A'}
Avg EPS Surprise: ${fmtPct(data.earnings_execution?.avg_eps_surprise_pct)}
Avg Sales Surprise: ${fmtPct(data.earnings_execution?.avg_sales_surprise_pct)}
Recent Quarters:
${earningsHistory || '  No earnings history available.'}

═══ FORWARD EXPECTATIONS ═══
Forward Score: ${data.forward_expectations?.score ?? 'N/A'}/100
Signal: ${data.forward_expectations?.signal || 'N/A'}
Current Qtr EPS Growth Est: ${fmtPct(data.forward_expectations?.current_qtr_growth_pct)}
Next Qtr EPS Growth Est: ${fmtPct(data.forward_expectations?.next_qtr_growth_pct)}
Current Year Growth Est: ${fmtPct(data.forward_expectations?.current_year_growth_pct)}
Quarterly Revenue Growth: ${fmtPct(data.forward_expectations?.quarterly_revenue_growth_pct)}
Quarterly Earnings Growth: ${fmtPct(data.forward_expectations?.quarterly_earnings_growth_pct)}

═══ RISK FLAGS ═══
${riskFlagLines || '  None detected.'}

═══ TAGS ═══
${tagLabels || 'None'}

${data.status_note ? '═══ ANALYST STATUS NOTE ═══\n' + data.status_note + '\n' : ''}${data.risk_note ? '═══ RISK NOTE ═══\n' + data.risk_note + '\n' : ''}${data.hold_context ? '═══ HOLD CONTEXT ═══\n' + data.hold_context + '\n' : ''}${data.squeeze_pressure ? 'SQUEEZE PRESSURE: ' + data.squeeze_pressure + '\n' : ''}${data.days_until_earnings != null ? 'DAYS UNTIL NEXT EARNINGS: ' + data.days_until_earnings + '\n' : ''}
═══ RECENT INSIDER ACTIVITY (SEC FORM 4) ═══
${data.insider_trades?.length ? data.insider_trades.map((t: any) => '  ' + t.filing_date + ' | ' + t.reporter_name + ' | ' + t.transaction_type + ' | ' + (t.shares || 0).toLocaleString() + ' shares @ $' + (t.price_per_share || 0)).join('\n') : '  No recent insider trades found.'}

═══ SOCIAL BUZZ (${data.social_buzz_summary?.source_label || 'N/A'}) ═══
Total messages: ${data.social_buzz_summary?.total_messages || 0}
By source: ${data.social_buzz_summary?.by_source ? Object.entries(data.social_buzz_summary.by_source).map(([k,v]: any) => k + ': ' + v).join(', ') : 'None'}
Sentiment: ${data.social_buzz_summary?.sentiment_label || 'N/A'} (score: ${data.social_buzz_summary?.sentiment_score ?? 'N/A'}, bullish: ${data.social_buzz_summary?.bullish_pct ?? 'N/A'}%, bearish: ${data.social_buzz_summary?.bearish_pct ?? 'N/A'}%)
Sample posts:
${data.social_buzz_summary?.top_messages?.length ? data.social_buzz_summary.top_messages.map((m: any) => '  [' + m.source + '] ' + m.body).join('\n') : '  None.'}
═══════════════════════════════════════════════════

Write the intelligence brief required by the Options Flow Report document. Use the workspace doctrine above as the report structure. Cite specific numbers from the evidence packet. No generic disclaimers.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 800,
    }),
  });

  const result = await response.json() as any;
  return result.choices?.[0]?.message?.content || null;
}

function buildVerdict(
  optionsFlow: any,
  riskFlags: any[],
  insiderTrades: any[],
): { risk_level: string; summary: string; signals: string[] } {
  const signals: string[] = [];
  let riskScore = 0;

  if (optionsFlow) {
    const pcr = optionsFlow.put_call_volume_ratio || 0;
    const cpr = optionsFlow.call_put_volume_ratio || (
      optionsFlow.total_put_volume > 0
        ? optionsFlow.total_call_volume / optionsFlow.total_put_volume
        : 0
    );
    if (pcr >= 2.0) {
      const tier = pcr >= 20 ? 'absurd' : pcr >= 5 ? 'extreme' : 'heavy';
      signals.push(`${tier[0].toUpperCase() + tier.slice(1)} put/call ratio: ${pcr.toFixed(2)}`);
      riskScore += 3;
    } else if (pcr >= 1.5) {
      signals.push(`Elevated put/call ratio: ${pcr.toFixed(2)}`);
      riskScore += 2;
    }

    if (cpr >= 2.0) {
      const tier = cpr >= 20 ? 'absurd' : cpr >= 5 ? 'extreme' : 'heavy';
      signals.push(`${tier[0].toUpperCase() + tier.slice(1)} call/put ratio: ${cpr.toFixed(2)}`);
      riskScore += 3;
    } else if (cpr >= 1.5) {
      signals.push(`Elevated call/put ratio: ${cpr.toFixed(2)}`);
      riskScore += 2;
    }

    if (optionsFlow.anomaly_flags?.includes('extreme_put_buying')) {
      signals.push('Put volume far exceeds historical average');
      riskScore += 2;
    }
    if (optionsFlow.anomaly_flags?.includes('extreme_call_buying')) {
      signals.push('Call volume far exceeds puts/history');
      riskScore += 2;
    }
    if (optionsFlow.anomaly_flags?.includes('put_skew_spike')) {
      signals.push('IV skew spike — OTM puts priced at premium');
      riskScore += 2;
    }
    if (optionsFlow.anomaly_flags?.includes('smart_money_warning')) {
      signals.push('Smart money warning: multiple anomaly triggers');
      riskScore += 3;
    }
  }

  if (riskFlags && riskFlags.length > 0) {
    const severe = riskFlags.filter((f: any) => f.severity === 'high' || f.severity === 'critical');
    if (severe.length > 0) {
      signals.push(`${severe.length} severe risk flag(s): ${severe.map((f: any) => f.code).join(', ')}`);
      riskScore += severe.length * 2;
    }
    const moderate = riskFlags.filter((f: any) => f.severity === 'medium');
    if (moderate.length > 0) {
      signals.push(`${moderate.length} moderate risk flag(s): ${moderate.map((f: any) => f.code).join(', ')}`);
      riskScore += moderate.length;
    }
  }

  const recentSells = insiderTrades.filter((t: any) =>
    t.transaction_type === 'S' || t.transaction_type === 'S-Sale'
  );
  if (recentSells.length >= 3) {
    signals.push(`${recentSells.length} insider sells in recent filings`);
    riskScore += 2;
  }

  let risk_level = 'LOW';
  if (riskScore >= 8) risk_level = 'CRITICAL';
  else if (riskScore >= 5) risk_level = 'HIGH';
  else if (riskScore >= 3) risk_level = 'ELEVATED';

  const summary = signals.length > 0
    ? `${risk_level} risk — ${signals.length} signal(s) detected combining options flow, fundamental risk flags, and insider activity.`
    : 'No significant anomalies detected.';

  return { risk_level, summary, signals };
}

export default router;

