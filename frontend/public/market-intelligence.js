/* =========================================================
   Market-Intelligence page — Phase 0 mock
   Spec: .planning/plans/ACTIVE/market-intelligence-scenario-engine-prd-pdr.md
         §UI Contract, §API Contract, §Card visual rules
   Data shapes: backend/src/types/marketIntelligence.ts (ApiScenarioListItem etc.)

   No API calls yet. Everything below is hand-crafted sample data
   sized to exercise every visual rule the PRD calls out:
     - Macro / Social Arb / mixed_news_led / mixed_anomaly_led detection paths
     - All 5 lifecycle status bands + at least one INVALIDATED
     - All 4 coverage tiers (barely / lightly / well / mega)
     - Authenticity score bands (high / borderline / suppressed)
     - Validity flags including LIKELY_INAUTHENTIC + MEGA_COVERAGE_PENALTY
     - Cross-engine corroboration ribbons
     - Stale freshness
   ========================================================= */
(function () {
  'use strict';

  // ----------------------------------------------------------
  // Sample scenarios (10 total)
  // ----------------------------------------------------------
  var NOW = Math.floor(Date.now() / 1000);
  var DAY = 86400;

  var SAMPLE_SCENARIOS = [
    {
      id: 'sc-001',
      slug: 'mideast-shipping-disruption',
      engine: 'macro',
      detection_path: 'news_cluster',
      scenario_type: 'geopolitical',
      primary_theme: 'energy_supply',
      display_name: 'Red Sea shipping disruption escalating into Hormuz risk premium',
      summary: 'Cluster of Reuters/AP/Lloyd\u2019s wires + EIA inventory build with overlapping named entities (CENTCOM, IRGC, Maersk) crossed cosine 0.81 against 9 sources in 36h.',
      status: 'DEVELOPING',
      time_horizon: 'weeks',
      signal_strength: 78, confidence_score: 0.62, confidence_level: 'medium',
      scenario_score: 81,
      coverage_tier: 'mega_covered',
      authenticity_score: null, peak_z_score: null, cross_platform_corroboration: false,
      source_breadth_score: 0.82, source_count: 9, source_type_count: 4,
      validity_flags: [],
      last_updated_at: NOW - 240, expires_at: NOW + 21 * DAY,
      top_universe_candidates: [
        { symbol: 'XOM', composite_rank: 88.4, coverage_tier: 'mega_covered',  exposure_direction: 'long_beneficiary' },
        { symbol: 'CVX', composite_rank: 85.1, coverage_tier: 'mega_covered',  exposure_direction: 'long_beneficiary' },
        { symbol: 'ZIM', composite_rank: 73.2, coverage_tier: 'lightly_covered', exposure_direction: 'long_beneficiary' }
      ]
    },
    {
      id: 'sc-002',
      slug: 'fomc-cut-repricing',
      engine: 'macro',
      detection_path: 'news_cluster',
      scenario_type: 'macro',
      primary_theme: 'rate_path',
      display_name: 'Sub-200K NFP printing higher Fed-cut probability',
      summary: 'Fed-funds futures repriced 18bps for Sept after softer-than-expected jobs print; Powell-speak followed within 4h.',
      status: 'CONFIRMED',
      time_horizon: 'days',
      signal_strength: 64, confidence_score: 0.71, confidence_level: 'high',
      scenario_score: 73,
      coverage_tier: 'mega_covered',
      authenticity_score: null, peak_z_score: null, cross_platform_corroboration: false,
      source_breadth_score: 0.74, source_count: 7, source_type_count: 3,
      validity_flags: [],
      last_updated_at: NOW - 1100, expires_at: NOW + 7 * DAY,
      top_universe_candidates: [
        { symbol: 'IWM', composite_rank: 71.0, coverage_tier: 'mega_covered',     exposure_direction: 'long_beneficiary' },
        { symbol: 'XBI', composite_rank: 65.8, coverage_tier: 'well_covered',     exposure_direction: 'long_beneficiary' },
        { symbol: 'KRE', composite_rank: 64.2, coverage_tier: 'well_covered',     exposure_direction: 'long_beneficiary' }
      ]
    },
    {
      id: 'sc-003',
      slug: 'frmc-frame-primer-dupe',
      engine: 'social_arbitrage',
      detection_path: 'topic_anomaly',
      scenario_type: 'consumer_cycle',
      primary_theme: 'beauty_dupe_culture',
      display_name: 'Frame Cosmetics primer flagged as Charlotte Tilbury Flawless Filter dupe',
      summary: 'Concept "frame_primer_dupe" spiked z=4.6 in r/MakeupAddiction, then corroborated within 36h in #beauty Bluesky and Discord beauty-uncovered server.',
      status: 'EARLY',
      time_horizon: 'weeks',
      signal_strength: 67, confidence_score: 0.54, confidence_level: 'medium',
      scenario_score: 79,
      coverage_tier: 'lightly_covered',
      authenticity_score: 0.81, peak_z_score: 4.6, cross_platform_corroboration: true,
      source_breadth_score: 0.55, source_count: 3, source_type_count: 2,
      seed_community: 'discord:beauty-uncovered',
      validity_flags: ['LOW_HISTORY'],
      last_updated_at: NOW - 142, expires_at: NOW + 30 * DAY,
      top_universe_candidates: [
        { symbol: 'FRMC', composite_rank: 82.7, coverage_tier: 'lightly_covered', exposure_direction: 'long_beneficiary' },
        { symbol: 'ULTA', composite_rank: 41.3, coverage_tier: 'mega_covered',    exposure_direction: 'long_beneficiary' }
      ]
    },
    {
      id: 'sc-004',
      slug: 'goblin-mode-streaming-cancel',
      engine: 'social_arbitrage',
      detection_path: 'topic_anomaly',
      scenario_type: 'consumer_cycle',
      primary_theme: 'streaming_cycle',
      display_name: 'Concentrated streaming-service cancellation chatter, multi-platform',
      summary: 'Concept "cancelled_streaming" + "stopped_eating_out" cluster spiked z=3.8 across 4 niche budgeting communities in 5 days. No mainstream coverage yet.',
      status: 'EARLY',
      time_horizon: 'months',
      signal_strength: 48, confidence_score: 0.41, confidence_level: 'low',
      scenario_score: 71,
      coverage_tier: 'barely_covered',
      authenticity_score: 0.76, peak_z_score: 3.8, cross_platform_corroboration: true,
      source_breadth_score: 0.62, source_count: 4, source_type_count: 3,
      seed_community: 'forum:r-frugal',
      validity_flags: ['LOW_HISTORY'],
      last_updated_at: NOW - 60, expires_at: NOW + 60 * DAY,
      top_universe_candidates: [
        { symbol: 'NFLX', composite_rank: 38.0, coverage_tier: 'mega_covered',    exposure_direction: 'short_loser' },
        { symbol: 'PARA', composite_rank: 56.1, coverage_tier: 'lightly_covered', exposure_direction: 'short_loser' },
        { symbol: 'WBD',  composite_rank: 49.8, coverage_tier: 'lightly_covered', exposure_direction: 'short_loser' }
      ]
    },
    {
      id: 'sc-005',
      slug: 'eu-ai-act-mid-tier-saas',
      engine: 'mixed',
      detection_path: 'mixed_news_led',
      scenario_type: 'policy',
      primary_theme: 'ai_regulation',
      display_name: 'EU AI Act compliance squeeze on mid-tier US SaaS',
      summary: 'News cluster (FT/WSJ/Politico EU) on AI Act implementation, later corroborated by HN + 4chan/g/ chatter on small-cap SaaS pulling EU customers.',
      status: 'DEVELOPING',
      time_horizon: 'months',
      signal_strength: 71, confidence_score: 0.69, confidence_level: 'high',
      scenario_score: 84,
      coverage_tier: 'well_covered',
      authenticity_score: 0.74, peak_z_score: 3.4, cross_platform_corroboration: true,
      source_breadth_score: 0.78, source_count: 8, source_type_count: 4,
      seed_community: 'hn:all',
      validity_flags: [],
      last_updated_at: NOW - 320, expires_at: NOW + 90 * DAY,
      top_universe_candidates: [
        { symbol: 'PATH', composite_rank: 67.4, coverage_tier: 'well_covered',    exposure_direction: 'short_loser' },
        { symbol: 'AI',   composite_rank: 64.8, coverage_tier: 'well_covered',    exposure_direction: 'short_loser' },
        { symbol: 'BIGC', composite_rank: 58.2, coverage_tier: 'lightly_covered', exposure_direction: 'short_loser' }
      ]
    },
    {
      id: 'sc-006',
      slug: 'stanley-quencher-saturation',
      engine: 'social_arbitrage',
      detection_path: 'topic_anomaly',
      scenario_type: 'consumer_cycle',
      primary_theme: 'lifestyle_saturation',
      display_name: 'Stanley Quencher exhaustion / dupe wave',
      summary: 'Z=3.1 on "stanley_quencher_dupes" + "owala_replacing_stanley" spreading from a single Discord into 3 niche shopping forums. Borderline authenticity \u2014 some evidence of coordinated promo accounts.',
      status: 'DEVELOPING',
      time_horizon: 'weeks',
      signal_strength: 52, confidence_score: 0.45, confidence_level: 'medium',
      scenario_score: 60,
      coverage_tier: 'mega_covered',
      authenticity_score: 0.58, peak_z_score: 3.1, cross_platform_corroboration: true,
      source_breadth_score: 0.48, source_count: 4, source_type_count: 2,
      seed_community: 'discord:r-hydroflask-replacement',
      validity_flags: ['AUTHENTICITY_BORDERLINE', 'MEGA_COVERAGE_PENALTY'],
      last_updated_at: NOW - 7800, expires_at: NOW + 21 * DAY,
      top_universe_candidates: [
        { symbol: 'YETI', composite_rank: 48.0, coverage_tier: 'mega_covered',    exposure_direction: 'short_loser' }
      ]
    },
    {
      id: 'sc-007',
      slug: 'fomc-frmc-mixed-anomaly-led',
      engine: 'mixed',
      detection_path: 'mixed_anomaly_led',
      scenario_type: 'single_company_catalyst',
      primary_theme: 'beauty_dupe_culture',
      display_name: 'FRMC chatter migrating from beauty Discord to ticker-indexed StockTwits',
      summary: 'Original sc-003 Frame Cosmetics anomaly now showing migration_to_ticker_indexed = true after StockTwits buzz spike 4 days post-Discord seed. Confirmation forming.',
      status: 'CONFIRMED',
      time_horizon: 'weeks',
      signal_strength: 73, confidence_score: 0.74, confidence_level: 'high',
      scenario_score: 88,
      coverage_tier: 'lightly_covered',
      authenticity_score: 0.84, peak_z_score: 4.9, cross_platform_corroboration: true,
      source_breadth_score: 0.66, source_count: 5, source_type_count: 3,
      seed_community: 'discord:beauty-uncovered',
      validity_flags: [],
      last_updated_at: NOW - 90, expires_at: NOW + 30 * DAY,
      top_universe_candidates: [
        { symbol: 'FRMC', composite_rank: 91.2, coverage_tier: 'lightly_covered', exposure_direction: 'long_beneficiary' }
      ]
    },
    {
      id: 'sc-008',
      slug: 'crowded-ai-infra-ipo',
      engine: 'macro',
      detection_path: 'news_cluster',
      scenario_type: 'sector_rotation',
      primary_theme: 'ai_infrastructure',
      display_name: 'AI-infra IPO pipeline crowding theme',
      summary: 'Cluster on data-center buildouts and IPO calendar; very high mention saturation, crowding score 0.78 means edge is gone for the obvious names.',
      status: 'CROWDED',
      time_horizon: 'months',
      signal_strength: 60, confidence_score: 0.52, confidence_level: 'medium',
      scenario_score: 55,
      coverage_tier: 'mega_covered',
      authenticity_score: null, peak_z_score: null, cross_platform_corroboration: false,
      source_breadth_score: 0.92, source_count: 14, source_type_count: 5,
      validity_flags: ['HIGH_MAINSTREAM_SATURATION'],
      last_updated_at: NOW - 4 * 3600, expires_at: NOW + 60 * DAY,
      top_universe_candidates: [
        { symbol: 'NVDA', composite_rank: 60.0, coverage_tier: 'mega_covered', exposure_direction: 'long_beneficiary' },
        { symbol: 'VRT',  composite_rank: 55.0, coverage_tier: 'well_covered', exposure_direction: 'long_beneficiary' }
      ]
    },
    {
      id: 'sc-009',
      slug: 'alleged-coordinated-pump-suppressed',
      engine: 'social_arbitrage',
      detection_path: 'topic_anomaly',
      scenario_type: 'single_company_catalyst',
      primary_theme: 'meme_pump',
      display_name: 'Suspected coordinated micro-cap pump (suppressed)',
      summary: 'Concept "moonshot_xyzq" spiked z=5.2 but failed authenticity gate \u2014 92% accounts < 30 days old, posting cadence robotic, identical phrasing across 3 discord servers within 9 minutes.',
      status: 'EARLY',
      time_horizon: 'hours',
      signal_strength: 0, confidence_score: 0.05, confidence_level: 'low',
      scenario_score: 0,
      coverage_tier: 'untradable',
      authenticity_score: 0.21, peak_z_score: 5.2, cross_platform_corroboration: true,
      source_breadth_score: 0.30, source_count: 3, source_type_count: 1,
      seed_community: 'discord:degen-plays',
      validity_flags: ['LIKELY_INAUTHENTIC', 'ONE_SOURCE_ONLY'],
      last_updated_at: NOW - 1800, expires_at: NOW + 7 * DAY,
      top_universe_candidates: []
    },
    {
      id: 'sc-010',
      slug: 'lithium-supply-fading',
      engine: 'macro',
      detection_path: 'news_cluster',
      scenario_type: 'commodity',
      primary_theme: 'commodity_supply',
      display_name: 'Lithium supply tightness narrative fading',
      summary: 'Mention velocity collapsing across the news basket after Albemarle production-update beat; scenario aging out of CONFIRMED.',
      status: 'FADING',
      time_horizon: 'months',
      signal_strength: 38, confidence_score: 0.30, confidence_level: 'low',
      scenario_score: 32,
      coverage_tier: 'well_covered',
      authenticity_score: null, peak_z_score: null, cross_platform_corroboration: false,
      source_breadth_score: 0.40, source_count: 3, source_type_count: 2,
      validity_flags: [],
      last_updated_at: NOW - 14 * 3600, expires_at: NOW + 14 * DAY,
      top_universe_candidates: [
        { symbol: 'ALB', composite_rank: 38.0, coverage_tier: 'well_covered', exposure_direction: 'long_beneficiary' },
        { symbol: 'LAC', composite_rank: 35.0, coverage_tier: 'lightly_covered', exposure_direction: 'long_beneficiary' }
      ]
    }
  ];

  // ----------------------------------------------------------
  // Hand-rolled drawer detail (only for the "FRMC migrating" card,
  // which we use as the showcase example). Other cards open with
  // a generic "detail not yet wired" body.
  // ----------------------------------------------------------
  var DRAWER_DETAIL = {
    'sc-007': {
      first_order_effects: [
        { asset_type: 'brand', asset_key: 'frame_cosmetics', direction: 'up',   magnitude: 'large',    source_method: 'hand_curated' },
        { asset_type: 'brand', asset_key: 'ct_cosmetics',    direction: 'down', magnitude: 'small',    source_method: 'llm_assist'  }
      ],
      second_order_effects: [
        { asset_type: 'sector', asset_key: 'beauty_retail',   direction: 'up',   magnitude: 'small',  source_method: 'hand_curated' },
        { asset_type: 'sector', asset_key: 'mass_market_cosmetics', direction: 'down', magnitude: 'small', source_method: 'hand_curated' }
      ],
      authenticity_signals: [
        { type: 'account_age_distribution', value: 0.78, weight: 0.15, notes: 'Median 412 days; long tail to 2014 accounts' },
        { type: 'cross_platform_signature', value: 0.92, weight: 0.15, notes: 'Spread to Bluesky #beauty within 36h, Discord beauty-uncovered within 48h' },
        { type: 'comment_depth',            value: 0.71, weight: 0.10, notes: 'Avg thread depth 4.2 replies; not single-comment posts' },
        { type: 'sentiment_shape',          value: 0.85, weight: 0.10, notes: 'Polarity SD 0.58; healthy disagreement, not echo' },
        { type: 'linguistic_similarity',    value: 0.94, weight: 0.10, notes: 'Avg pairwise cosine 0.31 \u2014 organic phrasing' },
        { type: 'account_quality',          value: 0.81, weight: 0.10, notes: 'Avg karma 4.2k; 8% verified Bluesky' },
        { type: 'mod_flag_rate',            value: 0.95, weight: 0.05, notes: 'Zero auto-removed comments' },
        { type: 'promoter_co_occurrence',   value: 0.88, weight: 0.10, notes: 'No detected affiliate-link / promo-account ring' },
        { type: 'posting_cadence',          value: 0.79, weight: 0.10, notes: 'Diurnal pattern matches community baseline; not 24/7 robotic' },
        { type: 'account_history_diversity',value: 0.86, weight: 0.05, notes: 'Authors active in unrelated subs/communities pre-spike' }
      ],
      evidence_timeline: [
        { ts: NOW - 10 * DAY,   source: 'discord:beauty-uncovered', text: 'Initial extraction: \u201cthe frame primer is literally the flawless filter dupe i\u2019ve been begging for\u201d' },
        { ts: NOW - 8  * DAY,   source: 'reddit:r/MakeupAddiction', text: 'Top post (4.1k upvotes) comparing FRMC primer side-by-side w/ CT' },
        { ts: NOW - 5  * DAY,   source: 'bluesky:#beauty',          text: 'Cross-platform spread: 47 unique authors, +12 verified beauty accounts' },
        { ts: NOW - 4  * DAY,   source: 'stocktwits:$FRMC',         text: 'Migration signal \u2014 first ticker-indexed mention referencing the dupe narrative' },
        { ts: NOW - 36 * 3600,  source: 'yahoo:msgboard',           text: '$FRMC board: 3 new threads in 24h, all referencing TikTok beauty creators' },
        { ts: NOW - 90,         source: 'system',                   text: 'authenticity_signals_recomputed; no hard-limit triggers' }
      ],
      candidates: [
        { symbol: 'FRMC', composite_rank: 91.2, coverage_tier: 'lightly_covered', dcf_gap: '+18%', tech_ready: true,  buzz_z: 4.9, exposure_direction: 'long_beneficiary' }
      ]
    }
  };

  // ----------------------------------------------------------
  // Live-data cache. The page stays in an explicit loading/empty state until
  // /api/market-intelligence/scenarios responds, so sample fixtures never look live.
  // ----------------------------------------------------------
  var SCENARIOS = [];
  var LIVE_DETAILS = {};
  var LIVE_REPORTS = {};
  var KNOWN_TICKER_SET = new Set();
  var KNOWN_TICKER_LIST = [];

  // ----------------------------------------------------------
  // State
  // ----------------------------------------------------------
  var STATE_VERSION = 2;
  var _saved = {};
  try { _saved = JSON.parse(localStorage.getItem('mi_state') || '{}'); } catch (e) { /* ignore */ }

  var STATE = {
    engineView: _saved.engineView || 'both',
    macro: {
      status: _saved.macroStatus || 'ALL',
      coverageTiers: new Set(_saved.macroCoverage || ['barely_covered', 'lightly_covered', 'well_covered', 'mega_covered'])
    },
    social: {
      status: _saved.socialStatus || 'ALL',
      coverageTiers: new Set(_saved.socialCoverage || ['barely_covered', 'lightly_covered', 'well_covered']),
      minAuthenticity: _saved.stateVersion >= STATE_VERSION && _saved.socialMinAuth != null ? _saved.socialMinAuth : 0,
      minZ: _saved.stateVersion >= STATE_VERSION && _saved.socialMinZ != null ? _saved.socialMinZ : 0,
      crossPlatformOnly: !!_saved.socialCrossPlatform
    },
    global: {
      timeHorizon: _saved.timeHorizon || '',
      minStrength: _saved.minStrength || 0,
      minConfidence: _saved.minConfidence || 0,
      includeInvalidated: !!_saved.includeInvalidated,
      includeSuppressed: !!_saved.includeSuppressed,
      sortMode: _saved.sortMode || 'priority'
    },
    dataSource: 'loading',
    apiError: null,
    liveTotal: 0
  };

  function persistState() {
    try {
      localStorage.setItem('mi_state', JSON.stringify({
        stateVersion: STATE_VERSION,
        engineView: STATE.engineView,
        macroStatus: STATE.macro.status,
        macroCoverage: Array.from(STATE.macro.coverageTiers),
        socialStatus: STATE.social.status,
        socialCoverage: Array.from(STATE.social.coverageTiers),
        socialMinAuth: STATE.social.minAuthenticity,
        socialMinZ: STATE.social.minZ,
        socialCrossPlatform: STATE.social.crossPlatformOnly,
        timeHorizon: STATE.global.timeHorizon,
        minStrength: STATE.global.minStrength,
        minConfidence: STATE.global.minConfidence,
        includeInvalidated: STATE.global.includeInvalidated,
        includeSuppressed: STATE.global.includeSuppressed,
        sortMode: STATE.global.sortMode
      }));
    } catch (e) { /* quota etc */ }
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------
  function esc(s) {
    if (s == null) return '';
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  var NON_TICKER_TOKENS = new Set([
    'API', 'CEO', 'CFO', 'CPU', 'CSV', 'CTO', 'ETF', 'FDA', 'GDP', 'IPO',
    'LLM', 'N/A', 'SEC', 'USA', 'USD', 'VERIFY_PRIMARY_SOURCES'
  ]);

  function scannerHref(symbol) {
    return '/scanner?symbol=' + encodeURIComponent(String(symbol || '').trim().toUpperCase());
  }

  function configureScannerLink(a, symbol) {
    var sym = String(symbol || '').trim().toUpperCase();
    a.href = scannerHref(sym);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = 'Open ' + sym + ' in Scanner';
    a.addEventListener('click', function (event) {
      event.stopPropagation();
    });
    return a;
  }

  function bindScannerLinkDelegation() {
    if (window.__miScannerLinksBound) return;
    window.__miScannerLinksBound = true;
    document.addEventListener('click', function (event) {
      var link = event.target && event.target.closest ? event.target.closest('a[href*="/scanner?symbol="]') : null;
      if (!link) return;
      event.preventDefault();
      event.stopPropagation();
      window.open(link.href, '_blank', 'noopener,noreferrer');
    });
  }

  function scannerLink(symbol, className, label) {
    var sym = String(symbol || '').trim().toUpperCase();
    var a = el('a', className || 'mi-scanner-symbol-link', label || sym);
    return configureScannerLink(a, sym);
  }

  function scannerLinkHtml(symbol, className, label) {
    var sym = String(symbol || '').trim().toUpperCase();
    if (!looksLikeTicker(sym)) return esc(label || symbol || '');
    return '<a href="' + esc(scannerHref(sym)) + '" class="' + esc(className || 'mi-scanner-symbol-link') + '" target="_blank" rel="noopener noreferrer" title="Open ' + esc(sym) + ' in Scanner">' + esc(label || sym) + '</a>';
  }

  function appendTickerLinks(target, symbols, className) {
    var list = Array.isArray(symbols) ? symbols : [];
    var added = 0;
    list.forEach(function (symbol) {
      var sym = String(symbol || '').trim().toUpperCase();
      if (!looksLikeTicker(sym)) return;
      if (added > 0) target.appendChild(document.createTextNode(', '));
      target.appendChild(scannerLink(sym, className || 'mi-scanner-symbol-link'));
      added += 1;
    });
    if (!added) target.textContent = '\u2014';
  }

  function normalizeTickerList(symbols) {
    return Array.from(new Set((Array.isArray(symbols) ? symbols : [])
      .map(function (s) { return String(s || '').trim().toUpperCase(); })
      .filter(looksLikeTicker)));
  }

  function symbolKnownOrFallback(symbol, extraSet) {
    var sym = String(symbol || '').replace(/^\$/, '').trim().toUpperCase();
    if (!looksLikeTicker(sym)) return false;
    if (extraSet && extraSet.has(sym)) return true;
    if (KNOWN_TICKER_SET.size) return KNOWN_TICKER_SET.has(sym);
    return true;
  }

  function linkTickerTokensHtml(text, symbols) {
    var raw = String(text || '');
    var extraSet = new Set(normalizeTickerList(symbols));
    var pattern = /\$?[A-Z][A-Z0-9.]{1,5}\b/g;
    var last = 0;
    var out = '';
    var match;
    while ((match = pattern.exec(raw)) !== null) {
      var token = match[0];
      var symbol = token.replace(/^\$/, '').toUpperCase();
      if (!symbolKnownOrFallback(symbol, extraSet)) continue;
      out += esc(raw.slice(last, match.index));
      out += scannerLinkHtml(symbol, 'mi-scanner-symbol-link', token);
      last = match.index + token.length;
    }
    out += esc(raw.slice(last));
    return out;
  }

  function linkKnownSymbolsHtml(text, symbols) {
    return linkTickerTokensHtml(text, symbols);
  }

  function linkKnownTickerUniverseHtml(text, extraSymbols) {
    return linkTickerTokensHtml(text, extraSymbols);
  }

  function linkCashtagsHtml(text) {
    var raw = String(text || '');
    var pattern = /\$([A-Z][A-Z0-9.]{1,5})\b/g;
    var last = 0;
    var out = '';
    var match;
    while ((match = pattern.exec(raw)) !== null) {
      var symbol = match[1].toUpperCase();
      if (!symbolKnownOrFallback(symbol)) continue;
      out += esc(raw.slice(last, match.index));
      out += scannerLinkHtml(symbol, 'mi-scanner-symbol-link', '$' + symbol);
      last = match.index + match[0].length;
    }
    out += esc(raw.slice(last));
    return out;
  }

  function looksLikeTicker(token) {
    var sym = String(token || '').replace(/^\$/, '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.]{1,5}$/.test(sym)) return false;
    if (NON_TICKER_TOKENS.has(sym)) return false;
    if (sym.indexOf('_') !== -1) return false;
    return true;
  }

  function appendLinkedTickerText(target, text) {
    var raw = String(text || '');
    var pattern = /\$?[A-Z][A-Z0-9.]{1,5}\b/g;
    var last = 0;
    var match;
    while ((match = pattern.exec(raw)) !== null) {
      var token = match[0];
      var symbol = token.replace(/^\$/, '').toUpperCase();
      if (!symbolKnownOrFallback(symbol)) continue;
      if (match.index > last) target.appendChild(document.createTextNode(raw.slice(last, match.index)));
      target.appendChild(scannerLink(symbol, 'mi-scanner-symbol-link', token));
      last = match.index + token.length;
    }
    if (last < raw.length) target.appendChild(document.createTextNode(raw.slice(last)));
  }

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function fmtAge(ts) {
    var s = Math.max(0, NOW - ts);
    if (s < 60)        return s + 's ago';
    if (s < 3600)      return Math.round(s / 60) + 'm ago';
    if (s < 86400)     return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  function fmtDateTime(ts) {
    if (!ts) return 'unknown date';
    return new Date(ts * 1000).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function isStale(scenario) {
    var sla = (scenario.engine === 'social_arbitrage' || scenario.detection_path === 'mixed_anomaly_led') ? 14400 : 28800;
    return (NOW - scenario.last_updated_at) > sla;
  }

  function engineLabel(s) {
    if (s.detection_path === 'mixed_news_led')    return 'Macro + Social Arb (news-led)';
    if (s.detection_path === 'mixed_anomaly_led') return 'Macro + Social Arb (anomaly-led)';
    if (s.engine === 'macro')                     return 'Macro Engine';
    return 'Social Arbitrage Engine';
  }

  function engineBadgeClass(s) {
    if (s.detection_path === 'mixed_news_led')    return 'mixed-news';
    if (s.detection_path === 'mixed_anomaly_led') return 'mixed-anomaly';
    if (s.engine === 'macro')                     return 'macro';
    return 'social';
  }

  function coverageChipClass(tier, engine) {
    if (engine === 'macro' && tier !== 'mega_covered') return 'macro-neutral';
    var map = {
      barely_covered:  'tier-barely',
      lightly_covered: 'tier-lightly',
      well_covered:    'tier-well',
      mega_covered:    'tier-mega',
      untradable:      'tier-untradable'
    };
    return map[tier] || 'tier-well';
  }

  var FLAG_META = {
    LOW_HISTORY:                     { severity: '',            tip: 'Less than 7 days of baseline data — z-scores may be unreliable' },
    ONE_SOURCE_ONLY:                 { severity: 'severity-bad', tip: 'All evidence comes from a single source — no corroboration' },
    LOW_PARTICIPATION:               { severity: 'severity-warn', tip: 'Comment/post volume is below the actionable threshold' },
    NO_MARKET_CONFIRMATION:          { severity: 'severity-bad', tip: 'No price movement confirms the thesis yet' },
    CONTRADICTORY_REACTION:          { severity: 'severity-bad', tip: 'Price moved opposite to the expected direction' },
    HIGH_MAINSTREAM_SATURATION:      { severity: 'severity-warn', tip: 'Theme has saturated tier-1 media — edge is likely gone' },
    EXPOSURE_MAP_WEAK:               { severity: 'severity-warn', tip: 'Fewer than 3 first-order exposure rows resolved' },
    LOW_UNIVERSE_MATCH:              { severity: 'severity-warn', tip: '< 5 candidates and top composite_rank < 50 — no clean trade' },
    NO_GOOD_EXPRESSION:              { severity: 'severity-warn', tip: 'Thesis is real but no candidate ranks above 50 — hard to express' },
    THESIS_REAL_EXECUTION_DELAYED:   { severity: 'severity-warn', tip: 'High attention but market hasn\'t repriced for 60+ days' },
    STALE:                           { severity: 'severity-warn', tip: 'No new evidence in the last 7 days' },
    CONVICTION_LAYER_UNRELIABLE:     { severity: 'severity-warn', tip: 'LLM conviction producer failed validation twice' },
    LLM_BUDGET_EXHAUSTED:            { severity: '',            tip: 'LLM call budget for this scenario has been reached' },
    LIKELY_INAUTHENTIC:              { severity: 'severity-bad', tip: 'Authenticity score < 0.5 — possible coordinated pump (Social Arb only)' },
    MEGA_COVERAGE_PENALTY:           { severity: 'severity-warn', tip: 'All top candidates are mega-covered — no edge for Social Arb' },
    AUTHENTICITY_BORDERLINE:         { severity: 'severity-warn', tip: 'Authenticity score 0.5–0.65 — proceed with caution' },
    OPERATOR_SEEDED:                 { severity: 'severity-warn', tip: 'Scenario was manually seeded by the operator; verify independently before action' },
    VERIFY_PRIMARY_SOURCES:          { severity: 'severity-warn', tip: 'Primary source verification is required before treating this as confirmed' },
    POLICY_RUMOR_RISK:               { severity: 'severity-warn', tip: 'Policy/regulatory claim may be rumor or interpretation until official text confirms it' },
    SINGLE_SOURCE_RISK:              { severity: 'severity-warn', tip: 'Narrative depends on one source class; needs independent corroboration' },
    OPERATOR_OVERRODE_AUTHENTICITY:  { severity: '',            tip: 'Operator manually overrode the authenticity score' },
    PRIVATE_ENTITY:                  { severity: 'severity-bad', tip: 'Primary entity is a private company — no direct ticker to trade. Candidates are indirect plays via theme.' },
    NO_PUBLIC_TICKER:                { severity: 'severity-bad', tip: 'No public ticker resolved for this concept — expression relies on theme-level proxies only' }
  };

  function flagSeverity(flag) {
    return (FLAG_META[flag] || {}).severity || '';
  }

  function flagTip(flag) {
    return (FLAG_META[flag] || {}).tip || flag;
  }

  // ----------------------------------------------------------
  // Filtering
  // ----------------------------------------------------------
  function passesGlobal(s) {
    if (STATE.global.timeHorizon && s.time_horizon !== STATE.global.timeHorizon) return false;
    if (s.signal_strength < STATE.global.minStrength) return false;
    if (s.confidence_score * 100 < STATE.global.minConfidence) return false;
    if (s.status === 'INVALIDATED' && !STATE.global.includeInvalidated) return false;
    if (s.validity_flags.indexOf('LIKELY_INAUTHENTIC') !== -1 && !STATE.global.includeSuppressed) return false;
    return true;
  }

  function passesMacroPanel(s) {
    if (s.engine !== 'macro' && s.detection_path !== 'mixed_news_led') return false;
    if (STATE.macro.status !== 'ALL' && s.status !== STATE.macro.status) return false;
    // Fresh narrative/macro rows can land before coverage-tier enrichment runs.
    // Do not hide those rows; otherwise the page appears stale even though the
    // API has new scenarios.
    if (s.coverage_tier && !STATE.macro.coverageTiers.has(s.coverage_tier)) return false;
    return true;
  }

  function collectTickerUniverse(payload) {
    var found = [];
    function visit(value) {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (value && typeof value === 'object') {
        if (value.symbol) found.push(value.symbol);
        Object.keys(value).forEach(function (key) { visit(value[key]); });
        return;
      }
      if (typeof value === 'string') found.push(value);
    }
    visit(payload);
    return normalizeTickerList(found);
  }

  function setKnownTickerUniverse(symbols) {
    KNOWN_TICKER_LIST = normalizeTickerList(symbols).sort(function (a, b) { return a.localeCompare(b); });
    KNOWN_TICKER_SET = new Set(KNOWN_TICKER_LIST);
  }

  async function loadKnownTickerUniverse() {
    try {
      var res = await fetch('/api/candidates/symbols', { cache: 'no-store' });
      var json = await res.json();
      if (!json || !json.success || !json.data) throw new Error(json && json.error || 'Failed to load symbol catalog');
      setKnownTickerUniverse(collectTickerUniverse(json.data));
      render();
    } catch (err) {
      console.warn('Market Intelligence could not load known ticker universe:', err && err.message || err);
    }
  }

  window.miScannerLinkHtml = scannerLinkHtml;
  window.miLinkKnownSymbolsHtml = linkKnownSymbolsHtml;
  window.miLinkKnownTickerUniverseHtml = linkKnownTickerUniverseHtml;

  function passesSocialPanel(s) {
    if (s.engine !== 'social_arbitrage' && s.detection_path !== 'mixed_anomaly_led') return false;
    if (STATE.social.status !== 'ALL' && s.status !== STATE.social.status) return false;
    if (s.coverage_tier && !STATE.social.coverageTiers.has(s.coverage_tier)) return false;
    if (s.authenticity_score != null && s.authenticity_score < STATE.social.minAuthenticity) return false;
    if (s.peak_z_score != null && s.peak_z_score < STATE.social.minZ) return false;
    if (STATE.social.crossPlatformOnly && !s.cross_platform_corroboration) return false;
    return true;
  }

  function passesMixed(s) {
    return s.detection_path === 'mixed_news_led' || s.detection_path === 'mixed_anomaly_led';
  }

  // ----------------------------------------------------------
  // Card render
  // ----------------------------------------------------------
  function renderCard(s, recencyRank) {
    var card = el('div', 'mi-card');
    if (isStale(s)) card.classList.add('stale');
    card.setAttribute('data-id', s.id);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    var top = el('div', 'mi-card-top');
    var engineBadge = el('span', 'mi-card-engine ' + engineBadgeClass(s), engineLabel(s));
    top.appendChild(engineBadge);
    var dateBadge = el('span', 'mi-card-date', fmtDateTime(s.last_updated_at));
    dateBadge.title = 'Updated ' + fmtDateTime(s.last_updated_at) + ' (' + fmtAge(s.last_updated_at) + ')';
    top.appendChild(dateBadge);
    if (s.coverage_tier) {
      var coverage = el('span', 'mi-card-coverage ' + coverageChipClass(s.coverage_tier, s.engine), s.coverage_tier.replace('_', ' '));
      coverage.title = 'coverage_tier: ' + s.coverage_tier;
      top.appendChild(coverage);
    }
    card.appendChild(top);

    if (s.detection_path === 'mixed_news_led' || s.detection_path === 'mixed_anomaly_led') {
      var ribbon = el('span', 'mi-card-ribbon', '\u21c6 cross-engine');
      ribbon.title = 'Both engines corroborate this scenario';
      card.appendChild(ribbon);
    }

    card.appendChild(el('div', 'mi-card-name', s.display_name));
    var cardSummary = el('div', 'mi-card-summary');
    appendLinkedTickerText(cardSummary, s.summary);
    card.appendChild(cardSummary);

    var meta = el('div', 'mi-card-meta');
    if (recencyRank) {
      meta.appendChild(el('span', null, 'date rank #' + recencyRank));
    }
    meta.appendChild(el('span', null, 'status:' + s.status));
    meta.appendChild(el('span', null, 'horizon:' + s.time_horizon));
    if (s.engine === 'social_arbitrage' || s.detection_path === 'mixed_anomaly_led') {
      if (s.peak_z_score != null) {
        meta.appendChild(el('span', null, 'z=' + s.peak_z_score.toFixed(1) + (s.cross_platform_corroboration ? ', cross-platform' : '')));
      }
      if (s.authenticity_score != null) {
        meta.appendChild(el('span', null, 'auth=' + s.authenticity_score.toFixed(2)));
      }
    } else {
      meta.appendChild(el('span', null, s.source_count + ' sources / ' + s.source_type_count + ' source_types'));
    }
    if (s.source_breadth_score != null) {
      var breadthChip = el('span', 'mi-card-breadth', 'breadth=' + s.source_breadth_score.toFixed(2));
      breadthChip.title = 'source_breadth_score: aggregate distinct-source coverage (0..1)';
      meta.appendChild(breadthChip);
    }
    meta.appendChild(el(
      'span',
      null,
      'updated ' + fmtDateTime(s.last_updated_at) + ' (' + fmtAge(s.last_updated_at) + ')' + (isStale(s) ? ' stale' : '')
    ));
    card.appendChild(meta);

    var bars = el('div', 'mi-card-bars');
    var barWrap = el('div', null);
    var bar = el('div', 'mi-strength-bar');
    var fill = el('div', 'mi-strength-bar-fill');
    fill.style.width = Math.max(0, Math.min(100, s.signal_strength)) + '%';
    bar.appendChild(fill);
    barWrap.appendChild(bar);
    barWrap.appendChild(el('div', 'mi-strength-label', 'signal_strength ' + s.signal_strength + ' / 100'));
    bars.appendChild(barWrap);
    bars.appendChild(el('span', 'mi-confidence-pill ' + s.confidence_level, s.confidence_level));
    card.appendChild(bars);

    if (s.validity_flags.length > 0) {
      var flagsWrap = el('div', 'mi-card-flags');
      s.validity_flags.forEach(function (f) {
        var chip = el('span', 'mi-flag-chip ' + flagSeverity(f), f);
        chip.title = flagTip(f);
        flagsWrap.appendChild(chip);
      });
      card.appendChild(flagsWrap);
    }

    if (s.top_universe_candidates && s.top_universe_candidates.length > 0) {
      var cw = el('div', 'mi-card-candidates');
      s.top_universe_candidates.slice(0, 3).forEach(function (c) {
        var row = el('div', 'mi-card-candidate-row');
        row.appendChild(scannerLink(c.symbol, 'mi-card-candidate-symbol mi-scanner-symbol-link'));
        row.appendChild(el('span', 'mi-card-candidate-meta', c.coverage_tier + ' / ' + c.exposure_direction));
        row.appendChild(el('span', 'mi-card-candidate-rank', 'rank ' + c.composite_rank.toFixed(1)));
        cw.appendChild(row);
      });
      card.appendChild(cw);
    }

    card.addEventListener('click', function () { openDrawer(s); });
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(s); }
    });
    return card;
  }

  // ----------------------------------------------------------
  // Drawer
  // ----------------------------------------------------------
  function appendScenarioReport(body, s) {
    var report = LIVE_REPORTS[s.id];
    var knownSymbols = (s.top_universe_candidates || []).map(function (c) { return c.symbol; });
    body.appendChild(el('div', 'mi-drawer-section-title', 'Intelligence brief'));
    if (!report) {
      body.appendChild(el('div', 'mi-panel-empty', 'Generating scenario intelligence brief...'));
      return;
    }
    if (report.loading) {
      body.appendChild(el('div', 'mi-panel-empty', 'Investigating scenario with evidence, exposure map, and Ledger candidate context...'));
      return;
    }
    if (report.error) {
      body.appendChild(el('div', 'mi-panel-empty', 'Report unavailable: ' + report.error));
      return;
    }

    var wrap = el('div', 'mi-conviction-block');
    var v = report.verdict || {};
    var top = el('div', 'mi-conviction-row');
    top.appendChild(el('div', 'mi-conviction-label', 'Verdict'));
    top.appendChild(el('div', 'mi-conviction-value', (v.risk_level || 'LOW') + ' - ' + (v.summary || 'No summary')));
    wrap.appendChild(top);

    String(report.narrative || '').split(/\n{2,}/).forEach(function (p) {
      var text = p.replace(/\*\*/g, '').trim();
      if (!text) return;
      var row = el('div', 'mi-conviction-row');
      var value = el('div', 'mi-conviction-value');
      value.innerHTML = linkKnownSymbolsHtml(text, knownSymbols);
      row.appendChild(value);
      wrap.appendChild(row);
    });
    if (Array.isArray(v.signals) && v.signals.length > 0) {
      var sig = el('div', 'mi-conviction-signals');
      sig.appendChild(el('div', 'mi-conviction-sub-label', 'Why it matters'));
      var ul = el('ul', 'mi-conviction-list confirming');
      v.signals.forEach(function (line) {
        var li = el('li');
        li.innerHTML = linkKnownSymbolsHtml(line, knownSymbols);
        ul.appendChild(li);
      });
      sig.appendChild(ul);
      wrap.appendChild(sig);
    }
    if (Array.isArray(report.candidate_fundamentals) && report.candidate_fundamentals.length > 0) {
      var bestBar = el('div', 'mi-conviction-best');
      bestBar.appendChild(el('span', 'mi-conviction-sub-label', 'Ledger checked: '));
      report.candidate_fundamentals.slice(0, 6).forEach(function (c) {
        var chip = scannerLink(c.symbol || '?', 'mi-conviction-ticker');
        chip.title = c.unavailable ? 'Fundamentals unavailable' : [
          c.valuation_state || 'valuation N/A',
          c.valuation_gap_pct != null ? 'gap ' + Number(c.valuation_gap_pct).toFixed(1) + '%' : null,
          c.quality_grade ? 'quality ' + c.quality_grade : null
        ].filter(Boolean).join(' | ');
        bestBar.appendChild(chip);
      });
      wrap.appendChild(bestBar);
    }
    var reportActions = el('div', 'mi-report-actions');
    var reportBtn = el('button', 'mi-operator-btn go', 'Generate report');
    reportBtn.type = 'button';
    reportBtn.title = 'Open a copyable Markdown report with evidence, ramifications, valuation checks, and exposure map';
    reportBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      openShareableReport(s, report);
    });
    reportActions.appendChild(reportBtn);
    wrap.appendChild(reportActions);
    body.appendChild(wrap);
  }

  function markdownTableRow(c) {
    return [
      c.symbol || 'N/A',
      c.exposure_direction || 'n/a',
      c.valuation_engine || 'n/a',
      c.current_price == null ? 'N/A' : c.current_price,
      c.fair_value == null ? 'N/A' : c.fair_value,
      c.valuation_gap_pct == null ? 'N/A' : Number(c.valuation_gap_pct).toFixed(1) + '%',
      c.valuation_state || 'N/A',
      c.composite_rank == null ? 'N/A' : Number(c.composite_rank).toFixed(1)
    ].join(' | ');
  }

  function buildShareableReportFallback(s, report) {
    var v = report.verdict || {};
    var scenario = report.scenario || {};
    var ca = report.consequence_analysis || {};
    var fundamentals = Array.isArray(report.valuation_fragility) && report.valuation_fragility.length
      ? report.valuation_fragility
      : (Array.isArray(report.candidate_fundamentals) ? report.candidate_fundamentals.filter(function (c) { return !c.unavailable; }) : []);
    var branches = []
      .concat(Array.isArray(ca.scenario_branches) ? ca.scenario_branches : [])
      .concat(Array.isArray(ca.dependency_chains) ? ca.dependency_chains : [])
      .concat(Array.isArray(ca.workflow_constraints) ? ca.workflow_constraints : [])
      .concat(Array.isArray(ca.second_order_effects) ? ca.second_order_effects : []);
    var evidence = Array.isArray(report.evidence_timeline) ? report.evidence_timeline.slice(0, 6) : [];
    var lines = [];
    lines.push('# ' + (scenario.title || s.display_name || 'Market Intelligence Report'));
    lines.push('');
    lines.push('## Bottom Line');
    lines.push((v.risk_level || 'WATCH') + ' - ' + (v.summary || 'Scenario requires review.'));
    lines.push('');
    lines.push('## Story Synopsis');
    lines.push((report.story_synopsis && report.story_synopsis.claim) || scenario.summary || s.summary || 'No synopsis available.');
    lines.push('');
    lines.push('## Signal And Evidence Quality');
    lines.push('Signal strength ' + (scenario.signal_strength || s.signal_strength || 'N/A') + '/100, confidence ' + Number(scenario.confidence_score || s.confidence_score || 0).toFixed(2) + ', evidence count ' + (scenario.evidence_count || s.source_count || 'N/A') + ', flags ' + ((scenario.validity_flags || s.validity_flags || []).join(', ') || 'none') + '.');
    if (evidence.length) {
      lines.push('');
      evidence.forEach(function (ev) {
        lines.push('- ' + (ev.source_name || ev.source || 'source') + ': ' + (ev.headline_or_label || ev.text || ev.summary || 'evidence'));
      });
    }
    lines.push('');
    lines.push('## Analyst Ramifications');
    lines.push(ca.core_thesis || (Array.isArray(s.confidence_reasons) ? s.confidence_reasons[0] : '') || 'No analyst consequence thesis was available.');
    branches.slice(0, 12).forEach(function (b) { lines.push('- ' + b); });
    lines.push('');
    lines.push('## Exposure And Valuation Fragility');
    lines.push('| Symbol | Direction | Valuation Engine | Price | Fair Value | Gap | State | Rank |');
    lines.push('|---|---|---|---:|---:|---:|---|---:|');
    if (fundamentals.length) {
      fundamentals.slice(0, 16).forEach(function (c) { lines.push('| ' + markdownTableRow(c) + ' |'); });
    } else {
      lines.push('| none | n/a | n/a | N/A | N/A | N/A | N/A | N/A |');
    }
    lines.push('');
    lines.push('## Market, Economic, And Geopolitical Ramifications');
    lines.push('Focus on whether the shock changes AI demand assumptions, index-heavy constituents, capital spending plans, workforce access, compliance burden, foreign retaliation risk, and valuation multiples for crowded beneficiaries.');
    lines.push('');
    lines.push('## What Confirms Or Invalidates It');
    (Array.isArray(ca.confirming_evidence) ? ca.confirming_evidence : []).slice(0, 4).forEach(function (x) { lines.push('- Confirming: ' + x); });
    (Array.isArray(ca.invalidating_evidence) ? ca.invalidating_evidence : []).slice(0, 4).forEach(function (x) { lines.push('- Invalidating: ' + x); });
    return lines.join('\n');
  }

  function openShareableReport(s, report) {
    var modal = document.getElementById('mi-report-modal');
    var backdrop = document.getElementById('mi-report-modal-backdrop');
    var textarea = document.getElementById('mi-report-textarea');
    var title = document.getElementById('mi-report-modal-title');
    var subtitle = document.getElementById('mi-report-modal-subtitle');
    if (!modal || !backdrop || !textarea) return;
    var text = report.shareable_report || report.narrative || buildShareableReportFallback(s, report);
    textarea.value = text;
    if (title) title.textContent = 'Shareable Report';
    if (subtitle) {
      subtitle.textContent = report.report_author === 'ai'
        ? 'AI-authored from deterministic scenario data, evidence, consequence analysis, valuation checks, and exposure map.'
        : 'Fallback report generated from deterministic scenario data because the AI report was unavailable.';
    }
    modal.setAttribute('data-report-slug', s.slug || String(s.id || 'scenario'));
    backdrop.classList.add('open');
    modal.classList.add('open');
    textarea.focus();
    textarea.setSelectionRange(0, 0);
  }

  function closeShareableReport() {
    var modal = document.getElementById('mi-report-modal');
    var backdrop = document.getElementById('mi-report-modal-backdrop');
    if (modal) modal.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
  }

  function copyShareableReport() {
    var textarea = document.getElementById('mi-report-textarea');
    if (!textarea) return;
    var text = textarea.value || '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {
        textarea.select();
        document.execCommand('copy');
      });
    } else {
      textarea.select();
      document.execCommand('copy');
    }
  }

  function downloadShareableReport() {
    var modal = document.getElementById('mi-report-modal');
    var textarea = document.getElementById('mi-report-textarea');
    if (!textarea) return;
    var slug = (modal && modal.getAttribute('data-report-slug')) || 'scenario-report';
    var blob = new Blob([textarea.value || ''], { type: 'text/markdown' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = slug + '-market-intelligence-report.md';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function openDrawer(s) {
    var bd = document.getElementById('mi-drawer-backdrop');
    var dr = document.getElementById('mi-drawer');
    // Kick off live-detail fetch on every open. If detail isn't cached
    // yet, the resolver re-invokes openDrawer(s) once the payload lands,
    // which re-renders the body in place. The first paint below uses
    // placeholders.
    loadDetailFromApi(s);
    loadScenarioReportFromApi(s);

    var engineRow = document.getElementById('mi-drawer-engine-row');
    engineRow.innerHTML = '';
    var badge = el('span', 'mi-card-engine ' + engineBadgeClass(s), engineLabel(s));
    engineRow.appendChild(badge);
    var coverage = el('span', 'mi-card-coverage ' + coverageChipClass(s.coverage_tier, s.engine), s.coverage_tier.replace('_', ' '));
    engineRow.appendChild(coverage);
    engineRow.appendChild(el('span', 'mi-confidence-pill ' + s.confidence_level, 'confidence ' + s.confidence_level));
    if (s.validity_flags.length > 0) {
      s.validity_flags.forEach(function (f) {
        var fchip = el('span', 'mi-flag-chip ' + flagSeverity(f), f);
        fchip.title = flagTip(f);
        engineRow.appendChild(fchip);
      });
    }

    document.getElementById('mi-drawer-name').textContent = s.display_name;
    var drawerSummary = document.getElementById('mi-drawer-summary');
    drawerSummary.innerHTML = '';
    appendLinkedTickerText(drawerSummary, s.summary);

    var body = document.getElementById('mi-drawer-body');
    body.innerHTML = '';

    var statsTitle = el('div', 'mi-drawer-section-title', 'Headline metrics');
    body.appendChild(statsTitle);
    var statsGrid = el('div', 'mi-drawer-grid-2');
    [
      ['scenario_score', s.scenario_score + ' / 100'],
      ['signal_strength', s.signal_strength + ' / 100'],
      ['confidence_score', s.confidence_score.toFixed(2)],
      ['detection_path', s.detection_path],
      ['primary_theme', s.primary_theme],
      ['source breadth', s.source_count + ' sources / ' + s.source_type_count + ' source_types']
    ].forEach(function (kv) {
      var stat = el('div', 'mi-stat');
      stat.appendChild(el('div', 'mi-stat-label', kv[0]));
      stat.appendChild(el('div', 'mi-stat-value', kv[1]));
      statsGrid.appendChild(stat);
    });
    body.appendChild(statsGrid);

    appendScenarioReport(body, s);

    var detail = DRAWER_DETAIL[s.id] || LIVE_DETAILS[s.id];

    if (detail && detail.confidence_reasons && detail.confidence_reasons.length > 0) {
      body.appendChild(el('div', 'mi-drawer-section-title', 'Analyst ramifications'));
      var reasons = el('div', 'mi-conviction-block');
      detail.confidence_reasons.slice(0, 6).forEach(function (reason) {
        var row = el('div', 'mi-conviction-row');
        var value = el('div', 'mi-conviction-value');
        appendLinkedTickerText(value, reason);
        row.appendChild(value);
        reasons.appendChild(row);
      });
      body.appendChild(reasons);
    }

    if (detail && detail.first_order_effects) {
      body.appendChild(el('div', 'mi-drawer-section-title', 'Consequence chain'));
      var chain = el('div', 'mi-consequence-chain');
      var fo = el('div', 'mi-consequence-row');
      fo.appendChild(el('div', 'mi-consequence-row-label', 'First-order effects'));
      detail.first_order_effects.forEach(function (e) { chain.appendChild(buildConsequenceChip(fo, e)); });
      var so = el('div', 'mi-consequence-row');
      so.appendChild(el('div', 'mi-consequence-row-label', 'Second-order effects'));
      detail.second_order_effects.forEach(function (e) { chain.appendChild(buildConsequenceChip(so, e)); });
      chain.appendChild(fo);
      chain.appendChild(so);
      body.appendChild(chain);
    }

    if (detail && detail.exposure_list && detail.exposure_list.length > 0) {
      body.appendChild(el('div', 'mi-drawer-section-title', 'Exposure map (' + detail.exposure_list.length + ' rows)'));
      var expTbl = el('table', 'mi-exposure-table');
      var expHead = el('thead');
      var expHr = el('tr');
      ['order', 'type', 'asset', 'direction', 'strength', 'method', 'conf', 'symbol'].forEach(function (h) { expHr.appendChild(el('th', null, h)); });
      expHead.appendChild(expHr); expTbl.appendChild(expHead);
      var expBody = el('tbody');
      detail.exposure_list.forEach(function (exp) {
        var tr = el('tr', 'exposure-row');
        tr.appendChild(el('td', 'exp-order', exp.exposure_order));
        tr.appendChild(el('td', 'exp-type', exp.asset_type));
        tr.appendChild(el('td', 'exp-key', exp.asset_key));
        var dirTd = el('td', 'exp-dir dir-' + (exp.exposure_direction || '').split('_')[0]);
        dirTd.textContent = (exp.exposure_direction || '').replace(/_/g, ' ');
        tr.appendChild(dirTd);
        tr.appendChild(el('td', 'exp-strength', (exp.exposure_strength || 0).toFixed(2)));
        var methodTd = el('td', 'exp-method method-' + (exp.source_method || 'derived'));
        methodTd.textContent = exp.source_method || 'derived';
        tr.appendChild(methodTd);
        tr.appendChild(el('td', 'exp-conf', (exp.confidence || 0).toFixed(2)));
        var symTd = el('td', 'exp-symbol');
        if (exp.universe_symbol) {
          var symLink = scannerLink(exp.universe_symbol, 'exp-symbol-link mi-scanner-symbol-link');
          symTd.appendChild(symLink);
        } else {
          symTd.textContent = '\u2014';
        }
        tr.appendChild(symTd);
        expBody.appendChild(tr);
      });
      expTbl.appendChild(expBody);
      body.appendChild(expTbl);
    }

    if (s.authenticity_score != null && (s.engine === 'social_arbitrage' || s.detection_path === 'mixed_anomaly_led')) {
      body.appendChild(el('div', 'mi-drawer-section-title', 'Authenticity Layer (D23) \u2014 score ' + s.authenticity_score.toFixed(2)));
      var auth = el('div', 'mi-authenticity-bar');
      var sigs = (detail && detail.authenticity_signals) || generatePlaceholderSignals(s.authenticity_score);
      sigs.forEach(function (sig) {
        var row = el('div', 'mi-auth-row');
        row.appendChild(el('div', 'mi-auth-row-label', sig.type));
        var trk = el('div', 'mi-auth-bar-track');
        var fill = el('div', 'mi-auth-bar-fill');
        fill.style.width = (sig.value * 100).toFixed(0) + '%';
        trk.appendChild(fill);
        row.appendChild(trk);
        row.appendChild(el('div', 'mi-auth-row-value', sig.value.toFixed(2) + ' \u00d7' + sig.weight.toFixed(2)));
        row.title = sig.notes || '';
        auth.appendChild(row);
      });
      body.appendChild(auth);
    }

    body.appendChild(el('div', 'mi-drawer-section-title', 'Evidence timeline'));
    if (detail && detail.evidence_timeline) {
      detail.evidence_timeline.forEach(function (ev) {
        var row = el('div', 'mi-evidence-row');
        row.appendChild(el('div', 'mi-evidence-time', fmtAge(ev.ts)));
        var evidenceText = el('div', 'mi-evidence-text');
        appendLinkedTickerText(evidenceText, ev.text);
        row.appendChild(evidenceText);
        var evidenceSource = el('div', 'mi-evidence-source');
        appendLinkedTickerText(evidenceSource, ev.source);
        row.appendChild(evidenceSource);
        body.appendChild(row);
      });
    } else {
      body.appendChild(el('div', 'mi-panel-empty', 'Evidence timeline not yet wired in this mock. Phase 1 fetches GET /scenarios/' + s.slug + '/evidence.'));
    }

    if (detail && detail.conviction_layer) {
      body.appendChild(el('div', 'mi-drawer-section-title', 'Conviction layer'));
      var cv = detail.conviction_layer;
      var cvBlock = el('div', 'mi-conviction-block');
      var thesisRow = el('div', 'mi-conviction-row');
      thesisRow.appendChild(el('div', 'mi-conviction-label', 'Thesis'));
      var thesisValue = el('div', 'mi-conviction-value');
      appendLinkedTickerText(thesisValue, cv.thesis_summary || '\u2014');
      thesisRow.appendChild(thesisValue);
      cvBlock.appendChild(thesisRow);
      var whyRow = el('div', 'mi-conviction-row');
      whyRow.appendChild(el('div', 'mi-conviction-label', 'Why now'));
      var whyValue = el('div', 'mi-conviction-value');
      appendLinkedTickerText(whyValue, cv.why_now || '\u2014');
      whyRow.appendChild(whyValue);
      cvBlock.appendChild(whyRow);
      var breaksRow = el('div', 'mi-conviction-row');
      breaksRow.appendChild(el('div', 'mi-conviction-label', 'What breaks it'));
      var breaksValue = el('div', 'mi-conviction-value');
      appendLinkedTickerText(breaksValue, cv.what_breaks_it || '\u2014');
      breaksRow.appendChild(breaksValue);
      cvBlock.appendChild(breaksRow);
      var exprRow = el('div', 'mi-conviction-row');
      exprRow.appendChild(el('div', 'mi-conviction-label', 'Expression notes'));
      var exprValue = el('div', 'mi-conviction-value');
      appendLinkedTickerText(exprValue, cv.expression_notes || '\u2014');
      exprRow.appendChild(exprValue);
      cvBlock.appendChild(exprRow);
      body.appendChild(cvBlock);

      if (cv.confirming_signals && cv.confirming_signals.length > 0) {
        var confSig = el('div', 'mi-conviction-signals');
        confSig.appendChild(el('div', 'mi-conviction-sub-label', 'Confirming signals'));
        var confList = el('ul', 'mi-conviction-list confirming');
        cv.confirming_signals.forEach(function (sig) {
          var li = el('li');
          appendLinkedTickerText(li, sig);
          confList.appendChild(li);
        });
        confSig.appendChild(confList);
        body.appendChild(confSig);
      }
      if (cv.invalidating_signals && cv.invalidating_signals.length > 0) {
        var invSig = el('div', 'mi-conviction-signals');
        invSig.appendChild(el('div', 'mi-conviction-sub-label', 'Invalidating signals'));
        var invList = el('ul', 'mi-conviction-list invalidating');
        cv.invalidating_signals.forEach(function (sig) {
          var li = el('li');
          appendLinkedTickerText(li, sig);
          invList.appendChild(li);
        });
        invSig.appendChild(invList);
        body.appendChild(invSig);
      }
      if (cv.key_risks && cv.key_risks.length > 0) {
        var riskSig = el('div', 'mi-conviction-signals');
        riskSig.appendChild(el('div', 'mi-conviction-sub-label', 'Key risks'));
        var riskList = el('ul', 'mi-conviction-list risks');
        cv.key_risks.forEach(function (sig) {
          var li = el('li');
          appendLinkedTickerText(li, sig);
          riskList.appendChild(li);
        });
        riskSig.appendChild(riskList);
        body.appendChild(riskSig);
      }
      if (cv.best_expression_assets && cv.best_expression_assets.length > 0) {
        var bestBar = el('div', 'mi-conviction-best');
        bestBar.appendChild(el('span', 'mi-conviction-sub-label', 'Best expressions: '));
        cv.best_expression_assets.forEach(function (t) {
          var link = scannerLink(t, 'mi-conviction-ticker');
          bestBar.appendChild(link);
        });
        body.appendChild(bestBar);
      }
      if (cv.generated_at) {
        body.appendChild(el('div', 'mi-conviction-meta', 'Generated ' + new Date(cv.generated_at * 1000).toLocaleDateString() + ' \u00b7 ' + (cv.prompt_template_version || 'v1')));
      }
    }

    var candHeader = el('div', 'mi-candidates-header');
    candHeader.appendChild(el('div', 'mi-drawer-section-title', 'Top universe candidates'));
    if (s.top_universe_candidates && s.top_universe_candidates.length > 0) {
      var exportBtn = el('button', 'mi-export-btn', 'Export CSV');
      exportBtn.addEventListener('click', function () {
        var rows = [['symbol', 'coverage_tier', 'direction', 'composite_rank']];
        s.top_universe_candidates.forEach(function (c) {
          rows.push([c.symbol, c.coverage_tier, c.exposure_direction, c.composite_rank.toFixed(1)]);
        });
        var csv = rows.map(function (r) { return r.join(','); }).join('\n');
        var blob = new Blob([csv], { type: 'text/csv' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (s.slug || s.id) + '-candidates.csv';
        a.click();
        URL.revokeObjectURL(a.href);
      });
      candHeader.appendChild(exportBtn);
    }
    body.appendChild(candHeader);

    if (s.top_universe_candidates && s.top_universe_candidates.length > 0) {
      var candSort = { col: 'composite_rank', asc: false };
      var candData = s.top_universe_candidates.slice();

      var tbl = el('table', 'mi-candidates-table');
      var thead = el('thead');
      var hr = el('tr');

      var colDefs = [
        { key: 'symbol',             label: 'symbol' },
        { key: 'coverage_tier',      label: 'coverage' },
        { key: 'exposure_direction', label: 'direction' },
        { key: 'composite_rank',     label: 'rank' },
        { key: null,                 label: '' }
      ];

      function renderCandBody() {
        var oldBody = tbl.querySelector('tbody');
        if (oldBody) tbl.removeChild(oldBody);
        var tb = el('tbody');
        candData.forEach(function (c) {
          var tr = el('tr', 'candidate-row');
          var symTd = el('td', null);
          var symLink = scannerLink(c.symbol, 'mi-open-scanner-link mi-scanner-symbol-link');
          symTd.appendChild(symLink);
          tr.appendChild(symTd);
          tr.appendChild(el('td', null, c.coverage_tier));
          tr.appendChild(el('td', null, c.exposure_direction));
          tr.appendChild(el('td', null, c.composite_rank.toFixed(1)));
          var actionTd = el('td', null);
          var openLink = scannerLink(c.symbol, 'mi-open-scanner-link', 'Scanner');
          actionTd.appendChild(openLink);
          tr.appendChild(actionTd);
          tb.appendChild(tr);
        });
        tbl.appendChild(tb);
      }

      colDefs.forEach(function (col) {
        var th = el('th', col.key ? 'mi-sortable-th' : null, col.label);
        if (col.key) {
          th.dataset.sortKey = col.key;
          if (candSort.col === col.key) th.classList.add(candSort.asc ? 'sort-asc' : 'sort-desc');
          th.addEventListener('click', function () {
            if (candSort.col === col.key) { candSort.asc = !candSort.asc; }
            else { candSort.col = col.key; candSort.asc = col.key === 'composite_rank' ? false : true; }
            candData.sort(function (a, b) {
              var va = a[col.key], vb = b[col.key];
              if (typeof va === 'number' && typeof vb === 'number') return candSort.asc ? va - vb : vb - va;
              va = String(va || ''); vb = String(vb || '');
              return candSort.asc ? va.localeCompare(vb) : vb.localeCompare(va);
            });
            hr.querySelectorAll('th').forEach(function (h) { h.classList.remove('sort-asc', 'sort-desc'); });
            th.classList.add(candSort.asc ? 'sort-asc' : 'sort-desc');
            renderCandBody();
          });
        }
        hr.appendChild(th);
      });

      thead.appendChild(hr); tbl.appendChild(thead);
      renderCandBody();
      body.appendChild(tbl);
    } else {
      body.appendChild(el('div', 'mi-panel-empty', 'No tradable candidates (suppressed or untradable).'));
    }

    bd.classList.add('open');
    dr.classList.add('open');
  }

  function buildConsequenceChip(parentRow, effect) {
    var direction = effect.direction || effect.exposure_direction || 'neutral';
    var labelType = effect.asset_type || effect.type || 'sector';
    var labelKey = effect.asset_key || effect.key || effect.asset_or_sector || effect.label || 'unknown';
    var magnitude = effect.magnitude || effect.magnitude_hint || 'moderate';
    var chip = el('span', 'mi-consequence-chip dir-' + direction);
    if (effect.source_method === 'llm_assist') chip.classList.add('llm-assist');
    chip.textContent = labelType + ':' + labelKey + ' (' + magnitude + ')';
    parentRow.appendChild(chip);
    return parentRow;
  }

  function generatePlaceholderSignals(score) {
    var types = [
      'account_age_distribution','posting_cadence','account_history_diversity',
      'cross_platform_signature','comment_depth','sentiment_shape',
      'account_quality','mod_flag_rate','linguistic_similarity','promoter_co_occurrence'
    ];
    return types.map(function (t, i) {
      return { type: t, value: Math.max(0, Math.min(1, score + (Math.sin(i) * 0.15))), weight: 0.10, notes: '(placeholder)' };
    });
  }

  function closeDrawer() {
    document.getElementById('mi-drawer-backdrop').classList.remove('open');
    document.getElementById('mi-drawer').classList.remove('open');
  }

  // ----------------------------------------------------------
  // API integration  (Phase 1.4 — wires the live read-path)
  //
  // The API shape (ApiScenarioListItem in
  // backend/src/types/marketIntelligence.ts) differs slightly from the
  // mock card shape: title vs display_name, no engine column, etc. The
  // adapter normalizes API rows into the shape the existing render code
  // already understands.
  // ----------------------------------------------------------
  var API_BASE = '/api/market-intelligence';
  var eigenAutoPrecompileState = {
    inFlight: false,
    key: ''
  };

  function deriveEngine(detectionPath) {
    if (detectionPath === 'topic_anomaly' || detectionPath === 'mixed_anomaly_led') return 'social_arbitrage';
    return 'macro';
  }

  function apiToCard(api) {
    return {
      id: api.id,
      slug: api.slug || ('scenario-' + api.id),
      engine: deriveEngine(api.detection_path),
      detection_path: api.detection_path,
      scenario_type: api.scenario_type,
      primary_theme: api.primary_theme,
      display_name: api.title,
      summary: api.summary || '',
      status: api.status,
      time_horizon: api.time_horizon,
      signal_strength: Number(api.signal_strength) || 0,
      confidence_score: Number(api.confidence_score) || 0,
      confidence_level: api.confidence_level || 'low',
      scenario_score: Number(api.scenario_score) || 0,
      coverage_tier: api.coverage_tier || 'lightly_covered',
      authenticity_score: api.authenticity_score == null ? null : Number(api.authenticity_score),
      peak_z_score: api.peak_z_score == null ? null : Number(api.peak_z_score),
      cross_platform_corroboration: !!api.cross_platform_corroboration,
      source_breadth_score: api.source_breadth_score == null ? null : Number(api.source_breadth_score),
      source_count: Number(api.evidence_count) || 0,
      source_type_count: 0,
      validity_flags: Array.isArray(api.validity_flags) ? api.validity_flags : [],
      last_updated_at: Number(api.last_updated_at) || 0,
      expires_at: api.expires_at == null ? null : Number(api.expires_at),
      top_universe_candidates: Array.isArray(api.top_universe_candidates) ? api.top_universe_candidates : []
    };
  }

  function apiToDetail(detail) {
    var firstOrder = Array.isArray(detail.first_order_effects) ? detail.first_order_effects.map(function (e) {
      return {
        asset_type: e.asset_type || e.type || (e.asset_or_sector ? 'sector' : undefined),
        asset_key: e.asset_key || e.key || e.asset_or_sector || e.label,
        direction: e.exposure_direction || e.direction || 'neutral',
        magnitude: e.magnitude || e.magnitude_hint || 'moderate',
        source_method: e.source_method || 'derived'
      };
    }) : [];
    var secondOrder = Array.isArray(detail.second_order_effects) ? detail.second_order_effects.map(function (e) {
      return {
        asset_type: e.asset_type || e.type || (e.asset_or_sector ? 'sector' : undefined),
        asset_key: e.asset_key || e.key || e.asset_or_sector || e.label,
        direction: e.exposure_direction || e.direction || 'neutral',
        magnitude: e.magnitude || e.magnitude_hint || 'moderate',
        source_method: e.source_method || 'derived'
      };
    }) : [];
    var evidenceTimeline = Array.isArray(detail.evidence_timeline) ? detail.evidence_timeline.map(function (ev) {
      return {
        ts: Number(ev.published_at) || 0,
        source: ev.source_name || ev.evidence_type || '(source unknown)',
        text: ev.headline_or_label + (ev.summary ? ' — ' + ev.summary : '')
      };
    }) : [];
    var exposureList = Array.isArray(detail.exposure_list) ? detail.exposure_list : [];
    return {
      first_order_effects: firstOrder,
      second_order_effects: secondOrder,
      authenticity_signals: null,
      confidence_reasons: Array.isArray(detail.confidence_reasons) ? detail.confidence_reasons : [],
      evidence_timeline: evidenceTimeline,
      exposure_list: exposureList,
      candidates: Array.isArray(detail.top_universe_candidates) ? detail.top_universe_candidates : []
    };
  }

  // Data-source pill labels (visible). Tooltips hover-state.
  var DATA_SOURCE_LABELS = {
    'loading':       { label: 'loading',       title: 'Fetching scenarios from the API…' },
    'live':          { label: 'live',          title: 'Connected to /api/market-intelligence — showing real DB rows.' },
    'live-empty':    { label: 'live · empty',  title: 'API healthy but the DB has no scenarios. Run scripts/seed_dev_scenarios.py or wait for collectors.' },
    'error':         { label: 'error',         title: 'API unavailable; no sample scenarios are shown.' }
  };

  // setDataSource updates the data-source pill + the timestamp. Detail is
  // optional and rendered as a small inline-faded suffix inside the pill.
  function setDataSource(state, detail) {
    var pill = document.getElementById('mi-data-source-pill');
    var ts = document.getElementById('mi-last-updated');
    var preset = DATA_SOURCE_LABELS[state] || { label: state, title: '' };
    if (pill) {
      pill.setAttribute('data-state', state);
      pill.textContent = '';
      pill.appendChild(document.createTextNode(preset.label));
      if (detail) {
        var span = document.createElement('span');
        span.className = 'mi-data-source-detail';
        span.textContent = '· ' + detail;
        pill.appendChild(span);
      }
      var fullTitle = preset.title + (detail ? '  (' + detail + ')' : '');
      pill.title = fullTitle;
    }
    if (ts && state !== 'loading') {
      ts.textContent = new Date().toLocaleTimeString();
    }
  }

  function loadFromApi() {
    setDataSource('loading');
    return fetch(API_BASE + '/scenarios?limit=200&min_evidence=0', { headers: { 'Accept': 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (payload) {
        if (!payload || payload.success !== true) {
          throw new Error((payload && payload.error) || 'Malformed API response');
        }
        var items = (payload.data && Array.isArray(payload.data.items)) ? payload.data.items : [];
        STATE.liveTotal = (payload.data && Number(payload.data.total)) || 0;
        STATE.apiError = null;
        if (items.length === 0) {
          // Live API works but DB is empty. Stay on the page with no
          // cards rendered; the per-panel "no scenarios match" message
          // already covers the empty state.
          SCENARIOS = [];
          STATE.dataSource = 'live-empty';
          render();
          setDataSource('live-empty', '0 scenarios');
          return { source: 'live-empty', total: 0 };
        }
        SCENARIOS = items.map(apiToCard);
        STATE.dataSource = 'live';
        render();
        setDataSource('live', SCENARIOS.length + ' scenarios');
        return { source: 'live', total: SCENARIOS.length };
      })
      .catch(function (err) {
        STATE.apiError = err && err.message ? err.message : String(err);
        STATE.dataSource = 'error';
        SCENARIOS = [];
        render();
        setDataSource('error', STATE.apiError);
        // Surface to the console so devs notice during local work.
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[market-intelligence] API load failed; sample data is disabled:', err);
        }
        return { source: 'error', total: SCENARIOS.length, error: STATE.apiError };
      });
  }

  function loadDetailFromApi(s) {
    if (DRAWER_DETAIL[s.id] || LIVE_DETAILS[s.id]) return Promise.resolve();
    if (STATE.dataSource !== 'live') return Promise.resolve();
    var idOrSlug = encodeURIComponent(s.slug || String(s.id));
    return fetch(API_BASE + '/scenarios/' + idOrSlug, { headers: { 'Accept': 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (payload) {
        if (payload && payload.success && payload.data) {
          LIVE_DETAILS[s.id] = apiToDetail(payload.data);
          // Re-render the drawer with the freshly loaded detail.
          openDrawer(s);
        }
      })
      .catch(function (err) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[market-intelligence] detail load failed for ' + s.id + ':', err);
        }
      });
  }

  function loadScenarioReportFromApi(s) {
    if (LIVE_REPORTS[s.id]) return Promise.resolve();
    if (STATE.dataSource !== 'live') return Promise.resolve();
    LIVE_REPORTS[s.id] = { loading: true };
    var idOrSlug = encodeURIComponent(s.slug || String(s.id));
    return fetch(API_BASE + '/scenarios/' + idOrSlug + '/report', { headers: { 'Accept': 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (payload) {
        if (payload && payload.success && payload.data) {
          LIVE_REPORTS[s.id] = payload.data;
        } else {
          LIVE_REPORTS[s.id] = { error: (payload && payload.error) || 'Report unavailable' };
        }
        openDrawer(s);
      })
      .catch(function (err) {
        LIVE_REPORTS[s.id] = { error: err && err.message ? err.message : String(err) };
        openDrawer(s);
      });
  }

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------
  function render() {
    persistState();
    var visibleGlobal = SCENARIOS.filter(passesGlobal);

    var macroVisible  = visibleGlobal.filter(passesMacroPanel);
    var socialVisible = visibleGlobal.filter(passesSocialPanel);
    var mixedVisible  = visibleGlobal.filter(passesMixed);

    document.getElementById('mi-count-both').textContent   = visibleGlobal.length;
    document.getElementById('mi-count-macro').textContent  = visibleGlobal.filter(function (s) { return s.engine === 'macro' || s.detection_path === 'mixed_news_led'; }).length;
    document.getElementById('mi-count-social').textContent = visibleGlobal.filter(function (s) { return s.engine === 'social_arbitrage' || s.detection_path === 'mixed_anomaly_led'; }).length;
    document.getElementById('mi-count-mixed').textContent  = mixedVisible.length;

    updateStatusCounts('macro',  visibleGlobal.filter(function (s) { return s.engine === 'macro' || s.detection_path === 'mixed_news_led'; }));
    updateStatusCounts('social', visibleGlobal.filter(function (s) { return s.engine === 'social_arbitrage' || s.detection_path === 'mixed_anomaly_led'; }));

    var panelsEl = document.getElementById('mi-panels');
    panelsEl.classList.remove('macro-only', 'social-only', 'mixed-only');
    if (STATE.engineView === 'macro')  panelsEl.classList.add('macro-only');
    if (STATE.engineView === 'social') panelsEl.classList.add('social-only');
    if (STATE.engineView === 'mixed')  panelsEl.classList.add('mixed-only');

    var macroBody = document.getElementById('mi-macro-body');
    var socialBody = document.getElementById('mi-social-body');
    macroBody.innerHTML = '';
    socialBody.innerHTML = '';

    var macroToShow = macroVisible;
    var socialToShow = socialVisible;
    if (STATE.engineView === 'mixed') {
      macroToShow = macroVisible.filter(function (s) { return s.detection_path === 'mixed_news_led'; });
      socialToShow = socialVisible.filter(function (s) { return s.detection_path === 'mixed_anomaly_led'; });
    }

    macroToShow.sort(scenarioSort).forEach(function (s, i) { macroBody.appendChild(renderCard(s, i + 1)); });
    socialToShow.sort(scenarioSort).forEach(function (s, i) { socialBody.appendChild(renderCard(s, i + 1)); });

    if (macroToShow.length === 0)  macroBody.appendChild(el('div', 'mi-panel-empty', emptyPanelMessage()));
    if (socialToShow.length === 0) socialBody.appendChild(el('div', 'mi-panel-empty', emptyPanelMessage()));

    renderSummary(visibleGlobal);

    document.getElementById('mi-last-updated').textContent = new Date().toLocaleTimeString();
  }

  function scenarioSort(a, b) {
    if (STATE.global.sortMode === 'newest') {
      return (b.last_updated_at - a.last_updated_at)
        || (Number(b.scenario_score || b.signal_strength || 0) - Number(a.scenario_score || a.signal_strength || 0))
        || (Number(b.confidence_score || 0) - Number(a.confidence_score || 0));
    }
    var scoreA = Number(a.scenario_score || a.signal_strength || 0);
    var scoreB = Number(b.scenario_score || b.signal_strength || 0);
    var signalA = Number(a.signal_strength || 0);
    var signalB = Number(b.signal_strength || 0);
    var confA = Number(a.confidence_score || 0);
    var confB = Number(b.confidence_score || 0);
    return (scoreB - scoreA)
      || (signalB - signalA)
      || (confB - confA)
      || (b.last_updated_at - a.last_updated_at);
  }

  function emptyPanelMessage() {
    if (STATE.dataSource === 'loading') return 'Loading live scenarios...';
    if (STATE.dataSource === 'error') return 'Live Market Intelligence failed to load. Refresh to try again.';
    if (STATE.dataSource === 'live-empty') return 'Live API is healthy, but there are no scenarios yet.';
    return 'No scenarios match the current filters.';
  }

  function updateStatusCounts(engineKey, list) {
    var states = ['ALL', 'EARLY', 'DEVELOPING', 'CONFIRMED', 'CROWDED', 'FADING'];
    states.forEach(function (st) {
      var n = (st === 'ALL') ? list.length : list.filter(function (s) { return s.status === st; }).length;
      var elt = document.getElementById('mi-' + engineKey + '-count-' + st);
      if (elt) elt.textContent = n;
    });
  }

  function renderSummary(visible) {
    var summary = document.getElementById('mi-summary');
    summary.innerHTML = '';

    var topMacro = visible.filter(function (s) { return (s.engine === 'macro' || s.detection_path === 'mixed_news_led') && (s.status === 'EARLY' || s.status === 'DEVELOPING'); }).sort(scenarioSort)[0];
    var topSocial = visible.filter(function (s) {
      var earlySocial = (s.engine === 'social_arbitrage' || s.detection_path === 'mixed_anomaly_led') && s.status === 'EARLY';
      var undercoveredOrPending = !s.coverage_tier || s.coverage_tier === 'barely_covered' || s.coverage_tier === 'lightly_covered';
      return earlySocial && undercoveredOrPending && (s.authenticity_score || 0) >= 0.65;
    }).sort(scenarioSort)[0];

    summary.appendChild(buildHeadlineTile('engine-macro', 'Top Macro headline', topMacro));
    summary.appendChild(buildHeadlineTile('engine-social', 'Top Social Arb headline', topSocial));

    summary.appendChild(buildCountTile('engine-macro', 'Macro EARLY / DEV / CROWDED', counts(visible, ['EARLY', 'DEVELOPING', 'CROWDED'], function (s) { return s.engine === 'macro'; })));
    summary.appendChild(buildCountTile('engine-social', 'Social Arb EARLY / DEV', counts(visible, ['EARLY', 'DEVELOPING'], function (s) { return s.engine === 'social_arbitrage'; }), '+ ' + SCENARIOS.filter(function (s) { return s.validity_flags.indexOf('LIKELY_INAUTHENTIC') !== -1; }).length + ' suppressed (24h)'));
    summary.appendChild(buildCountTile('engine-social', 'Live anomalies (24h)', '7', 'peak_z_score \u2265 3.0, auth \u2265 0.5'));
    summary.appendChild(buildCountTile('engine-mixed', 'Cross-engine corroborations (7d)', String(visible.filter(function (s) { return s.detection_path === 'mixed_news_led' || s.detection_path === 'mixed_anomaly_led'; }).length), 'Highest-confidence rows on the page'));
    summary.appendChild(buildCountTile('', 'Recently invalidated (7d)', '0', 'No scenarios invalidated in the last week'));
    summary.appendChild(buildCountTile('', 'Index freshness', '<5 min', 'Macro: 4m \u00b7 Social: 2m \u00b7 Coverage tiers: 6d'));
  }

  function counts(visible, states, pred) {
    return states.map(function (st) {
      return st[0] + ':' + visible.filter(function (s) { return pred(s) && s.status === st; }).length;
    }).join('  ');
  }

  function buildHeadlineTile(extraClass, label, scenario) {
    var t = el('div', 'mi-summary-tile mi-summary-headline ' + extraClass);
    t.appendChild(el('div', 'mi-summary-tile-label', label));
    if (!scenario) {
      t.appendChild(el('div', 'mi-summary-tile-detail', 'No qualifying scenario in current view.'));
      return t;
    }
    t.appendChild(el('div', 'mi-summary-headline-name', scenario.display_name));
    var tickers = (scenario.top_universe_candidates || []).slice(0, 3).map(function (c) { return c.symbol; });
    var row = el('div', 'mi-summary-headline-row');
    var tickerCell = el('span', 'mi-summary-headline-tickers');
    if (tickers.length) {
      tickers.forEach(function (symbol, index) {
        if (index > 0) tickerCell.appendChild(document.createTextNode('  '));
        tickerCell.appendChild(scannerLink(symbol, 'mi-scanner-symbol-link'));
      });
    } else {
      tickerCell.textContent = '(no candidates)';
    }
    row.appendChild(tickerCell);
    row.appendChild(el('span', 'mi-summary-headline-score', String(scenario.scenario_score)));
    t.appendChild(row);
    t.style.cursor = 'pointer';
    t.addEventListener('click', function () { openDrawer(scenario); });
    return t;
  }

  function buildCountTile(extraClass, label, value, detail) {
    var t = el('div', 'mi-summary-tile ' + extraClass);
    t.appendChild(el('div', 'mi-summary-tile-label', label));
    t.appendChild(el('div', 'mi-summary-tile-value', value));
    if (detail) t.appendChild(el('div', 'mi-summary-tile-detail', detail));
    return t;
  }

  // ----------------------------------------------------------
  // Social Arbitrage Engine controls (prune / merge / promote)
  // ----------------------------------------------------------
  // PRD §Operator UI. Three responsibilities:
  //   1. List tracked_concepts with 28d-hit rollup, allow status update.
  //   2. List emerging_topics, allow operator-driven force-promote.
  //   3. Surface backend response in a small toast strip (success/error).
  // The section is collapsed by default to keep the dual-panel page clean;
  // expanding it lazily fires the two list calls.
  // ----------------------------------------------------------
  var OPERATOR_LOADED = false;
  var EIGEN_LOADED = false;
  var CONVERGENCE_LOADED = false;
  var CONVERGENCE_STATE = { tier: 0, tag: 'all', search: '' };
  var LAST_CONV_DATA = null;

  function rowHasFade(row) { return !!(row && row.overlays && row.overlays.fade); }
  function rowHasBottom(row) { return !!(row && row.overlays && row.overlays.contrarian); }
  function rowMatchesTag(row, tag) {
    if (tag === 'fade') return rowHasFade(row);
    if (tag === 'bottom') return rowHasBottom(row);
    if (tag === 'either') return rowHasFade(row) || rowHasBottom(row);
    return true;
  }
  var CONVERGENCE_THESES = {};
  var THESIS_POLLS = 0;
  var EVENT_RISK_ALERTS = [];
  var SOCIAL_THESIS_ALERTS = [];
  var OPERATOR_STATE = {
    tracked: { items: [], total: 0, status: 'active', target_type: '', search: '' },
    emerging: { items: [], filter: 'unpromoted' }
  };

  function showOperatorToast(elId, message, isError) {
    var t = document.getElementById(elId);
    if (!t) return;
    t.hidden = false;
    t.textContent = message;
    t.classList.toggle('error', !!isError);
    setTimeout(function () { t.hidden = true; }, 8000);
  }

  function fetchTrackedConcepts() {
    var s = OPERATOR_STATE.tracked;
    var qs = '?limit=200&status=' + encodeURIComponent(s.status);
    if (s.target_type) qs += '&target_type=' + encodeURIComponent(s.target_type);
    if (s.search) qs += '&search=' + encodeURIComponent(s.search);
    return fetch(API_BASE + '/tracked-concepts' + qs, {
      headers: { 'Accept': 'application/json' }
    })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        if (!payload || payload.success !== true) {
          throw new Error((payload && payload.error) || 'Malformed tracked-concepts response');
        }
        s.items = payload.data.items || [];
        s.total = payload.data.total || 0;
        renderTrackedTable();
        updateOperatorSummary();
      })
      .catch(function (err) {
        showOperatorToast('mi-tracked-toast', 'Load failed: ' + err.message, true);
      });
  }

  function fetchEmergingTopicsForOperator() {
    var s = OPERATOR_STATE.emerging;
    var qs = '?limit=100';
    if (s.filter === 'all') qs += '&include_suppressed=true';
    return fetch(API_BASE + '/emerging-topics' + qs, {
      headers: { 'Accept': 'application/json' }
    })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        if (!payload || payload.success !== true) {
          throw new Error((payload && payload.error) || 'Malformed emerging-topics response');
        }
        var items = (payload.data && payload.data.items) || [];
        if (s.filter === 'unpromoted') {
          items = items.filter(function (it) { return !it.seeded_situation_id; });
        }
        s.items = items;
        renderEmergingTable();
        updateOperatorSummary();
      })
      .catch(function (err) {
        showOperatorToast('mi-emerging-toast', 'Load failed: ' + err.message, true);
      });
  }

  function fetchSocialArbAudit() {
    return fetch(API_BASE + '/social-arb/audit?days=7', {
      headers: { 'Accept': 'application/json' }
    })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        if (!payload || payload.success !== true) {
          throw new Error((payload && payload.error) || 'Malformed social-arb audit response');
        }
        renderSocialArbAudit(payload.data || {});
      })
      .catch(function (err) {
        showOperatorToast('mi-social-audit-toast', 'Load failed: ' + err.message, true);
      });
  }

  function renderSocialArbAudit(data) {
    var raw = Number(data.raw_hits_7d || 0);
    var matched = Number(data.matched_hits_7d || 0);
    var concepts = data.tracked_concepts || {};
    var emerging = data.emerging_topics || {};
    var cards = data.social_cards || {};

    var summary = document.getElementById('mi-social-audit-summary');
    if (summary) {
      summary.textContent = 'raw: ' + raw.toLocaleString() +
        ' \u00b7 matched: ' + matched.toLocaleString() +
        ' \u00b7 cards: ' + Number(cards.active_visible || 0).toLocaleString();
    }

    var funnel = document.getElementById('mi-social-audit-funnel');
    if (funnel) {
      funnel.textContent = '';
      [
        ['Active concepts', concepts.active || 0],
        ['Pending spikes', emerging.pending || 0],
        ['Promoted spike events', emerging.promoted_spike_events || emerging.promoted || 0],
        ['Unique Social ARB cards', emerging.unique_promoted_cards || 0],
        ['Repeated pulses', emerging.repeated_pulses || 0],
        ['Suppressed', emerging.suppressed || 0],
        ['Cross-platform', emerging.cross_platform || 0],
        ['Pure Social ARB cards', cards.pure_social || 0],
        ['Mixed cards', cards.mixed_social_macro || 0]
      ].forEach(function (pair) {
        var chip = el('span', 'mi-operator-card-count', pair[0] + ': ' + Number(pair[1] || 0).toLocaleString());
        funnel.appendChild(chip);
      });
    }

    var tbody = document.querySelector('#mi-social-audit-table tbody');
    if (!tbody) return;
    tbody.textContent = '';
    var sources = Array.isArray(data.sources) ? data.sources : [];
    if (!sources.length) {
      var empty = el('tr');
      var td = el('td', 'mi-operator-empty', 'No Social ARB intake found in the last 7 days.');
      td.colSpan = 5;
      empty.appendChild(td);
      tbody.appendChild(empty);
      return;
    }
    sources.forEach(function (src) {
      var tr = el('tr');
      tr.appendChild(el('td', '', src.source_type || '?'));
      tr.appendChild(el('td', '', src.source_community || '?'));
      tr.appendChild(el('td', '', Number(src.raw_hits_7d || 0).toLocaleString()));
      tr.appendChild(el('td', '', Number(src.matched_hits_7d || 0).toLocaleString()));
      tr.appendChild(el('td', '', src.latest_posted_at ? fmtAge(Number(src.latest_posted_at)) : '-'));
      tbody.appendChild(tr);
    });
  }

  function fetchSocialArbPromotedLedger() {
    return fetch(API_BASE + '/social-arb/promoted-topics?limit=200', {
      headers: { 'Accept': 'application/json' }
    })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        if (!payload || payload.success !== true) {
          throw new Error((payload && payload.error) || 'Malformed promoted-topic ledger response');
        }
        renderSocialArbPromotedLedger(payload.data || {});
      })
      .catch(function (err) {
        showOperatorToast('mi-social-ledger-toast', 'Load failed: ' + err.message, true);
      });
  }

  function renderSocialArbPromotedLedger(data) {
    var groups = Array.isArray(data.groups) ? data.groups : [];
    var candidates = Array.isArray(data.candidate_groups) ? data.candidate_groups : [];
    var items = Array.isArray(data.items) ? data.items : [];
    var summary = document.getElementById('mi-social-ledger-summary');
    if (summary) {
      summary.textContent = 'spike events: ' + Number(data.total || items.length).toLocaleString() +
        ' \u00b7 groups: ' + groups.length.toLocaleString() +
        ' \u00b7 cards: ' + Number(data.unique_situations || 0).toLocaleString() +
        ' \u00b7 candidates: ' + candidates.length.toLocaleString() +
        ' \u00b7 compression: ' + Number(data.compression_ratio || 0).toFixed(1) + 'x';
    }

    var tbody = document.querySelector('#mi-social-ledger-table tbody');
    if (!tbody) return;
    tbody.textContent = '';
    if (!groups.length && !candidates.length) {
      var empty = el('tr');
      var td = el('td', 'mi-operator-empty', 'No promoted spike groups or candidate intel groups found.');
      td.colSpan = 9;
      empty.appendChild(td);
      tbody.appendChild(empty);
      return;
    }

    groups.forEach(function (group) {
      var tr = el('tr');
      tr.appendChild(el('td', '', group.concept_key || '?'));
      tr.appendChild(el('td', '', Number(group.pulse_count || 0).toLocaleString()));
      var zText = group.max_z_score == null ? '-' : Number(group.max_z_score).toFixed(2);
      if (group.min_z_score != null && Number(group.min_z_score) !== Number(group.max_z_score)) {
        zText += ' to ' + Number(group.min_z_score).toFixed(2);
      }
      tr.appendChild(el('td', '', zText));
      tr.appendChild(el('td', '', Number(group.max_mentions || 0).toLocaleString() + ' / ' + Number(group.max_unique_authors || 0).toLocaleString()));
      tr.appendChild(el('td', '', group.seed_community || '-'));
      var fitCell = el(
        'td',
        '',
        Number(group.hunting_fit_score || 0).toFixed(0) +
          ' / src ' + Number(group.source_breadth || 0).toLocaleString() +
          ' / use ' + Number(group.real_use_hits_7d || 0).toLocaleString()
      );
      fitCell.title = 'Hunting fit score / source breadth / real-use evidence hits';
      tr.appendChild(fitCell);

      var cardText = '#' + group.seeded_situation_id + ' ' + (group.situation_title || '(missing card)');
      var cardCell = el('td', '', cardText);
      cardCell.title = [group.detection_path || '', group.status || '', group.coverage_tier || ''].filter(Boolean).join(' | ');
      tr.appendChild(cardCell);

      var scoreText = 'sig ' + Number(group.signal_strength || 0).toFixed(0) +
        ' / conf ' + Number(group.confidence_score || 0).toFixed(2);
      tr.appendChild(el('td', '', scoreText));

      var reason = Number(group.pulse_count || 0) > 1
        ? Number(group.pulse_count || 0).toLocaleString() + ' repeated spike events compressed into this card'
        : 'one spike event created this card';
      if (!Number(group.cross_platform_pulses || 0)) reason += ' | no cross-platform confirmation';
      else reason += ' | ' + Number(group.cross_platform_pulses || 0).toLocaleString() + ' cross-platform pulse(s)';
      if (Array.isArray(group.validity_flags) && group.validity_flags.length) {
        reason += ' | ' + group.validity_flags.join(', ');
      }
      if (Array.isArray(group.hunting_flags) && group.hunting_flags.length) {
        reason += ' | ' + group.hunting_flags.join(', ');
      }
      tr.appendChild(el('td', '', reason));
      tbody.appendChild(tr);
    });

    if (!groups.length && candidates.length) {
      candidates.forEach(function (group) {
        var tr = el('tr');
        tr.appendChild(el('td', '', group.concept_key || '?'));
        tr.appendChild(el('td', '', Number(group.source_breadth || 0).toLocaleString()));
        tr.appendChild(el('td', '', 'candidate'));
        tr.appendChild(el('td', '', Number(group.total_mentions_7d || 0).toLocaleString() + ' / ' + Number(group.max_unique_authors || 0).toLocaleString()));
        tr.appendChild(el('td', '', group.top_community || '-'));
        var fitCell = el(
          'td',
          '',
          Number(group.hunting_fit_score || 0).toFixed(0) +
            ' / src ' + Number(group.source_breadth || 0).toLocaleString() +
            ' / use ' + Number(group.real_use_hits_7d || 0).toLocaleString()
        );
        fitCell.title = 'Candidate hunting fit score / communities / real-use evidence hits';
        tr.appendChild(fitCell);

        var candidateCell = el('td', '', 'candidate intel - baseline warming');
        candidateCell.title = 'Raw evidence is present, but this has not passed the promoted-spike threshold yet.';
        tr.appendChild(candidateCell);

        var scoreText = '7d ' + Number(group.total_mentions_7d || 0).toLocaleString() +
          ' / max ' + Number(group.max_daily_mentions || 0).toLocaleString();
        tr.appendChild(el('td', '', scoreText));

        var reason = group.diagnosis || 'candidate intel, not promoted spike yet';
        if (Array.isArray(group.hunting_flags) && group.hunting_flags.length) {
          reason += ' | ' + group.hunting_flags.join(', ');
        }
        tr.appendChild(el('td', '', reason));
        tbody.appendChild(tr);
      });
    }
  }

  function fetchUniverseMovers() {
    return fetch(API_BASE + '/social-arb/universe-movers?limit=75', {
      headers: { 'Accept': 'application/json' }
    })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        if (!payload || payload.success !== true) {
          throw new Error((payload && payload.error) || 'Malformed universe-movers response');
        }
        renderUniverseMovers(payload.data || {});
      })
      .catch(function (err) {
        showOperatorToast('mi-universe-movers-toast', 'Load failed: ' + err.message, true);
      });
  }

  function renderUniverseMovers(data) {
    var items = Array.isArray(data.items) ? data.items : [];
    var summary = document.getElementById('mi-universe-movers-summary');
    if (summary) {
      var dayText = data.latest_day ? 'latest: ' + fmtAge(Number(data.latest_day)) : 'latest: -';
      summary.textContent = 'movers: ' + Number(data.total || items.length).toLocaleString() +
        ' \u00b7 ' + dayText;
    }

    var tbody = document.querySelector('#mi-universe-movers-table tbody');
    if (!tbody) return;
    tbody.textContent = '';
    if (!items.length) {
      var empty = el('tr');
      var td = el('td', 'mi-operator-empty', 'No normalized universe movers yet. Run the universe mention normalization job after intake warms up.');
      td.colSpan = 9;
      empty.appendChild(td);
      tbody.appendChild(empty);
      return;
    }

    items.forEach(function (row) {
      var tr = el('tr');
      var symbol = String(row.symbol || '?');
      var symbolCell = el('td');
      symbolCell.appendChild(scannerLink(symbol, 'mi-open-scanner-link mi-scanner-symbol-link'));
      tr.appendChild(symbolCell);
      tr.appendChild(el('td', '', (row.source_type || '?') + ' / ' + (row.source_community || '?')));
      tr.appendChild(el('td', '', Number(row.mention_count || 0).toLocaleString()));
      tr.appendChild(el('td', '', Number(row.baseline_mean || 0).toFixed(1)));
      tr.appendChild(el('td', '', Number(row.z_score || 0).toFixed(2)));
      tr.appendChild(el('td', '', Number(row.velocity_ratio || 0).toFixed(1) + 'x'));
      tr.appendChild(el('td', '', Number(row.unique_authors || 0).toLocaleString()));
      tr.appendChild(el(
        'td',
        '',
        'disc ' + Number(row.discovery_count || 0).toLocaleString() +
          ' / conf ' + Number(row.confirmation_count || 0).toLocaleString()
      ));
      tr.appendChild(el('td', '', Number(row.perturbation_score || 0).toFixed(1)));
      tbody.appendChild(tr);
    });
  }

  function fmtAgeSeconds(seconds) {
    if (seconds == null || !isFinite(seconds)) return '-';
    var s = Math.max(0, Number(seconds));
    if (s < 60) return Math.round(s) + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  function formatPct(value) {
    if (value == null || !isFinite(Number(value))) return '-';
    return Number(value).toFixed(2) + '%';
  }

  function formatCompactMoney(value) {
    if (value == null || !isFinite(Number(value))) return '-';
    var n = Number(value);
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n.toFixed(0);
  }

  function formatPrice(value) {
    if (value == null || !isFinite(Number(value))) return '-';
    var n = Number(value);
    return '$' + (Math.abs(n) < 10 ? n.toFixed(2) : n.toFixed(2));
  }

  function formatEigenOptions(options) {
    if (!options) return '-';
    var bias = options.flow_bias || 'flow';
    var tier = options.imbalance_tier || '';
    var callPut = options.call_put_ratio != null ? options.call_put_ratio : options.call_put_volume_ratio;
    var putCall = options.put_call_ratio != null ? options.put_call_ratio : options.put_call_volume_ratio;
    var ratio = bias === 'call_heavy' ? callPut : putCall;
    var ratioText = ratio == null ? '' : ' ' + Number(ratio).toFixed(1) + 'x';
    return (bias + ' ' + tier + ratioText).trim();
  }

  function formatEigenSocial(social) {
    if (!social) return '-';
    var source = social.source || social.source_type || 'social';
    var score = social.perturbation_score == null ? '' : ' ' + Number(social.perturbation_score).toFixed(1);
    return source + score;
  }

  function formatEigenValuation(valuation) {
    if (!valuation) return '-';
    var state = valuation.valuation_state || valuation.state || 'valuation';
    if (valuation.valuation_gap_pct == null) return state;
    return state + ' ' + Number(valuation.valuation_gap_pct).toFixed(1) + '%';
  }

  function isEigenPreExplosionPressure(row) {
    return Number(row.residual_z || 0) >= 2 &&
      Number(row.residual_z_change_1d || 0) >= 0.5 &&
      Number(row.residual_z_slope_3d || 0) >= 0.75 &&
      Math.abs(Number(row.actual_return_pct || 999)) <= 10 &&
      Math.abs(Number(row.unexplained_return_pct || 999)) <= 8;
  }

  function autoPrecompileEigenPressureReports(data, pressureRows) {
    if (!Array.isArray(pressureRows) || !pressureRows.length) return;
    var missingSymbols = [];
    var seen = {};
    pressureRows.forEach(function (row) {
      var symbol = String(row && row.symbol || '').trim().toUpperCase();
      if (!symbol || row.precompiled_report || seen[symbol]) return;
      seen[symbol] = true;
      missingSymbols.push(symbol);
    });
    if (!missingSymbols.length) return;

    var live = data.live || {};
    var scanId = (live.meta && live.meta.generated_at) || (live.pca && live.pca.latest_date) || '';
    var key = scanId + '|' + missingSymbols.join(',');
    if (eigenAutoPrecompileState.inFlight || eigenAutoPrecompileState.key === key) return;
    eigenAutoPrecompileState.inFlight = true;
    eigenAutoPrecompileState.key = key;

    var pressureSummary = document.getElementById('mi-eigen-pressure-summary');
    if (pressureSummary) {
      pressureSummary.textContent = 'matches: ' + pressureRows.length.toLocaleString() +
        ' · compiling ' + missingSymbols.length.toLocaleString() + ' report(s)';
    }

    fetch(API_BASE + '/eigen-perturbations/precompile', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        symbols: missingSymbols,
        limit: missingSymbols.length
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        if (!payload || payload.success !== true) {
          throw new Error((payload && payload.error) || 'Precompile failed');
        }
        var result = payload.data || {};
        showOperatorToast(
          'mi-eigen-toast',
          'Precompiled Eigen reports: ' + Number(result.cached || 0).toLocaleString() +
            ' new, ' + Number(result.skipped || 0).toLocaleString() + ' already ready.',
          false
        );
        return fetchEigenPerturbations();
      })
      .catch(function (err) {
        eigenAutoPrecompileState.key = '';
        showOperatorToast('mi-eigen-toast', 'Report precompile failed: ' + err.message, true);
      })
      .finally(function () {
        eigenAutoPrecompileState.inFlight = false;
      });
  }

  function fetchEigenPerturbations() {
    return fetch(API_BASE + '/eigen-perturbations/latest?limit=100', {
      headers: { 'Accept': 'application/json' }
    })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        if (!payload || payload.success !== true) {
          throw new Error((payload && payload.error) || 'Malformed eigen response');
        }
        renderEigenPerturbations(payload.data || {});
      })
      .catch(function (err) {
        showOperatorToast('mi-eigen-toast', 'Load failed: ' + err.message, true);
      });
  }

  function renderEigenPerturbations(data) {
    var live = data.live || {};
    var pca = live.pca || {};
    var loadStats = live.load_stats || {};
    var rows = Array.isArray(live.top_residual_movers) ? live.top_residual_movers : [];
    var pressureRows = rows.filter(isEigenPreExplosionPressure);
    var summary = document.getElementById('mi-eigen-summary');
    var scanSummary = document.getElementById('mi-eigen-scan-summary');
    var pressureSummary = document.getElementById('mi-eigen-pressure-summary');
    var age = fmtAgeSeconds(live.file_age_seconds);
    var symbols = pca.symbols_in_model || loadStats.symbols_in_model || live.total_top_residual_movers || 0;
    if (summary) {
      summary.textContent = 'scan: ' + Number(symbols).toLocaleString() +
        ' symbols · latest ' + age;
    }
    if (scanSummary) {
      var windowText = (pca.return_start_date && pca.return_end_date)
        ? pca.return_start_date + ' -> ' + pca.return_end_date
        : 'window: -';
      scanSummary.textContent = 'symbols: ' + Number(symbols).toLocaleString() +
        ' · factors: ' + (pca.factors_used || '-') +
        ' · ' + windowText;
    }
    if (pressureSummary) {
      pressureSummary.textContent = 'matches: ' + pressureRows.length.toLocaleString();
    }
    autoPrecompileEigenPressureReports(data, pressureRows);

    var replayEl = document.getElementById('mi-eigen-replay-summary');
    if (replayEl) {
      var replay = data.replay || {};
      var agg = replay.aggregate || {};
      var positive = agg.by_residual_direction_r && agg.by_residual_direction_r.positive_residual_long_r;
      if (positive) {
        var sixty = positive['60'] || {};
        var oneTwenty = positive['120'] || {};
        replayEl.textContent = 'Replay: positive residual long · 60D exp ' +
          Number(sixty.expectancy_r || 0).toFixed(2) + 'R / PF ' +
          Number(sixty.profit_factor || 0).toFixed(2) + ' · 120D exp ' +
          Number(oneTwenty.expectancy_r || 0).toFixed(2) + 'R / PF ' +
          Number(oneTwenty.profit_factor || 0).toFixed(2) +
          ' · age ' + fmtAgeSeconds(replay.file_age_seconds);
      } else {
        replayEl.textContent = 'Replay loaded, but no positive-residual expectancy summary is available.';
      }
    }

    renderEigenPressureTable(pressureRows);

    var tbody = document.querySelector('#mi-eigen-table tbody');
    if (!tbody) return;
    tbody.textContent = '';
    if (!rows.length) {
      var empty = el('tr');
      var td = el('td', 'mi-operator-empty', 'No eigen perturbation rows yet. Run the daily scan after OHLCV refresh.');
      td.colSpan = 9;
      empty.appendChild(td);
      tbody.appendChild(empty);
      return;
    }

    rows.forEach(function (row) {
      var tr = el('tr');
      var symbol = String(row.symbol || '?');
      var symbolCell = el('td');
      symbolCell.title = row.name || 'Open ' + symbol + ' in Scanner';
      symbolCell.addEventListener('click', function () {
        openEigenInvestigation(symbol);
      });
      symbolCell.appendChild(scannerLink(symbol, 'mi-open-scanner-link mi-scanner-symbol-link'));
      tr.appendChild(symbolCell);
      tr.appendChild(el('td', '', Number(row.residual_z || 0).toFixed(2)));
      tr.appendChild(el('td', '', formatPct(row.actual_return_pct)));
      tr.appendChild(el('td', '', formatPct(row.factor_expected_return_pct)));
      tr.appendChild(el('td', '', formatPct(row.unexplained_return_pct)));
      tr.appendChild(el('td', '', formatEigenOptions(row.options_flow)));
      tr.appendChild(el('td', '', formatEigenSocial(row.social_arb)));
      tr.appendChild(el('td', '', formatEigenValuation(row.valuation)));
      tr.appendChild(el('td', '', String(row.cross_signal_count || 0)));
      tbody.appendChild(tr);
    });
  }

  // ----------------------------------------------------------
  // Convergence Scoreboard — unified weighted-vote view.
  // Eigen is the highest-weighted vote but not a required anchor; a setup
  // earns a tier by how many independent observers agree on direction.
  // ----------------------------------------------------------
  var CONV_SOURCE_LABELS = {
    eigen: 'Eigen', insider: 'Insider', activist: '13D/G',
    options: 'Options', valuation: 'Value', social: 'Social'
  };

  function fetchConvergence() {
    var tier = CONVERGENCE_STATE.tier || 0;
    var q = (CONVERGENCE_STATE.search || '').trim();
    var url = API_BASE + '/convergence/latest?limit=150' + (tier ? '&tier=' + tier : '') +
      (q ? '&q=' + encodeURIComponent(q) : '');
    return fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        if (!payload || payload.success !== true) {
          throw new Error((payload && payload.error) || 'Malformed convergence response');
        }
        renderConvergence(payload.data || {});
      })
      .catch(function (err) {
        showOperatorToast('mi-convergence-toast', 'Load failed: ' + err.message, true);
        var tbody = document.querySelector('#mi-convergence-table tbody');
        if (tbody) {
          tbody.textContent = '';
          var tr = el('tr');
          var td = el('td', 'mi-operator-empty', err.message);
          td.colSpan = 7;
          tr.appendChild(td); tbody.appendChild(tr);
        }
      });
  }

  function convDirClass(direction) {
    if (direction === 'bullish') return 'mi-conv-bull';
    if (direction === 'bearish') return 'mi-conv-bear';
    return 'mi-conv-neutral';
  }

  function renderConvVoteChips(votes) {
    var wrap = el('span');
    (votes || []).forEach(function (v) {
      var up = Number(v.weighted) >= 0;
      var chip = el('span', 'mi-conv-chip ' + (up ? 'up' : 'down'),
        (CONV_SOURCE_LABELS[v.source] || v.source) + ' ' + (up ? '+' : '') + Number(v.weighted).toFixed(2));
      wrap.appendChild(chip);
    });
    return wrap;
  }

  // Real Volume (eigen-volume) confirmation badge. This is a *gate on the
  // eigen-price move*, not a vote: backtests show real-vol-confirmed breakouts
  // carry forward excess (t~3-4) while real-vol-absent ones drag. Green =
  // confirmed conviction, gray = skip, amber = weak/borderline.
  function renderRealVolChip(rv) {
    if (!rv || rv.real_vol_z == null) return null;
    var z = Number(rv.real_vol_z);
    var state = rv.state || (z > 0.5 ? 'confirmed' : (z <= 0 ? 'absent' : 'weak'));
    var cls = state === 'confirmed' ? 'confirm' : (state === 'absent' ? 'skip' : 'weak');
    var slope = rv.real_vol_slope_3d;
    var arrow = (slope != null) ? (slope > 0.05 ? ' \u2191' : (slope < -0.05 ? ' \u2193' : '')) : '';
    var chip = el('span', 'mi-conv-chip rvol ' + cls,
      'Real Vol ' + (z >= 0 ? '+' : '') + z.toFixed(2) + arrow);
    chip.title = 'Real Volume (eigen-volume): name-specific volume after removing the market-wide tide. '
      + state + ' (z ' + z.toFixed(2) + (slope != null ? ', 3d slope ' + Number(slope).toFixed(2) : '') + ').';
    return chip;
  }

  // Price-extension badge: how many sigma the price sits above (or below) the
  // stock's own long-term log-price trend. This is a FADE input, not a vote —
  // backtests show overvalued + stretched (>=2 sigma) + euphoric crowd
  // underperforms ~-4% over 3 months. Only render when meaningfully stretched
  // or depressed; near-trend names add no signal.
  function renderPriceStretchChip(pe) {
    if (!pe || pe.price_ext_z == null) return null;
    var z = Number(pe.price_ext_z);
    var state = pe.state || (z >= 3 ? 'extended' : (z >= 2 ? 'stretched' : (z <= -2 ? 'depressed' : 'normal')));
    if (state === 'normal') return null;
    var label = state === 'extended' ? 'Stretch +' + z.toFixed(1) + '\u03c3'
      : state === 'stretched' ? 'Stretch +' + z.toFixed(1) + '\u03c3'
      : 'Below trend ' + z.toFixed(1) + '\u03c3';
    var chip = el('span', 'mi-conv-chip pstretch ' + state, label);
    var rp = (pe.range_pos != null) ? ', ' + Math.round(Number(pe.range_pos) * 100) + '% of all-time range' : '';
    chip.title = 'Price extension: ' + z.toFixed(2) + ' sigma '
      + (z >= 0 ? 'above' : 'below') + " the stock's long-term price trend"
      + rp + '. '
      + (state === 'extended' ? 'Extended/exhaustion — strong FADE input if also overvalued + crowd bullish.'
         : state === 'stretched' ? 'Stretched — FADE input if also overvalued + crowd bullish.'
         : 'Beaten down vs its own trend (context only; not a long signal on its own).');
    return chip;
  }

  var FADE_TIMING_META = {
    extended: { suffix: 'at highs', tcls: 'wait', tip: 'Still pinned near the high — too early, don\u2019t chase.' },
    broken: { suffix: 'wait', tcls: 'wait', tip: 'Rolled over but no retest yet — WAIT for price to rally back and tag the prior high.' },
    retest: { suffix: 'armed', tcls: 'armed', tip: 'Retesting the prior high as a lower/equal high — armed; watch for rejection (double-top right shoulder).' },
    confirmed: { suffix: 'trigger', tcls: 'trigger', tip: 'Closed below the neckline (post-peak trough) — double top confirmed, fade trigger.' }
  };

  function renderFadeBadge(fade) {
    if (!fade) return null;
    var legs = fade.legs || {};
    var timing = fade.timing || null;
    var tmeta = timing && FADE_TIMING_META[timing.state];
    var cls = fade.candidate ? 'mi-conv-chip fade candidate' : 'mi-conv-chip fade partial';
    if (fade.confidence === 'strong') cls += ' strong';
    if (tmeta) cls += ' t-' + tmeta.tcls;
    var label = (fade.candidate ? (fade.confidence === 'strong' ? 'FADE+' : 'FADE') : 'FADE?')
      + (tmeta ? ' \u00b7 ' + tmeta.suffix : '');
    var chip = el('span', cls, label);
    var legTxt = [
      'DCF overvalued: ' + (legs.overvalued ? 'yes' : 'no'),
      'price \u22652\u03c3 stretched: ' + (legs.stretched ? 'yes' : 'no'),
      'crowd euphoric: ' + (legs.crowd_bullish ? 'yes' : 'no'),
      'insider selling: ' + (legs.insider_selling ? 'yes' : 'no')
    ].join(' \u00b7 ');
    var timingTxt = '';
    if (timing) {
      timingTxt = '\nEntry timing: ' + (tmeta ? tmeta.tip : timing.state)
        + ' (peak ' + timing.peak + ', now ' + timing.last + ', '
        + timing.drawdown_pct + '% off high; neckline ' + timing.neckline + ')';
    }
    chip.title = (fade.candidate
        ? (fade.confidence === 'strong'
            ? 'FADE CANDIDATE (STRONG) — overvalued + stretched + euphoric crowd AND insiders distributing into strength.'
            : 'FADE CANDIDATE — overvalued + stretched, confirmed by euphoric crowd or insider selling (the backtested ~-2.5%/-4% over 3mo short setup).')
        : 'Partial fade — overvalued + stretched, but no confirming leg (crowd thin/mixed and no insider distribution).')
      + '\n' + legTxt
      + (fade.detail ? '\n' + fade.detail : '')
      + timingTxt
      + '\nNote: short/caution flag only — it does NOT pick longs.';
    return chip;
  }

  function renderContrarianBadge(cw) {
    if (!cw) return null;
    var legs = cw.legs || {};
    var cls = cw.watch ? 'mi-conv-chip contra watch' : 'mi-conv-chip contra partial';
    var label = cw.watch ? 'BOTTOM?' : 'BOTTOM?\u00b7partial';
    var chip = el('span', cls, label);
    var legTxt = [
      'undervalued: ' + (legs.undervalued ? 'yes' : 'no'),
      'eigen down: ' + (legs.eigen_down ? 'yes' : 'no'),
      'crowd bearish: ' + (legs.crowd_bearish ? 'yes' : 'no') + (legs.crowd_flip_to_bear ? ' (FLIPPED)' : '')
    ].join(' \u00b7 ');
    chip.title = (cw.watch
        ? 'CONTRARIAN-BOTTOM WATCH — undervalued + eigen down + crowd capitulated bearish. Forward paper-track hypothesis (NOT yet backtested — social data too thin before 2026).'
        : 'Partial — undervalued + eigen down, but crowd not (yet) bearish.')
      + '\n' + legTxt
      + (cw.detail ? '\n' + cw.detail : '')
      + '\nLong/contrarian idea, logged forward for later evaluation.';
    return chip;
  }

  function convStep(title, lines) {
    var step = el('div', 'mi-conv-step');
    step.appendChild(el('h5', '', title));
    var body = el('div');
    if (!lines || !lines.length) {
      body.appendChild(el('span', 'muted', 'no footprint'));
    } else {
      lines.forEach(function (line) {
        var d = el('div', '', line);
        body.appendChild(d);
      });
    }
    step.appendChild(body);
    return step;
  }

  function renderConvDetail(row) {
    var ov = row.overlays || {};
    var funnel = el('div', 'mi-conv-funnel');

    // 1. Signal — eigen price footprint
    var sigLines = [];
    sigLines.push('residual z ' + Number(row.residual_z || 0).toFixed(2));
    if (ov.residual_z_slope_3d != null) sigLines.push('slope 3d ' + Number(ov.residual_z_slope_3d).toFixed(2));
    if (ov.unexplained_return_pct != null) sigLines.push('unexplained ' + formatPct(ov.unexplained_return_pct));
    var rv = ov.real_volume;
    if (rv && rv.real_vol_z != null) {
      var rvLabel = rv.state === 'confirmed' ? 'CONFIRMED' : (rv.state === 'absent' ? 'absent — skip' : 'weak');
      sigLines.push('real volume ' + Number(rv.real_vol_z).toFixed(2) + ' (' + rvLabel + ')'
        + (rv.real_vol_slope_3d != null ? ', 3d slope ' + Number(rv.real_vol_slope_3d).toFixed(2) : ''));
    }
    var pe = ov.price_extension;
    if (pe && pe.price_ext_z != null) {
      var peLabel = pe.state === 'extended' ? 'EXTENDED — fade input'
        : pe.state === 'stretched' ? 'stretched — fade input'
        : pe.state === 'depressed' ? 'below trend' : 'near trend';
      sigLines.push('price extension ' + (Number(pe.price_ext_z) >= 0 ? '+' : '')
        + Number(pe.price_ext_z).toFixed(2) + '\u03c3 vs trend (' + peLabel + ')'
        + (pe.range_pos != null ? ', ' + Math.round(Number(pe.range_pos) * 100) + '% of range' : ''));
    }
    var cs = ov.crowd_sentiment;
    if (cs && cs.net_bull_share != null) {
      sigLines.push('crowd ' + Math.round(Number(cs.net_bull_share) * 100) + '% bull ('
        + (cs.mood || 'mixed') + ', n=' + (cs.n_directional || 0) + ' over ' + (cs.window_days || 45) + 'd)');
    }
    var fd = ov.fade;
    if (fd) {
      sigLines.push((fd.candidate ? (fd.confidence === 'strong' ? '\u2691 FADE CANDIDATE (STRONG)' : '\u2691 FADE CANDIDATE') : 'partial fade')
        + ' — overvalued ' + (fd.legs && fd.legs.overvalued ? '\u2713' : '\u2717')
        + ', stretched ' + (fd.legs && fd.legs.stretched ? '\u2713' : '\u2717')
        + ', crowd euphoric ' + (fd.legs && fd.legs.crowd_bullish ? '\u2713' : '\u2717')
        + ', insider selling ' + (fd.legs && fd.legs.insider_selling ? '\u2713' : '\u2717')
        + (fd.detail ? ' (' + fd.detail + ')' : ''));
      if (fd.timing) {
        var t = fd.timing;
        sigLines.push('  entry timing: ' + (t.action || t.state)
          + ' — peak ' + t.peak + ', now ' + t.last + ' (' + t.drawdown_pct + '% off high), neckline ' + t.neckline);
      }
    }
    var cw = ov.contrarian;
    if (cw) {
      sigLines.push((cw.watch ? '\u2691 BOTTOM WATCH (contrarian, forward-tracked)' : 'partial bottom watch')
        + ' — undervalued ' + (cw.legs && cw.legs.undervalued ? '\u2713' : '\u2717')
        + ', eigen down ' + (cw.legs && cw.legs.eigen_down ? '\u2713' : '\u2717')
        + ', crowd bearish ' + (cw.legs && cw.legs.crowd_bearish ? '\u2713' : '\u2717')
        + (cw.legs && cw.legs.crowd_flip_to_bear ? ' (FLIPPED)' : '')
        + (cw.detail ? ' (' + cw.detail + ')' : ''));
    }
    funnel.appendChild(convStep('1 · Signal (Eigen)', sigLines));

    // 2. Sub-surface corroboration — insider + activist
    var subLines = [];
    var ins = ov.insider;
    if (ins && (ins.buy_count || ins.sell_count)) {
      subLines.push('insider: ' + (ins.buy_count || 0) + ' buy / ' + (ins.sell_count || 0) + ' sell');
      if (ins.net_value) subLines.push('net $' + Math.round(ins.net_value).toLocaleString());
    }
    var act = ov.activist;
    if (act) {
      subLines.push((act.is_activist ? '13D activist' : '13G passive') + ': ' + (act.filer_name || '?') +
        (act.percent_owned != null ? ' ' + Number(act.percent_owned).toFixed(1) + '%' : ''));
    }
    funnel.appendChild(convStep('2 · Sub-surface (Filings)', subLines));

    // 3. Options confirmation
    var optLines = [];
    var opt = ov.options_flow;
    if (opt) {
      optLines.push((opt.flow_bias || 'balanced') + ' · ' + (opt.imbalance_tier || 'normal'));
      var ratio = opt.flow_bias === 'put_heavy' ? opt.put_call_ratio : opt.call_put_ratio;
      if (ratio) optLines.push(Number(ratio).toFixed(1) + 'x');
    }
    funnel.appendChild(convStep('3 · Options', optLines));

    // 4. Ledger cross-check — valuation + social
    var ledgerLines = [];
    var val = ov.valuation;
    if (val && val.valuation_state) {
      ledgerLines.push(val.valuation_state + (val.valuation_gap_pct != null ? ' ' + Number(val.valuation_gap_pct).toFixed(1) + '%' : ''));
      if (val.quality_grade) ledgerLines.push('quality ' + val.quality_grade);
    }
    var soc = ov.social_arb;
    if (soc) ledgerLines.push('social ' + (soc.source || '') + ' z ' + Number(soc.z_score || 0).toFixed(1));
    funnel.appendChild(convStep('4 · Ledger Cross-Check', ledgerLines));

    var wrap = el('div');
    wrap.appendChild(funnel);
    wrap.appendChild(renderCatalystHunt(row));
    return wrap;
  }

  // "What's going on behind the scenes?" — agent narrative over social posts.
  function fetchCatalystNarrative(symbol) {
    return fetch(API_BASE + '/convergence/' + encodeURIComponent(symbol) + '/catalyst', {
      headers: { 'Accept': 'application/json' }
    })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        if (!payload || payload.success !== true) {
          throw new Error((payload && payload.error) || 'Malformed catalyst response');
        }
        return payload.data || {};
      });
  }

  // Render a structured thesis result (shared by cached + live re-scan).
  function renderThesisBlock(out, data) {
    out.textContent = '';
    if (data.classification) out.appendChild(el('div', 'mi-conv-thesis-class', data.classification));
    if (data.headline) out.appendChild(el('div', 'mi-conv-thesis-headline', data.headline));
    var theses = Array.isArray(data.theses) ? data.theses : [];
    theses.forEach(function (t) {
      var box = el('div', 'mi-conv-thesis-item');
      var dir = t.direction === 'bull' ? '\u25B2 bull' : t.direction === 'bear' ? '\u25BC bear' : '';
      box.appendChild(el('div', 'mi-conv-thesis-claim', (dir ? dir + ' \u00b7 ' : '') + (t.claim || '')));
      if (t.driver) box.appendChild(el('div', 'mi-conv-thesis-sub', 'driver: ' + t.driver));
      if (t.mechanism) box.appendChild(el('div', 'mi-conv-thesis-sub', 'mechanism: ' + t.mechanism));
      out.appendChild(box);
    });
    if (data.narrative) out.appendChild(el('div', 'mi-conv-narrative-text', data.narrative));
    if (!theses.length && !data.narrative) {
      var msgs = {
        no_evidence: 'No social/forum posts on file for this symbol yet.',
        no_api_key: 'Thesis extraction unavailable (no API key configured).',
        no_thesis: 'Only low-substance chatter \u2014 no real business thesis detected.',
        empty: 'The analyst returned nothing.',
        quota: 'Model API quota exceeded \u2014 the analyst never ran. Check OpenAI billing/credits.',
        error: 'Thesis extraction failed (model API error).'
      };
      out.appendChild(el('span', 'muted', msgs[data.narrative_status] || 'No thesis detected.'));
      if ((data.narrative_status === 'quota' || data.narrative_status === 'error') && data.narrative_detail) {
        out.appendChild(el('div', 'muted', data.narrative_detail));
      }
    }
    if (typeof data.signal_count === 'number') {
      out.appendChild(el('div', 'mi-conv-thesis-meta', 'signal ' + data.signal_count + ' \u00b7 noise ' + (data.noise_count || 0)));
    }
    var sources = Array.isArray(data.sources) ? data.sources : [];
    if (sources.length) {
      var srcWrap = el('div', 'mi-conv-sources');
      srcWrap.appendChild(el('div', 'mi-conv-sources-head', 'Sources (' + (data.evidence_count || sources.length) + ')'));
      sources.forEach(function (s) {
        var line = el('div', 'mi-conv-source' + (s.alias_risk ? ' alias-risk' : ''));
        var label = '[' + s.idx + '] ' + (s.source_type || '') + ' \u00b7 ' + (s.posted_at || '') + (s.alias_risk ? ' \u00b7 alias risk' : '');
        if (s.source_url) {
          var a = el('a', 'mi-open-scanner-link', label);
          a.href = s.source_url; a.target = '_blank'; a.rel = 'noopener';
          line.appendChild(a);
        } else {
          line.appendChild(el('span', '', label));
        }
        if (s.title || s.excerpt) line.appendChild(el('div', 'mi-conv-source-text', s.title || s.excerpt));
        srcWrap.appendChild(line);
      });
      out.appendChild(srcWrap);
    }
  }

  function renderCatalystHunt(row) {
    var symbol = String(row.symbol || '').toUpperCase();
    var panel = el('div', 'mi-conv-catalyst');
    var head = el('div', 'mi-conv-catalyst-head');
    head.appendChild(el('span', '', 'Catalyst Hunt \u2014 thesis extractor'));
    var btn = el('button', 'mi-operator-btn', 'Re-scan live');
    head.appendChild(btn);
    panel.appendChild(head);
    var out = el('div', 'mi-conv-catalyst-body');
    panel.appendChild(out);

    // Auto-show the cached thesis (computed in the background after the
    // convergence run) so the operator does not have to ask.
    var cached = CONVERGENCE_THESES[symbol];
    if (cached && (cached.has_thesis || (cached.theses && cached.theses.length))) {
      renderThesisBlock(out, {
        classification: cached.classification, headline: cached.headline,
        theses: cached.theses, narrative: cached.narrative,
        signal_count: cached.signal_count, noise_count: cached.noise_count,
        narrative_status: cached.has_thesis ? 'ok' : 'no_thesis'
      });
      out.appendChild(el('div', 'muted', 'cached ' + (cached.updated_at || '') + ' \u00b7 Re-scan live for fresh posts'));
    } else if (cached) {
      out.appendChild(el('span', 'muted', 'No business thesis detected in recent buzz \u2014 only noise. Re-scan live to recheck.'));
    } else {
      out.appendChild(el('span', 'muted', 'Not scanned yet. Click Re-scan live to read recent posts now.'));
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      btn.disabled = true; btn.textContent = 'Scanning\u2026';
      out.textContent = '';
      out.appendChild(el('span', 'muted', 'Reading posts and extracting thesis\u2026'));
      fetchCatalystNarrative(symbol)
        .then(function (data) { renderThesisBlock(out, data); })
        .catch(function (err) { out.textContent = ''; out.appendChild(el('span', 'muted', 'Failed: ' + err.message)); })
        .finally(function () { btn.disabled = false; btn.textContent = 'Re-scan live'; });
    });

    return panel;
  }

  function decorateThesisFlags() {
    var trs = document.querySelectorAll('#mi-convergence-table tbody tr.mi-conv-row');
    Array.prototype.forEach.call(trs, function (tr) {
      var sym = tr.getAttribute('data-symbol');
      if (!sym) return;
      var cell = tr.querySelector('.mi-conv-symcell');
      if (!cell) return;
      var old = cell.querySelector('.mi-conv-thesis-flag');
      if (old) cell.removeChild(old);
      var info = CONVERGENCE_THESES[sym];
      if (info && info.has_thesis) {
        var flag = el('span', 'mi-conv-thesis-flag', '\u26A0 thesis');
        flag.title = (info.classification ? info.classification + ' \u2014 ' : '') + (info.headline || '');
        cell.appendChild(flag);
      }
    });
  }

  function fetchConvergenceTheses() {
    return fetch(API_BASE + '/convergence/theses', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.success && j.data) {
          CONVERGENCE_THESES = j.data.theses || {};
          decorateThesisFlags();
          var st = j.data.scan_status;
          if (st && st.running && THESIS_POLLS < 40) {
            THESIS_POLLS += 1;
            setTimeout(fetchConvergenceTheses, 8000);
          }
        }
      })
      .catch(function () { /* flags are best-effort */ });
  }

  function fetchEventRiskRadar() {
    var table = document.querySelector('#mi-event-risk-table tbody');
    if (table) {
      table.innerHTML = '<tr><td colspan="5" class="mi-operator-empty">Loading event risk radar...</td></tr>';
    }
    return fetch(API_BASE + '/event-risk-radar?days=45&limit=75', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.success || !j.data) throw new Error((j && j.error) || 'Malformed event risk response');
        EVENT_RISK_ALERTS = Array.isArray(j.data.items) ? j.data.items : [];
        renderEventRiskRadar(j.data);
      })
      .catch(function (err) {
        var tbody = document.querySelector('#mi-event-risk-table tbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="mi-operator-empty">Load failed: ' + esc(err.message || err) + '</td></tr>';
        var summary = document.getElementById('mi-event-risk-summary');
        if (summary) summary.textContent = 'load failed';
      });
  }

  function eventRiskWhy(row) {
    var thesis = row.thesis || {};
    if (thesis.has_thesis && thesis.headline) return thesis.headline;
    var social = row.social_context || {};
    var posts = Array.isArray(social.posts) ? social.posts : [];
    var keywords = social.keyword_counts || {};
    var tags = Object.keys(keywords).filter(function (k) { return Number(keywords[k] || 0) > 0; });
    if (tags.length) return 'Social context: ' + tags.slice(0, 4).join(', ');
    if (posts.length && posts[0].text) return posts[0].text;
    return 'No explicit narrative found yet. Treat the options footprint as the lead.';
  }

  function eventRiskKeywordTags(row) {
    var keywords = (row.social_context && row.social_context.keyword_counts) || {};
    return Object.keys(keywords).filter(function (k) {
      return Number(keywords[k] || 0) > 0;
    }).sort(function (a, b) {
      return Number(keywords[b] || 0) - Number(keywords[a] || 0);
    }).slice(0, 5).map(function (k) {
      return k + ' ' + Number(keywords[k] || 0);
    });
  }

  function eventRiskBand(score) {
    score = Number(score || 0);
    if (score >= 350) return { label: 'urgent', detail: 'multiple critical option alerts and/or narrative confirmation' };
    if (score >= 200) return { label: 'high', detail: 'strong options footprint; needs immediate why-hunt' };
    if (score >= 100) return { label: 'watch', detail: 'notable options footprint; monitor for narrative' };
    return { label: 'background', detail: 'low-grade anomaly or thin confirmation' };
  }

  function formatEventBuzz(buzz) {
    if (!buzz || !buzz.trade_date) return { line: 'No social buzz score yet.', title: '' };
    var z = buzz.buzz_zscore == null ? 'n/a' : Number(buzz.buzz_zscore).toFixed(2);
    var st = Number(buzz.stocktwits_mentions || 0);
    var y = Number(buzz.yahoo_mentions || 0);
    return {
      line: 'Buzz z-score ' + z + ' on ' + buzz.trade_date + ' · StockTwits mentions ' + st + ' · Yahoo mentions ' + y,
      title: 'Buzz z-score is the mention-volume anomaly. ST = StockTwits mentions. Y = Yahoo mentions. Validity: ' + (buzz.score_validity || 'n/a'),
    };
  }

  function renderEventRiskDetail(row) {
    var wrap = el('div', 'mi-risk-detail-grid');
    var band = eventRiskBand(row.risk_score);

    var thesisCard = el('div', 'mi-risk-detail-card');
    thesisCard.appendChild(el('h5', '', 'Thesis / Why'));
    var thesis = row.thesis || {};
    if (thesis.has_thesis) {
      thesisCard.appendChild(el('div', 'mi-risk-detail-item', thesis.headline || 'Material thesis detected'));
      thesisCard.appendChild(el('div', 'mi-risk-detail-meta',
        [thesis.direction || null, thesis.classification || null, thesis.updated_at ? 'updated ' + fmtDateTime(thesis.updated_at) : null].filter(Boolean).join(' · ')));
    } else {
      thesisCard.appendChild(el('div', 'mi-risk-detail-item', 'No extracted thesis yet.'));
      thesisCard.appendChild(el('div', 'mi-risk-detail-meta', 'The options footprint is the lead. Social keywords/posts below are only clues until a thesis is extracted.'));
    }
    var tags = eventRiskKeywordTags(row);
    if (tags.length) {
      var tagWrap = el('div', 'mi-risk-tags');
      tags.forEach(function (tag) { tagWrap.appendChild(el('span', 'mi-risk-tag', tag)); });
      thesisCard.appendChild(tagWrap);
    }
    wrap.appendChild(thesisCard);

    var scoreCard = el('div', 'mi-risk-detail-card');
    scoreCard.appendChild(el('h5', '', 'Risk Score'));
    scoreCard.appendChild(el('div', 'mi-risk-detail-item', band.label.toUpperCase() + ' · raw score ' + Number(row.risk_score || 0)));
    scoreCard.appendChild(el('div', 'mi-risk-detail-meta', band.detail));
    scoreCard.appendChild(el('div', 'mi-risk-detail-meta',
      'Inputs: critical ' + Number(row.critical_count || 0) +
      ', high ' + Number(row.high_count || 0) +
      ', downside ' + Number(row.downside_count || 0) +
      ', upside ' + Number(row.upside_count || 0) +
      ', total alerts ' + Number(row.alert_count || 0) + '.'));
    scoreCard.appendChild(el('div', 'mi-risk-detail-meta', 'Score is a ranking number, not a probability. Higher means more independent reasons to investigate now.'));
    wrap.appendChild(scoreCard);

    var buzzCard = el('div', 'mi-risk-detail-card');
    buzzCard.appendChild(el('h5', '', 'Buzz'));
    var buzzInfo = formatEventBuzz(row.latest_buzz);
    buzzCard.appendChild(el('div', 'mi-risk-detail-item', buzzInfo.line));
    buzzCard.appendChild(el('div', 'mi-risk-detail-meta', 'Mention velocity ' + num(row.latest_buzz && row.latest_buzz.mention_velocity, 2) +
      ' · acceleration ' + num(row.latest_buzz && row.latest_buzz.mention_acceleration, 2) +
      ' · score validity ' + ((row.latest_buzz && row.latest_buzz.score_validity) || 'n/a') + '.'));
    wrap.appendChild(buzzCard);

    var alertsCard = el('div', 'mi-risk-detail-card');
    alertsCard.appendChild(el('h5', '', 'Options Alerts'));
    var alertList = el('div', 'mi-risk-detail-list');
    (Array.isArray(row.alerts) ? row.alerts : []).forEach(function (a) {
      var item = el('div', 'mi-risk-detail-item');
      item.appendChild(el('div', '', (a.trade_date || 'n/a') + ' · ' + (a.severity || 'alert') + ' · ' + (a.headline || a.alert_type || 'Options alert')));
      if (a.detail) item.appendChild(el('div', 'mi-risk-detail-meta', a.detail));
      alertList.appendChild(item);
    });
    if (!alertList.childNodes.length) alertList.appendChild(el('div', 'mi-risk-detail-meta', 'No alert detail available.'));
    alertsCard.appendChild(alertList);
    wrap.appendChild(alertsCard);

    var postsCard = el('div', 'mi-risk-detail-card');
    postsCard.appendChild(el('h5', '', 'Recent Social'));
    var postList = el('div', 'mi-risk-detail-list');
    var posts = row.social_context && Array.isArray(row.social_context.posts) ? row.social_context.posts : [];
    posts.forEach(function (post) {
      var item = el('div', 'mi-risk-detail-item');
      item.appendChild(el('div', '', (post.platform || 'social') + ' · ' + (post.author || 'unknown') + ' · ' + (post.posted_at ? fmtDateTime(post.posted_at) : '')));
      item.appendChild(el('div', 'mi-risk-detail-meta', post.text || ''));
      postList.appendChild(item);
    });
    if (!postList.childNodes.length) postList.appendChild(el('div', 'mi-risk-detail-meta', 'No recent social posts found for this symbol.'));
    postsCard.appendChild(postList);
    wrap.appendChild(postsCard);

    var actionCard = el('div', 'mi-risk-detail-card');
    actionCard.appendChild(el('h5', '', 'Operator Read'));
    actionCard.appendChild(el('div', 'mi-risk-detail-item',
      row.posture === 'binary_event'
        ? 'Two-sided options demand: traders may be positioning for a binary catalyst or hedging a known event.'
        : row.posture === 'downside_protection'
          ? 'Downside protection demand: puts/skew are the lead signal.'
          : row.posture === 'upside_speculation'
            ? 'Upside speculation: call demand is the lead signal.'
            : 'Options anomaly: inspect before assigning direction.'));
    actionCard.appendChild(el('div', 'mi-risk-detail-meta', 'Next check: catalyst calendar, trial/approval timing, filings, cash runway, and whether social chatter has a concrete claim.'));
    wrap.appendChild(actionCard);

    return wrap;
  }

  function renderEventRiskRadar(data) {
    var tbody = document.querySelector('#mi-event-risk-table tbody');
    if (!tbody) return;
    tbody.textContent = '';
    var summary = document.getElementById('mi-event-risk-summary');
    if (summary) {
      var critical = EVENT_RISK_ALERTS.filter(function (r) { return String(r.max_severity || '').toLowerCase() === 'critical'; }).length;
      summary.textContent = 'alerts: ' + EVENT_RISK_ALERTS.length + (critical ? ' · critical: ' + critical : '') + (data && data.as_of ? ' · ' + data.as_of : '');
    }
    if (!EVENT_RISK_ALERTS.length) {
      var empty = el('tr');
      var td = el('td', 'mi-operator-empty', 'No event-risk footprints in the current lookback.');
      td.colSpan = 5;
      empty.appendChild(td);
      tbody.appendChild(empty);
      return;
    }
    EVENT_RISK_ALERTS.forEach(function (row) {
      var tr = el('tr', 'mi-conv-row');
      var sym = String(row.symbol || '').toUpperCase();
      var band = eventRiskBand(row.risk_score);

      var symTd = el('td');
      var symWrap = el('div', 'mi-risk-symbol');
      symWrap.appendChild(scannerLink(sym || '?', 'mi-open-scanner-link mi-scanner-symbol-link'));
      symWrap.appendChild(el('span', 'mi-risk-posture ' + String(row.posture || ''), String(row.posture || 'risk').replace(/_/g, ' ')));
      symTd.appendChild(symWrap);
      tr.appendChild(symTd);

      var riskTd = el('td');
      riskTd.appendChild(el('div', 'mi-risk-score-label', band.label));
      riskTd.appendChild(el('div', 'mi-risk-score-sub', 'raw ' + Number(row.risk_score || 0) + ' · ' + String(row.max_severity || 'alert')));
      riskTd.title = 'Raw score is for ranking, not probability. ' + band.detail;
      tr.appendChild(riskTd);

      var optTd = el('td');
      var heads = Array.isArray(row.option_headlines) ? row.option_headlines : [];
      optTd.appendChild(el('div', 'mi-risk-why', heads[0] || 'Options anomaly'));
      optTd.appendChild(el('div', 'mi-risk-snippet',
        Number(row.alert_count || 0) + ' alerts · downside ' + Number(row.downside_count || 0) +
        ' · upside ' + Number(row.upside_count || 0) +
        ' · latest ' + (row.latest_trade_date || 'n/a')));
      tr.appendChild(optTd);

      var whyTd = el('td');
      whyTd.appendChild(el('div', 'mi-risk-why', eventRiskWhy(row)));
      var posts = row.social_context && Array.isArray(row.social_context.posts) ? row.social_context.posts : [];
      if (posts.length && posts[0].text) {
        whyTd.appendChild(el('div', 'mi-risk-snippet', posts[0].platform + ' · ' + posts[0].text));
      }
      var tags = eventRiskKeywordTags(row);
      if (tags.length) {
        var tagWrap = el('div', 'mi-risk-tags');
        tags.forEach(function (tag) { tagWrap.appendChild(el('span', 'mi-risk-tag', tag)); });
        whyTd.appendChild(tagWrap);
      }
      tr.appendChild(whyTd);

      var buzz = row.latest_buzz || {};
      var buzzInfo = formatEventBuzz(buzz);
      var buzzTd = el('td');
      if (buzz.trade_date) {
        buzzTd.appendChild(el('div', 'mi-risk-buzz', 'Buzz z-score: ' + (buzz.buzz_zscore == null ? 'n/a' : Number(buzz.buzz_zscore).toFixed(2))));
        buzzTd.appendChild(el('div', 'mi-risk-snippet', 'StockTwits: ' + Number(buzz.stocktwits_mentions || 0) + ' · Yahoo: ' + Number(buzz.yahoo_mentions || 0)));
      } else {
        buzzTd.appendChild(el('div', 'mi-risk-snippet', 'No social buzz score yet.'));
      }
      buzzTd.title = buzzInfo.title;
      tr.appendChild(buzzTd);

      tbody.appendChild(tr);

      var detailTr = null;
      tr.addEventListener('click', function (e) {
        if (e.target && e.target.tagName === 'A') return;
        if (detailTr && detailTr.parentNode) {
          detailTr.parentNode.removeChild(detailTr);
          detailTr = null;
          return;
        }
        detailTr = el('tr', 'mi-risk-detail');
        var dtd = el('td');
        dtd.colSpan = 5;
        dtd.appendChild(renderEventRiskDetail(row));
        detailTr.appendChild(dtd);
        tr.parentNode.insertBefore(detailTr, tr.nextSibling);
      });
    });
  }

  function initEventRiskRadar() {
    var section = document.getElementById('mi-event-risk-section');
    var header = document.getElementById('mi-event-risk-header');
    var toggle = document.getElementById('mi-event-risk-toggle');
    if (section && header && toggle) {
      header.addEventListener('click', function (e) {
        if (e.target && e.target.tagName === 'BUTTON' && e.target !== toggle) return;
        var open = !section.classList.contains('expanded');
        section.classList.toggle('expanded', open);
        toggle.textContent = open ? '\u2212' : '+';
      });
    }
    var refresh = document.getElementById('mi-event-risk-refresh');
    if (refresh) refresh.addEventListener('click', function (e) {
      e.stopPropagation();
      fetchEventRiskRadar();
    });
    fetchEventRiskRadar();
  }

  function fetchSocialThesisAlerts() {
    var table = document.querySelector('#mi-social-thesis-table tbody');
    if (table) {
      table.innerHTML = '<tr><td colspan="5" class="mi-operator-empty">Loading social theses...</td></tr>';
    }
    return fetch(API_BASE + '/social-thesis-alerts?limit=75', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.success || !j.data) throw new Error((j && j.error) || 'Malformed thesis alert response');
        SOCIAL_THESIS_ALERTS = Array.isArray(j.data.items) ? j.data.items : [];
        renderSocialThesisAlerts();
      })
      .catch(function (err) {
        var tbody = document.querySelector('#mi-social-thesis-table tbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="mi-operator-empty">Load failed: ' + esc(err.message || err) + '</td></tr>';
        var summary = document.getElementById('mi-social-thesis-summary');
        if (summary) summary.textContent = 'load failed';
      });
  }

  function renderSocialThesisAlerts() {
    var tbody = document.querySelector('#mi-social-thesis-table tbody');
    if (!tbody) return;
    tbody.textContent = '';
    var summary = document.getElementById('mi-social-thesis-summary');
    if (summary) {
      var bear = SOCIAL_THESIS_ALERTS.filter(function (r) { return String(r.direction || '').toLowerCase() === 'bear'; }).length;
      summary.textContent = 'theses: ' + SOCIAL_THESIS_ALERTS.length + (bear ? ' · bear: ' + bear : '');
    }
    if (!SOCIAL_THESIS_ALERTS.length) {
      var empty = el('tr');
      var td = el('td', 'mi-operator-empty', 'No cached social theses yet. Run a scanner thesis extraction or convergence thesis scan.');
      td.colSpan = 5;
      empty.appendChild(td);
      tbody.appendChild(empty);
      return;
    }
    SOCIAL_THESIS_ALERTS.forEach(function (row) {
      var tr = el('tr', 'mi-conv-row');
      var sym = String(row.symbol || '').toUpperCase();

      var symTd = el('td');
      var symWrap = el('div', 'mi-thesis-symbol');
      symWrap.appendChild(scannerLink(sym || '?', 'mi-open-scanner-link mi-scanner-symbol-link'));
      if (row.stale) {
        var stale = el('span', 'mi-conv-thesis-flag', 'stale');
        stale.title = 'Cached thesis is older than the freshness window';
        symWrap.appendChild(stale);
      }
      symTd.appendChild(symWrap);
      tr.appendChild(symTd);

      var thesisTd = el('td');
      thesisTd.appendChild(el('div', 'mi-thesis-headline', row.headline || 'Material social thesis'));
      var sub = [
        row.classification || null,
        row.narrative ? String(row.narrative).slice(0, 180) : null,
      ].filter(Boolean).join(' · ');
      thesisTd.appendChild(el('div', 'mi-thesis-sub', sub || 'No narrative summary cached.'));
      tr.appendChild(thesisTd);

      var dir = String(row.direction || 'mixed').toLowerCase();
      tr.appendChild(el('td', 'mi-thesis-dir ' + (dir === 'bear' ? 'bear' : dir === 'bull' ? 'bull' : ''), dir));

      var buzz = row.latest_buzz || {};
      var buzzText = buzz.trade_date
        ? 'z ' + (buzz.buzz_zscore == null ? 'n/a' : Number(buzz.buzz_zscore).toFixed(2)) +
          ' · ST ' + Number(buzz.stocktwits_mentions || 0) +
          ' · Y ' + Number(buzz.yahoo_mentions || 0)
        : 'n/a';
      var buzzTd = el('td', 'mi-thesis-z', buzzText);
      if (buzz.score_validity) buzzTd.title = 'score_validity: ' + buzz.score_validity + ' · trade_date: ' + buzz.trade_date;
      tr.appendChild(buzzTd);

      tr.appendChild(el('td', '', fmtDateTime(row.updated_at)));
      tbody.appendChild(tr);
    });
  }

  function initSocialThesisAlerts() {
    var section = document.getElementById('mi-social-thesis-section');
    var header = document.getElementById('mi-social-thesis-header');
    var toggle = document.getElementById('mi-social-thesis-toggle');
    if (section && header && toggle) {
      header.addEventListener('click', function (e) {
        if (e.target && e.target.tagName === 'BUTTON' && e.target !== toggle) return;
        var open = !section.classList.contains('expanded');
        section.classList.toggle('expanded', open);
        toggle.textContent = open ? '\u2212' : '+';
      });
    }
    var refresh = document.getElementById('mi-social-thesis-refresh');
    if (refresh) refresh.addEventListener('click', function (e) {
      e.stopPropagation();
      fetchSocialThesisAlerts();
    });
    fetchSocialThesisAlerts();
  }

  function renderConvergence(data) {
    LAST_CONV_DATA = data;
    var allRows = Array.isArray(data.rows) ? data.rows : [];
    var tag = CONVERGENCE_STATE.tag || 'all';
    var q = (CONVERGENCE_STATE.search || '').trim().toLowerCase();
    var rows = allRows;
    if (tag !== 'all') rows = rows.filter(function (r) { return rowMatchesTag(r, tag); });
    if (q) {
      rows = rows.filter(function (r) {
        return (String(r.symbol || '').toLowerCase().indexOf(q) !== -1) ||
               (String(r.name || '').toLowerCase().indexOf(q) !== -1) ||
               (String(r.sector || '').toLowerCase().indexOf(q) !== -1);
      });
    }
    var counts = data.tier_counts || {};
    var summary = document.getElementById('mi-convergence-summary');
    var count = document.getElementById('mi-convergence-count');
    if (summary) {
      summary.textContent = 'T1 ' + (counts.tier1 || 0) + ' · T2 ' + (counts.tier2 || 0) +
        ' · T3 ' + (counts.tier3 || 0) + ' · ' + (data.as_of || 'n/a');
    }
    if (count) {
      var filtered = (tag !== 'all') || q;
      count.textContent = 'setups: ' + allRows.length + (filtered ? ' (showing ' + rows.length + ')' : '');
    }

    var tbody = document.querySelector('#mi-convergence-table tbody');
    if (!tbody) return;
    tbody.textContent = '';
    if (!rows.length) {
      var empty = el('tr');
      var td = el('td', 'mi-operator-empty', 'No convergence setups for this filter. Run the eigen lab to refresh.');
      td.colSpan = 7;
      empty.appendChild(td); tbody.appendChild(empty);
      return;
    }

    var maxScore = rows.reduce(function (m, r) { return Math.max(m, Number(r.convergence_score) || 0); }, 1);
    rows.forEach(function (row, idx) {
      var tr = el('tr', 'mi-conv-row' + (row.narrative_only ? ' mi-conv-narrative' : ''));
      tr.setAttribute('data-symbol', String(row.symbol || '').toUpperCase());
      tr.appendChild(el('td', '', String(idx + 1)));

      var symbolCell = el('td', 'mi-conv-symcell');
      symbolCell.appendChild(scannerLink(String(row.symbol || '?'), 'mi-open-scanner-link mi-scanner-symbol-link'));
      tr.appendChild(symbolCell);

      var arrow = row.direction === 'bullish' ? '\u25B2' : row.direction === 'bearish' ? '\u25BC' : row.narrative_only ? '\u25C9' : '\u2013';
      tr.appendChild(el('td', convDirClass(row.direction), arrow));

      var scoreCell = el('td');
      var scoreWrap = el('div', 'mi-conv-score-cell');
      var bar = el('div', 'mi-conv-score-bar');
      bar.style.width = Math.max(4, Math.round((Number(row.convergence_score) || 0) / maxScore * 60)) + 'px';
      scoreWrap.appendChild(bar);
      scoreWrap.appendChild(el('span', '', Number(row.convergence_score || 0).toFixed(1)));
      scoreCell.appendChild(scoreWrap);
      tr.appendChild(scoreCell);

      var tierCell = el('td');
      if (row.narrative_only) {
        tierCell.appendChild(el('span', 'mi-conv-badge mi-conv-narrative-badge', 'narrative'));
      } else {
        tierCell.appendChild(el('span', 'mi-conv-badge mi-conv-tier' + (row.tier || 3),
          'T' + (row.tier || 3) + ' · ' + (row.aligned_count || 0)));
      }
      tr.appendChild(tierCell);

      var votesCell = el('td');
      if (row.narrative_only) {
        var sc = (row.overlays && row.overlays.social_context) || {};
        votesCell.appendChild(el('span', 'mi-conv-chip', 'buzz z ' + Number(sc.z_score || 0).toFixed(1)));
        votesCell.appendChild(el('span', 'mi-conv-chip', 'unconfirmed'));
      } else {
        votesCell.appendChild(renderConvVoteChips(row.votes));
        var fadeChip = renderFadeBadge(row.overlays && row.overlays.fade);
        if (fadeChip) votesCell.appendChild(fadeChip);
        var contraChip = renderContrarianBadge(row.overlays && row.overlays.contrarian);
        if (contraChip) votesCell.appendChild(contraChip);
        var rvChip = renderRealVolChip(row.overlays && row.overlays.real_volume);
        if (rvChip) votesCell.appendChild(rvChip);
        var peChip = renderPriceStretchChip(row.overlays && row.overlays.price_extension);
        if (peChip) votesCell.appendChild(peChip);
      }
      tr.appendChild(votesCell);

      tr.appendChild(el('td', '', row.sector || '-'));

      var detailTr = null;
      tr.addEventListener('click', function (e) {
        if (e.target && (e.target.tagName === 'A')) return;
        if (detailTr && detailTr.parentNode) {
          detailTr.parentNode.removeChild(detailTr);
          detailTr = null;
          return;
        }
        detailTr = el('tr', 'mi-conv-detail');
        var dtd = el('td');
        dtd.colSpan = 7;
        dtd.appendChild(renderConvDetail(row));
        detailTr.appendChild(dtd);
        tr.parentNode.insertBefore(detailTr, tr.nextSibling);
      });

      tbody.appendChild(tr);
    });

    // Decorate from whatever is already cached, then refresh the cache so the
    // ⚠ thesis flags appear automatically (no click). Auto-scan after a
    // convergence run keeps this populated.
    decorateThesisFlags();
    THESIS_POLLS = 0;
    fetchConvergenceTheses();
  }

  function initConvergenceScoreboard() {
    var section = document.getElementById('mi-convergence-section');
    var header = document.getElementById('mi-convergence-header');
    var toggle = document.getElementById('mi-convergence-toggle');
    if (!section || !header || !toggle) return;

    function setExpanded(open) {
      section.classList.toggle('expanded', open);
      toggle.textContent = open ? '\u2212' : '+';
      if (open && !CONVERGENCE_LOADED) {
        CONVERGENCE_LOADED = true;
        fetchConvergence();
      }
    }
    header.addEventListener('click', function (e) {
      if (e.target && e.target.tagName === 'BUTTON' && e.target !== toggle) return;
      setExpanded(!section.classList.contains('expanded'));
    });

    var refresh = document.getElementById('mi-convergence-refresh');
    if (refresh) refresh.addEventListener('click', function (e) {
      e.stopPropagation();
      CONVERGENCE_LOADED = true;
      fetchConvergence();
    });

    document.querySelectorAll('.mi-conv-tier-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        CONVERGENCE_STATE.tier = Number(btn.getAttribute('data-conv-tier')) || 0;
        document.querySelectorAll('.mi-conv-tier-btn').forEach(function (b) {
          b.classList.toggle('active', b === btn);
        });
        CONVERGENCE_LOADED = true;
        fetchConvergence();
      });
    });

    // Tag filter (fade / bottom-watch) is client-side over the loaded rows —
    // re-render in place, no refetch.
    document.querySelectorAll('.mi-conv-tag-btn').forEach(function (btn) {
      if (btn.id === 'mi-conv-search-clear') return;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        CONVERGENCE_STATE.tag = btn.getAttribute('data-conv-tag') || 'all';
        document.querySelectorAll('.mi-conv-tag-btn[data-conv-tag]').forEach(function (b) {
          b.classList.toggle('active', b === btn);
        });
        if (LAST_CONV_DATA) renderConvergence(LAST_CONV_DATA);
        else { CONVERGENCE_LOADED = true; fetchConvergence(); }
      });
    });

    // Symbol/sector search: instant client-side filter over loaded rows, plus a
    // debounced server fetch (q=) so low-score names outside the top-150 surface.
    var searchInput = document.getElementById('mi-conv-search');
    var searchClear = document.getElementById('mi-conv-search-clear');
    var searchTimer = null;
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        CONVERGENCE_STATE.search = searchInput.value || '';
        if (LAST_CONV_DATA) renderConvergence(LAST_CONV_DATA);
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          CONVERGENCE_LOADED = true;
          fetchConvergence();
        }, 250);
      });
      searchInput.addEventListener('click', function (e) { e.stopPropagation(); });
    }
    if (searchClear) {
      searchClear.addEventListener('click', function (e) {
        e.stopPropagation();
        CONVERGENCE_STATE.search = '';
        if (searchInput) searchInput.value = '';
        CONVERGENCE_LOADED = true;
        fetchConvergence();
      });
    }

    setExpanded(section.classList.contains('expanded'));
  }

  // ---- Base-Break Cause Extractor ------------------------------------------
  function renderCauseResults(results) {
    var host = document.getElementById('mi-cause-results');
    if (!host) return;
    host.textContent = '';
    if (!results || !results.length) {
      host.appendChild(el('div', 'mi-operator-empty', 'No results.'));
      return;
    }
    results.forEach(function (r) {
      var p = r.price || {};
      var f = r.fundamental || {};
      var ll = r.lead_lag || {};
      var card = el('div', 'mi-operator-card');
      card.style.marginTop = '10px';
      card.style.maxWidth = '100%';

      var head = el('div', 'mi-operator-card-header');
      var title = el('span');
      title.appendChild(scannerLink(r.symbol, 'mi-scanner-symbol-link', r.symbol));
      head.appendChild(title);
      var verdict = String(ll.verdict || 'indeterminate');
      var vColor = verdict === 'fundamentals_led_price' ? '#39d98a'
        : verdict === 'price_led_fundamentals' ? '#ff5c7a'
        : verdict === 'coincident' ? '#f5a623' : 'var(--color-text-subtle)';
      var badge = el('span', '', verdict.replace(/_/g, ' '));
      badge.style.color = vColor;
      badge.style.fontFamily = 'var(--font-mono)';
      badge.style.fontSize = '11px';
      badge.style.textTransform = 'uppercase';
      head.appendChild(badge);
      card.appendChild(head);

      var rows = [];
      if (p.detected) {
        rows.push(['PRICE', 'base ' + p.base_low + '–' + p.base_high + ' (tightness ' + p.base_tightness_ratio + 'x), broke out ' + p.breakout_date + ', now ' + p.last_price + ' (+' + p.run_vs_base_median_pct + '% vs base median)']);
      } else {
        rows.push(['PRICE', 'no base-break detected' + (p.reason ? ' — ' + p.reason : '')]);
      }
      if (f.detected) {
        rows.push(['CAUSE', r.cause || '']);
        rows.push(['INFLECTION Q', String(f.inflection_quarter_end || '?')]);
      } else {
        var fline = 'no fundamental inflection' + (f.reason ? ' — ' + f.reason : '');
        if (f.trough_quarter_end) {
          fline += ' (trough ' + f.trough_sales + ' @ ' + f.trough_quarter_end + ', latest ' + f.latest_sales + ' @ ' + f.latest_quarter_end + ', off-trough ' + f.off_trough_pct + '%)';
        }
        rows.push(['FUNDAMENTAL', fline]);
      }
      if (ll.verdict && ll.verdict !== 'indeterminate') {
        rows.push(['LEAD/LAG', 'fundamentals public ~' + ll.inflection_public_est + ' vs breakout ' + ll.breakout_date + ' → fundamentals led by ' + ll.fundamental_lead_days + ' days']);
      }

      rows.forEach(function (kv) {
        var line = el('div');
        line.style.display = 'flex';
        line.style.gap = '10px';
        line.style.padding = '4px 0';
        line.style.borderTop = '1px solid var(--color-border)';
        var k = el('span', '', kv[0]);
        k.style.minWidth = '110px';
        k.style.color = 'var(--color-text-subtle)';
        k.style.fontFamily = 'var(--font-mono)';
        k.style.fontSize = '10px';
        k.style.textTransform = 'uppercase';
        var v = el('span', '', kv[1]);
        v.style.fontSize = '12px';
        v.style.lineHeight = '1.5';
        line.appendChild(k);
        line.appendChild(v);
        card.appendChild(line);
      });
      host.appendChild(card);
    });
  }

  function fetchBaseBreakCause(symbols) {
    var host = document.getElementById('mi-cause-results');
    var summary = document.getElementById('mi-cause-summary');
    if (host) { host.textContent = ''; host.appendChild(el('div', 'mi-operator-empty', 'Extracting… (~5s)')); }
    if (summary) summary.textContent = 'running…';
    return fetch(API_BASE + '/base-break-cause/' + encodeURIComponent(symbols), { headers: { 'Accept': 'application/json' } })
      .then(function (res) { return res.json(); })
      .then(function (payload) {
        if (!payload || !payload.success) {
          throw new Error((payload && payload.error) || 'Extractor failed');
        }
        var results = (payload.data && payload.data.results) || [];
        renderCauseResults(results);
        if (summary) summary.textContent = results.length + ' symbol' + (results.length === 1 ? '' : 's');
      })
      .catch(function (err) {
        showOperatorToast('mi-cause-toast', 'Failed: ' + err.message, true);
        if (host) { host.textContent = ''; host.appendChild(el('div', 'mi-operator-empty', 'Failed: ' + err.message)); }
        if (summary) summary.textContent = 'error';
      });
  }

  function initBaseBreakCause() {
    var section = document.getElementById('mi-cause-section');
    var header = document.getElementById('mi-cause-header');
    var toggle = document.getElementById('mi-cause-toggle');
    if (!section || !header || !toggle) return;

    function setExpanded(open) {
      section.classList.toggle('expanded', open);
      toggle.textContent = open ? '\u2212' : '+';
    }
    header.addEventListener('click', function (e) {
      if (e.target && e.target.tagName === 'BUTTON' && e.target !== toggle) return;
      if (e.target && e.target.tagName === 'INPUT') return;
      setExpanded(!section.classList.contains('expanded'));
    });

    function run() {
      var input = document.getElementById('mi-cause-input');
      var raw = (input && input.value || '').trim();
      if (!raw) { showOperatorToast('mi-cause-toast', 'Enter at least one symbol.', true); return; }
      fetchBaseBreakCause(raw.toUpperCase());
    }
    var runBtn = document.getElementById('mi-cause-run');
    if (runBtn) runBtn.addEventListener('click', function (e) { e.stopPropagation(); run(); });
    var input = document.getElementById('mi-cause-input');
    if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  }

  function fetchReaccelerationScreen() {
    return fetch(API_BASE + '/reacceleration-screen/latest?limit=100&min_dollar_volume=1000000', {
      headers: { 'Accept': 'application/json' }
    })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        if (!payload || payload.success !== true) {
          throw new Error((payload && payload.error) || 'Malformed reacceleration response');
        }
        renderReaccelerationScreen(payload.data || {});
      })
      .catch(function (err) {
        showOperatorToast('mi-eigen-toast', 'Reacceleration screen failed: ' + err.message, true);
      });
  }

  function renderReaccelerationScreen(data) {
    var meta = data.meta || {};
    var rows = Array.isArray(data.rows) ? data.rows : [];
    var summary = document.getElementById('mi-reacceleration-summary');
    var rule = document.getElementById('mi-reacceleration-rule');
    if (summary) {
      summary.textContent = 'matches: ' + Number(meta.total_matches || rows.length || 0).toLocaleString() +
        ' · shown: ' + Number(rows.length || 0).toLocaleString();
    }
    if (rule) {
      var screen = meta.screen || {};
      rule.textContent = 'as of ' + (meta.as_of || '-') +
        ' · clean universe ' + Number(meta.symbols_in_clean_universe || 0).toLocaleString() +
        ' · range <= ' + Number(screen.range_pos_252d_lte ?? 0.10).toFixed(2) +
        ' · rev TTM >= ' + Number(screen.revenue_ttm_growth_pct_gte ?? 17.7).toFixed(1) + '%' +
        ' · liquidity >= ' + formatCompactMoney(screen.dollar_volume_63d_gte ?? 1000000);
    }
    var tbody = document.querySelector('#mi-reacceleration-table tbody');
    if (!tbody) return;
    tbody.textContent = '';
    if (!rows.length) {
      var empty = el('tr');
      var td = el('td', 'mi-operator-empty', 'No depressed revenue reacceleration matches at the current thresholds.');
      td.colSpan = 8;
      empty.appendChild(td);
      tbody.appendChild(empty);
      return;
    }
    rows.slice(0, 100).forEach(function (row) {
      var tr = el('tr');
      var symbolCell = el('td');
      symbolCell.appendChild(scannerLink(row.symbol || '?', 'mi-open-scanner-link mi-scanner-symbol-link'));
      tr.appendChild(symbolCell);
      tr.appendChild(el('td', '', formatPrice(row.price)));
      tr.appendChild(el('td', '', Number(row.range_pos_252d || 0).toFixed(3)));
      tr.appendChild(el('td', '', formatPct(row.revenue_ttm_growth_pct)));
      tr.appendChild(el('td', '', formatCompactMoney(row.dollar_volume_63d)));
      tr.appendChild(el('td', '', row.current_ratio == null ? '-' : Number(row.current_ratio).toFixed(2)));
      tr.appendChild(el('td', '', row.net_margin_latest_pct == null ? '-' : formatPct(row.net_margin_latest_pct)));
      tr.appendChild(el('td', '', Array.isArray(row.quality_flags) && row.quality_flags.length ? row.quality_flags.join(', ') : 'watch'));
      tbody.appendChild(tr);
    });
  }

  function renderEigenPressureTable(rows) {
    var tbody = document.querySelector('#mi-eigen-pressure-table tbody');
    if (!tbody) return;
    tbody.textContent = '';
    if (!rows.length) {
      var empty = el('tr');
      var td = el('td', 'mi-operator-empty', 'No pre-explosion pressure setups in the latest eigen scan.');
      td.colSpan = 9;
      empty.appendChild(td);
      tbody.appendChild(empty);
      return;
    }
    rows.slice(0, 50).forEach(function (row) {
      var tr = el('tr');
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', function () { openEigenInvestigation(String(row.symbol || '')); });
      var symbolCell = el('td');
      symbolCell.appendChild(scannerLink(row.symbol || '?', 'mi-open-scanner-link mi-scanner-symbol-link'));
      tr.appendChild(symbolCell);
      tr.appendChild(el('td', '', Number(row.residual_z || 0).toFixed(2)));
      tr.appendChild(el('td', '', Number(row.residual_z_change_1d || 0).toFixed(2)));
      tr.appendChild(el('td', '', Number(row.residual_z_slope_3d || 0).toFixed(2)));
      tr.appendChild(el('td', '', formatPct(row.actual_return_pct)));
      tr.appendChild(el('td', '', formatPct(row.unexplained_return_pct)));
      tr.appendChild(el('td', '', formatEigenOptions(row.options_flow)));
      tr.appendChild(el('td', '', formatEigenValuation(row.valuation)));
      tr.appendChild(el('td', '', String(row.cross_signal_count || 0)));
      tbody.appendChild(tr);
    });
  }

  function eigenMetricTile(label, value, color) {
    return '<div style="padding:6px 8px;border-radius:6px;background:var(--color-surface-hover);text-align:center;">' +
      '<div style="font-size:9px;color:var(--color-text-subtle);text-transform:uppercase;">' + esc(label) + '</div>' +
      '<div style="font-size:14px;font-weight:700;font-family:var(--font-mono);' + (color ? 'color:' + color + ';' : '') + '">' + esc(value) + '</div>' +
      '</div>';
  }

  function renderEigenInvestigationReport(report, activeSymbol) {
    var knownSymbols = [activeSymbol || report.symbol || report.eigen?.symbol].filter(Boolean);
    var html = '';
    if (report.narrative) {
      html += '<div style="margin-bottom:16px;padding:14px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid var(--color-border);line-height:1.6;">';
      var briefLabel = report.cache_hit || report.precompiled ? 'Precompiled Investigation Brief' : 'Investigation Brief';
      html += '<div style="font-size:11px;color:var(--color-text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">' + esc(briefLabel) + '</div>';
      String(report.narrative).split('\n\n').forEach(function (p) {
        if (p.trim()) html += '<p style="margin:0 0 10px 0;font-size:12.5px;color:var(--color-text);">' + linkKnownSymbolsHtml(p.trim(), knownSymbols) + '</p>';
      });
      html += '</div>';
    }
    var v = report.verdict || {};
    var riskColor = v.risk_level === 'HIGH' ? '#f59e0b' : v.risk_level === 'ELEVATED' ? '#eab308' : '#6b7280';
    html += '<div style="margin-bottom:16px;padding:12px;border-radius:8px;border:1px solid ' + riskColor + '33;background:' + riskColor + '0a;">';
    html += '<div style="font-size:13px;font-weight:700;color:' + riskColor + ';margin-bottom:6px;">VERDICT: ' + esc(v.risk_level || 'LOW') + '</div>';
    if (Array.isArray(v.signals) && v.signals.length) {
      html += '<ul style="margin:0;padding-left:16px;font-size:12px;color:var(--color-text-muted);">';
      v.signals.forEach(function (s) { html += '<li style="margin-bottom:3px;">' + linkKnownSymbolsHtml(s, knownSymbols) + '</li>'; });
      html += '</ul>';
    }
    html += '</div>';

    var e = report.eigen || {};
    html += '<div style="margin-bottom:16px;">';
    html += '<div class="mi-drawer-section-title">Eigen Pressure</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">';
    html += eigenMetricTile('Residual Z', Number(e.residual_z || 0).toFixed(2), '#a78bfa');
    html += eigenMetricTile('Z Change', Number(e.residual_z_change_1d || 0).toFixed(2), '#a78bfa');
    html += eigenMetricTile('3D Slope', Number(e.residual_z_slope_3d || 0).toFixed(2), '#a78bfa');
    html += eigenMetricTile('Return', formatPct(e.actual_return_pct));
    html += eigenMetricTile('Unexplained', formatPct(e.unexplained_return_pct));
    html += eigenMetricTile('Setup', report.setup_label || '-');
    html += '</div></div>';

    var c = report.catalyst_evidence || {};
    html += '<div style="margin-bottom:16px;">';
    html += '<div class="mi-drawer-section-title">Catalyst Evidence</div>';
    if (Array.isArray(c.source_summary) && c.source_summary.length) {
      html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;">';
      html += eigenMetricTile('Evidence Items', Array.isArray(c.items) ? String(c.items.length) : '0');
      html += eigenMetricTile('Reliable', c.reliable_item_count != null ? String(c.reliable_item_count) : '0', Number(c.reliable_item_count || 0) === 0 ? '#f59e0b' : null);
      html += eigenMetricTile('Source Buckets', String(c.source_summary.length));
      html += '</div>';
      if (Array.isArray(c.quality_flags) && c.quality_flags.length) {
        html += '<div style="margin-bottom:8px;display:flex;gap:4px;flex-wrap:wrap;">';
        c.quality_flags.forEach(function (flag) {
          html += '<span style="padding:2px 6px;border-radius:4px;font-size:10px;background:rgba(245,158,11,0.12);color:#fbbf24;border:1px solid rgba(245,158,11,0.25);">' + esc(flag) + '</span>';
        });
        html += '</div>';
      }
      (c.items || []).slice(0, 5).forEach(function (item) {
        var label = [item.source_type, item.source_community].filter(Boolean).join(' / ');
        var title = item.title || item.matched_text || 'evidence item';
        html += '<div style="padding:8px 0;border-top:1px solid var(--color-border-subtle);">';
        html += '<div style="font-size:10px;color:var(--color-text-subtle);text-transform:uppercase;">' + esc(label) + (item.alias_risk ? ' · ALIAS RISK' : '') + '</div>';
        html += '<div style="font-size:12px;color:var(--color-text);font-weight:600;margin-top:3px;">' + esc(title) + '</div>';
        if (item.excerpt) html += '<div style="font-size:11px;color:var(--color-text-muted);line-height:1.45;margin-top:3px;">' + linkKnownSymbolsHtml(item.excerpt, knownSymbols) + '</div>';
        if (item.source_url) html += '<a href="' + esc(item.source_url) + '" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:4px;font-size:11px;color:var(--color-accent);">Open source</a>';
        html += '</div>';
      });
    } else {
      html += '<div class="mi-operator-empty">No local catalyst evidence sampled for this symbol yet.</div>';
    }
    html += '</div>';

    var sb = report.social_buzz || {};
    var sa = report.social_eigen_alignment || {};
    html += '<div style="margin-bottom:16px;">';
    html += '<div class="mi-drawer-section-title">Social Buzz Confirmation</div>';
    if (sb.available) {
      var socialColor = sa.status === 'social_confirmed' ? '#4ade80' :
        sa.status === 'social_supportive' ? '#a3e635' :
        sa.status === 'social_stale_or_divergent' ? '#f59e0b' :
        '#6b7280';
      html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;">';
      html += eigenMetricTile('Alignment', sa.status || 'N/A', socialColor);
      html += eigenMetricTile('Score', sa.score == null ? 'N/A' : Number(sa.score).toFixed(1), socialColor);
      html += eigenMetricTile('Social Day', sb.latest_trade_date || 'N/A');
      html += eigenMetricTile('7D Mentions', sb.mention_count_7d == null ? 'N/A' : String(sb.mention_count_7d));
      html += eigenMetricTile('7D Authors', sb.unique_authors_7d == null ? 'N/A' : String(sb.unique_authors_7d));
      html += eigenMetricTile('Sentiment', sb.weighted_sentiment == null && sb.net_sentiment == null ? 'N/A' : Number(sb.weighted_sentiment != null ? sb.weighted_sentiment : sb.net_sentiment).toFixed(2));
      html += '</div>';
      if (sb.buzz_score) {
        html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;">';
        html += eigenMetricTile('Buzz Score', sb.buzz_score.final_buzz_score == null ? 'N/A' : Number(sb.buzz_score.final_buzz_score).toFixed(1));
        html += eigenMetricTile('Validity', sb.buzz_score.score_validity || 'N/A', sb.buzz_score.is_score_valid ? '#4ade80' : '#f59e0b');
        html += eigenMetricTile('Platforms', Array.isArray(sb.platforms) && sb.platforms.length ? sb.platforms.join(' + ') : 'N/A');
        html += '</div>';
      }
      if (Array.isArray(sa.signals) && sa.signals.length) {
        html += '<ul style="margin:0 0 8px 0;padding-left:16px;font-size:11px;color:var(--color-text-muted);">';
        sa.signals.forEach(function (signal) { html += '<li style="margin-bottom:3px;">' + linkKnownSymbolsHtml(signal, knownSymbols) + '</li>'; });
        html += '</ul>';
      }
      if (Array.isArray(sb.recent_messages) && sb.recent_messages.length) {
        sb.recent_messages.slice(0, 4).forEach(function (msg) {
          html += '<div style="padding:7px 0;border-top:1px solid var(--color-border-subtle);">';
          html += '<div style="font-size:10px;color:var(--color-text-subtle);text-transform:uppercase;">' + esc(msg.source || 'social') + (msg.posted_at ? ' · ' + esc(msg.posted_at) : '') + '</div>';
          html += '<div style="font-size:11px;color:var(--color-text-muted);line-height:1.45;margin-top:3px;">' + linkKnownSymbolsHtml(msg.body || '', knownSymbols) + '</div>';
          html += '</div>';
        });
      }
    } else {
      html += '<div class="mi-operator-empty">No usable ticker-indexed social buzz snapshot yet. This setup has no social confirmation.</div>';
    }
    html += '</div>';

    var w = report.web_catalyst_check || {};
    html += '<div style="margin-bottom:16px;">';
    html += '<div class="mi-drawer-section-title">Web Catalyst Check</div>';
    if (Array.isArray(w.sources) && w.sources.length) {
      html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;">';
      html += eigenMetricTile('Web Sources', String(w.sources.length));
      html += eigenMetricTile('Status', w.status || 'ok');
      html += eigenMetricTile('Queries', Array.isArray(w.queries) ? String(w.queries.length) : '0');
      html += '</div>';
      if (Array.isArray(w.quality_flags) && w.quality_flags.length) {
        html += '<div style="margin-bottom:8px;display:flex;gap:4px;flex-wrap:wrap;">';
        w.quality_flags.forEach(function (flag) {
          html += '<span style="padding:2px 6px;border-radius:4px;font-size:10px;background:rgba(96,165,250,0.12);color:#93c5fd;border:1px solid rgba(96,165,250,0.25);">' + esc(flag) + '</span>';
        });
        html += '</div>';
      }
      w.sources.slice(0, 6).forEach(function (source) {
        var label = [source.source_type, source.source].filter(Boolean).join(' / ');
        html += '<div style="padding:8px 0;border-top:1px solid var(--color-border-subtle);">';
        html += '<div style="font-size:10px;color:var(--color-text-subtle);text-transform:uppercase;">' + esc(label) + (source.published_at ? ' · ' + esc(source.published_at) : '') + '</div>';
        html += '<div style="font-size:12px;color:var(--color-text);font-weight:600;margin-top:3px;">' + esc(source.title || 'web source') + '</div>';
        if (source.snippet) html += '<div style="font-size:11px;color:var(--color-text-muted);line-height:1.45;margin-top:3px;">' + linkKnownSymbolsHtml(source.snippet, knownSymbols) + '</div>';
        if (source.url) html += '<a href="' + esc(source.url) + '" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:4px;font-size:11px;color:var(--color-accent);">Open source</a>';
        html += '</div>';
      });
    } else {
      html += '<div class="mi-operator-empty">No open-web catalyst corroboration found yet. Treat local catalyst claims as unverified.</div>';
    }
    html += '</div>';

    var o = report.options_flow;
    html += '<div style="margin-bottom:16px;">';
    html += '<div class="mi-drawer-section-title">Options Confirmation</div>';
    if (o) {
      html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">';
      html += eigenMetricTile('Bias', o.flow_bias || '-');
      html += eigenMetricTile('Tier', o.imbalance_tier || '-');
      html += eigenMetricTile('Trade Date', o.trade_date || '-');
      html += eigenMetricTile('C/P', Number(o.call_put_volume_ratio || 0).toFixed(2), o.flow_bias === 'call_heavy' ? '#4ade80' : null);
      html += eigenMetricTile('P/C', Number(o.put_call_volume_ratio || 0).toFixed(2), o.flow_bias === 'put_heavy' ? '#ef4444' : null);
      html += eigenMetricTile('IV Skew', o.iv_skew == null ? 'N/A' : ((o.iv_skew > 0 ? '+' : '') + (o.iv_skew * 100).toFixed(1) + '%'));
      html += '</div>';
    } else {
      html += '<div class="mi-operator-empty">No local options snapshot available. This is a data coverage gap, not evidence of low options interest.</div>';
    }
    html += '</div>';

    var f = report.fundamentals || {};
    html += '<div style="margin-bottom:16px;">';
    html += '<div class="mi-drawer-section-title">Ledger Cross-Check</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">';
    html += eigenMetricTile('Valuation', f.valuation_state || 'N/A');
    html += eigenMetricTile('Gap', f.valuation_gap_pct == null ? 'N/A' : Number(f.valuation_gap_pct).toFixed(1) + '%');
    html += eigenMetricTile('Engine', f.valuation_engine || 'N/A');
    html += eigenMetricTile('Quality', f.quality_grade || f.quality_score || 'N/A');
    html += eigenMetricTile('Rev Growth', f.revenue_growth_pct == null ? 'N/A' : Number(f.revenue_growth_pct).toFixed(1) + '%');
    html += eigenMetricTile('Forward', f.forward_signal || f.forward_score || 'N/A');
    html += '</div></div>';
    return html;
  }

  function openEigenInvestigation(symbol) {
    if (!symbol) return;
    var backdrop = document.getElementById('mi-drawer-backdrop');
    var drawer = document.getElementById('mi-drawer');
    var drawerName = document.getElementById('mi-drawer-name');
    var drawerSummary = document.getElementById('mi-drawer-summary');
    var drawerBody = document.getElementById('mi-drawer-body');
    var drawerEngineRow = document.getElementById('mi-drawer-engine-row');
    if (!drawer || !drawerBody) return;
    drawerName.innerHTML = scannerLinkHtml(symbol, 'mi-scanner-symbol-link') + ' — Eigen Investigation';
    drawerSummary.textContent = 'Loading precompiled report if available...';
    drawerEngineRow.innerHTML = '<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#a78bfa;"><span style="width:8px;height:8px;border-radius:50%;background:#a78bfa;display:inline-block;"></span> Eigen Perturbation Engine</span>';
    drawerBody.innerHTML = '<div style="padding:20px;color:var(--color-text-muted);">Loading investigation for ' + scannerLinkHtml(symbol, 'mi-scanner-symbol-link') + '...</div>';
    drawer.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
    fetch(API_BASE + '/eigen-perturbations/' + encodeURIComponent(symbol) + '/report', {
      headers: { 'Accept': 'application/json' }
    })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        if (!payload || payload.success !== true || !payload.data) {
          throw new Error((payload && payload.error) || 'Report unavailable');
        }
        drawerSummary.textContent = ((payload.data.cache_hit || payload.data.precompiled) ? 'Precompiled report ready. ' : '') +
          ((payload.data.verdict && payload.data.verdict.summary) || 'Report generated.');
        drawerBody.innerHTML = renderEigenInvestigationReport(payload.data, symbol);
      })
      .catch(function (err) {
        drawerBody.innerHTML = '<div style="padding:20px;color:#f87171;">Failed to load eigen report: ' + esc(err.message || String(err)) + '</div>';
      });
  }

  function runEigenScanNow() {
    showOperatorToast('mi-eigen-toast', 'Started eigen_perturbation_scan. Refresh this panel after the job finishes.', false);
    fetch(API_BASE + '/scheduler/jobs/eigen_perturbation_scan/run', {
      method: 'POST',
      headers: { 'Accept': 'application/json' }
    })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        if (!payload || payload.success !== true) {
          throw new Error((payload && payload.error) || 'Run failed');
        }
        showOperatorToast('mi-eigen-toast', 'eigen_perturbation_scan queued.', false);
      })
      .catch(function (err) {
        showOperatorToast('mi-eigen-toast', 'Run failed: ' + err.message, true);
      });
  }

  function updateOperatorSummary() {
    var n = document.getElementById('mi-operator-summary');
    if (n) n.textContent = 'rules: ' + OPERATOR_STATE.tracked.total +
      ' \u00b7 promotion queue: ' + OPERATOR_STATE.emerging.items.length;
    var tc = document.getElementById('mi-tracked-count');
    if (tc) tc.textContent = OPERATOR_STATE.tracked.items.length + ' / ' + OPERATOR_STATE.tracked.total;
    var ec = document.getElementById('mi-emerging-count');
    if (ec) ec.textContent = String(OPERATOR_STATE.emerging.items.length);
  }

  function renderTrackedTable() {
    var tbody = document.querySelector('#mi-tracked-table tbody');
    if (!tbody) return;
    tbody.textContent = '';
    if (!OPERATOR_STATE.tracked.items.length) {
      var tr = el('tr');
      var td = el('td', 'mi-operator-empty', 'No listening rules match the current filters.');
      td.colSpan = 7;
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    OPERATOR_STATE.tracked.items.forEach(function (c) {
      var tr = el('tr', 'status-' + (c.status || 'active'));
      tr.appendChild(el('td', '', String(c.id)));
      var keyCell = el('td', '', c.concept_key);
      keyCell.title = c.display_label || '';
      tr.appendChild(keyCell);
      tr.appendChild(el('td', '', c.target_type));
      tr.appendChild(el('td', '', c.target_key));
      tr.appendChild(el('td', '', String(c.rolling_28d_hits || 0)));
      tr.appendChild(el('td', '', c.status || 'active'));

      var actions = el('td');
      var actionsRow = el('div', 'mi-operator-actions');
      if (c.status !== 'pruned') {
        var pruneBtn = el('button', 'mi-operator-btn danger', 'Prune');
        pruneBtn.addEventListener('click', function () { confirmAndUpdateStatus(c, 'pruned'); });
        actionsRow.appendChild(pruneBtn);
      }
      if (c.status !== 'merged') {
        var mergeBtn = el('button', 'mi-operator-btn warn', 'Merge');
        mergeBtn.addEventListener('click', function () { confirmAndUpdateStatus(c, 'merged'); });
        actionsRow.appendChild(mergeBtn);
      }
      if (c.status !== 'active') {
        var actBtn = el('button', 'mi-operator-btn go', 'Activate');
        actBtn.addEventListener('click', function () { confirmAndUpdateStatus(c, 'active'); });
        actionsRow.appendChild(actBtn);
      }
      actions.appendChild(actionsRow);
      tr.appendChild(actions);

      tbody.appendChild(tr);
    });
  }

  function confirmAndUpdateStatus(concept, nextStatus) {
    var body = { status: nextStatus };
    if (nextStatus === 'merged') {
      var into = window.prompt(
        'Merge "' + concept.concept_key + '" (id=' + concept.id + ') INTO which other tracked_concept id?'
      );
      if (into == null) return;
      var n = parseInt(String(into).trim(), 10);
      if (!isFinite(n) || n < 1 || n === concept.id) {
        showOperatorToast('mi-tracked-toast', 'Invalid merged_into_id', true);
        return;
      }
      body.merged_into_id = n;
    }
    var reason = window.prompt(
      'Optional audit reason for status=' + nextStatus + ' on "' + concept.concept_key + '":',
      ''
    );
    if (reason == null) return;
    if (reason) body.reason = reason;

    fetch(API_BASE + '/tracked-concepts/' + concept.id + '/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, payload: j }; }); })
      .then(function (resp) {
        if (!resp.ok || !resp.payload || resp.payload.success !== true) {
          var msg = (resp.payload && resp.payload.error) || 'HTTP error';
          showOperatorToast('mi-tracked-toast', 'Update failed: ' + msg, true);
          return;
        }
        showOperatorToast(
          'mi-tracked-toast',
          'concept_id=' + concept.id + ' set to ' + nextStatus,
          false
        );
        return fetchTrackedConcepts();
      });
  }

  function renderEmergingTable() {
    var tbody = document.querySelector('#mi-emerging-table tbody');
    if (!tbody) return;
    tbody.textContent = '';
    if (!OPERATOR_STATE.emerging.items.length) {
      var tr = el('tr');
      var td = el('td', 'mi-operator-empty', 'No promotion-queue topics match the current filter.');
      td.colSpan = 7;
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    OPERATOR_STATE.emerging.items.forEach(function (et) {
      var tr = el('tr');
      tr.appendChild(el('td', '', String(et.id)));
      var conceptInfo = (et.concept && typeof et.concept === 'object') ? et.concept : null;
      var conceptKey = (conceptInfo && conceptInfo.concept_key) || et.concept_key || '?';
      var displayLabel = (conceptInfo && conceptInfo.display_label) || et.display_label || '';
      var conceptCell = el('td', '', conceptKey);
      conceptCell.title = displayLabel;
      tr.appendChild(conceptCell);
      tr.appendChild(el('td', '', et.peak_z_score == null ? '—' : Number(et.peak_z_score).toFixed(2)));
      tr.appendChild(el('td', '', et.authenticity_score == null ? '—' : Number(et.authenticity_score).toFixed(2)));
      var tickSymbols = [];
      if (Array.isArray(et.resolved_tickers)) {
        tickSymbols = et.resolved_tickers
          .map(function (rt) { return (rt && (rt.ticker || rt.symbol)) || String(rt); })
          .filter(Boolean);
      } else if (Array.isArray(et.resolved_tickers_json)) {
        tickSymbols = et.resolved_tickers_json;
      }
      var tickerCell = el('td');
      appendTickerLinks(tickerCell, tickSymbols, 'mi-open-scanner-link mi-scanner-symbol-link');
      tr.appendChild(tickerCell);
      var state = et.seeded_situation_id
        ? 'promoted (sit=' + et.seeded_situation_id + ')'
        : (et.suppression_reason ? 'suppressed: ' + et.suppression_reason : 'pending');
      tr.appendChild(el('td', '', state));

      var actions = el('td');
      var actionsRow = el('div', 'mi-operator-actions');
      var promoteBtn = el('button', 'mi-operator-btn go', 'Promote');
      promoteBtn.addEventListener('click', function () { promoteEmerging(et, false); });
      actionsRow.appendChild(promoteBtn);
      var forceBtn = el('button', 'mi-operator-btn warn', 'Force');
      forceBtn.title = 'Force-promote even if authenticity / coverage gates would suppress';
      forceBtn.addEventListener('click', function () { promoteEmerging(et, true); });
      actionsRow.appendChild(forceBtn);
      if (et.seeded_situation_id) {
        promoteBtn.disabled = true;
        forceBtn.disabled = true;
        promoteBtn.title = 'Already promoted to situation_id=' + et.seeded_situation_id;
      }
      actions.appendChild(actionsRow);
      tr.appendChild(actions);

      tbody.appendChild(tr);
    });
  }

  function promoteEmerging(et, force) {
    var ck = (et.concept && et.concept.concept_key) || et.concept_key;
    var label = ck || ('emerging_id=' + et.id);
    var msg = (force ? 'FORCE-promote ' : 'Promote ') + label + ' (emerging_id=' + et.id + ')?';
    if (!window.confirm(msg)) return;
    fetch(API_BASE + '/emerging-topics/' + et.id + '/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ force: !!force })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, payload: j }; }); })
      .then(function (resp) {
        if (!resp.ok || !resp.payload || resp.payload.success !== true) {
          var err = (resp.payload && resp.payload.error) || 'HTTP error';
          showOperatorToast('mi-emerging-toast', 'Promote failed: ' + err, true);
          return;
        }
        showOperatorToast(
          'mi-emerging-toast',
          'Promoter spawned (pid=' + (resp.payload.data.pid || '?') +
            ', force=' + force + '). Refreshing in 2s\u2026',
          false
        );
        setTimeout(function () {
          fetchEmergingTopicsForOperator();
          loadFromApi();
        }, 2000);
      });
  }

  // ----------------------------------------------------------
  // Narrative Radar (clustered claims before scenario promotion)
  // ----------------------------------------------------------
  var NARRATIVE_LOADED = false;
  var NARRATIVE_REPORTS = {};
  var NARRATIVE_STATE = {
    items: [],
    total: 0,
    status: 'all'
  };

  function fetchNarrativeClusters() {
    var table = document.querySelector('#mi-narrative-table tbody');
    if (table) {
      table.innerHTML = '<tr><td colspan="8" class="mi-operator-empty">Loading narrative clusters...</td></tr>';
    }
    var qs = '?limit=100&status=' + encodeURIComponent(NARRATIVE_STATE.status || 'all');
    return fetch(API_BASE + '/narrative-clusters' + qs, {
      headers: { 'Accept': 'application/json' }
    })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        if (!payload || payload.success !== true) {
          throw new Error((payload && payload.error) || 'Malformed narrative-clusters response');
        }
        NARRATIVE_STATE.items = (payload.data && payload.data.items) || [];
        NARRATIVE_STATE.total = (payload.data && payload.data.total) || NARRATIVE_STATE.items.length;
        renderNarrativeClusters();
      })
      .catch(function (err) {
        showOperatorToast('mi-narrative-toast', 'Load failed: ' + err.message, true);
        if (table) {
          table.innerHTML = '<tr><td colspan="8" class="mi-operator-empty">Load failed.</td></tr>';
        }
      });
  }

  function renderNarrativeClusters() {
    var tbody = document.querySelector('#mi-narrative-table tbody');
    if (!tbody) return;
    tbody.textContent = '';

    var ready = NARRATIVE_STATE.items.filter(function (c) {
      return c.status === 'SCENARIO_READY';
    }).length;
    var summary = document.getElementById('mi-narrative-summary');
    if (summary) {
      summary.textContent = 'clusters: ' + NARRATIVE_STATE.total + ' \u00b7 ready: ' + ready;
    }
    var count = document.getElementById('mi-narrative-count');
    if (count) count.textContent = String(NARRATIVE_STATE.items.length);

    if (!NARRATIVE_STATE.items.length) {
      var empty = el('tr');
      var td = el('td', 'mi-operator-empty', 'No narrative clusters match the current filter.');
      td.colSpan = 8;
      empty.appendChild(td);
      tbody.appendChild(empty);
      return;
    }

    NARRATIVE_STATE.items.forEach(function (c) {
      var tr = el('tr', 'status-' + String(c.status || '').toLowerCase());
      tr.title = c.slug || '';

      var statusText = c.status || '?';
      if (c.promotion_situation_id) statusText += ' #' + c.promotion_situation_id;
      tr.appendChild(el('td', '', statusText));

      var narrative = el('td', 'label-cell');
      var title = el('div', '', c.title || c.slug || ('cluster ' + c.id));
      title.style.fontWeight = '600';
      var sub = el('div', '', c.summary || '');
      sub.style.color = 'var(--color-text-muted)';
      sub.style.fontSize = '10px';
      sub.style.lineHeight = '1.35';
      narrative.appendChild(title);
      narrative.appendChild(sub);
      tr.appendChild(narrative);

      tr.appendChild(el('td', '', String(c.claim_count || 0)));

      var sources = c.source_hit_count == null ? 0 : Number(c.source_hit_count);
      var breadth = c.source_breadth == null ? 'n/a' : Number(c.source_breadth).toFixed(2);
      var sourceCell = el('td', '', sources + ' / ' + breadth);
      if (Array.isArray(c.source_types) && c.source_types.length) {
        sourceCell.title = c.source_types.join(', ');
      }
      tr.appendChild(sourceCell);

      var tickers = Array.isArray(c.mapped_tickers) ? c.mapped_tickers : [];
      var mappedTickerCell = el('td');
      appendTickerLinks(mappedTickerCell, tickers, 'mi-open-scanner-link mi-scanner-symbol-link');
      tr.appendChild(mappedTickerCell);

      var flags = el('td');
      var flagList = Array.isArray(c.validity_flags) ? c.validity_flags : [];
      if (!flagList.length) {
        flags.textContent = '—';
      } else {
        flagList.slice(0, 3).forEach(function (f) {
          var chip = el('span', 'mi-flag-chip ' + flagSeverity(f), f);
          chip.title = flagTip(f);
          flags.appendChild(chip);
        });
        if (flagList.length > 3) {
          flags.appendChild(el('span', 'mi-flag-chip', '+' + (flagList.length - 3)));
        }
      }
      tr.appendChild(flags);

      var updated = c.updated_at || c.last_seen_at || c.first_seen_at;
      var updatedCell = el('td', '', fmtDateTime(updated));
      updatedCell.title = updated ? fmtAge(updated) : '';
      tr.appendChild(updatedCell);

      var actions = el('td');
      var reportBtn = el('button', 'mi-operator-btn go', 'Report');
      reportBtn.title = 'Ask Ledger to cross-check mapped tickers and evidence';
      reportBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openNarrativeClusterReport(c);
      });
      actions.appendChild(reportBtn);
      tr.appendChild(actions);

      tbody.appendChild(tr);
    });
  }

  function loadNarrativeClusterReport(c) {
    if (!c || !c.id) return Promise.resolve();
    var key = String(c.id);
    if (NARRATIVE_REPORTS[key] && !NARRATIVE_REPORTS[key].error) return Promise.resolve();
    NARRATIVE_REPORTS[key] = { loading: true };
    return fetch(API_BASE + '/narrative-clusters/' + encodeURIComponent(key) + '/report', {
      headers: { 'Accept': 'application/json' }
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (payload) {
        if (payload && payload.success && payload.data) {
          NARRATIVE_REPORTS[key] = payload.data;
        } else {
          NARRATIVE_REPORTS[key] = { error: (payload && payload.error) || 'Report unavailable' };
        }
        openNarrativeClusterReport(c, true);
      })
      .catch(function (err) {
        NARRATIVE_REPORTS[key] = { error: err && err.message ? err.message : String(err) };
        openNarrativeClusterReport(c, true);
      });
  }

  function appendNarrativeClusterReport(body, c) {
    var key = String(c.id);
    var report = NARRATIVE_REPORTS[key];
    body.appendChild(el('div', 'mi-drawer-section-title', 'Ledger narrative cross-check'));
    if (!report) {
      body.appendChild(el('div', 'mi-panel-empty', 'Preparing Ledger cross-check...'));
      return;
    }
    if (report.loading) {
      body.appendChild(el('div', 'mi-panel-empty', 'Investigating mapped tickers with the correct valuation engines...'));
      return;
    }
    if (report.error) {
      body.appendChild(el('div', 'mi-panel-empty', 'Report unavailable: ' + report.error));
      return;
    }

    var wrap = el('div', 'mi-conviction-block');
    var v = report.verdict || {};
    var top = el('div', 'mi-conviction-row');
    top.appendChild(el('div', 'mi-conviction-label', 'Verdict'));
    top.appendChild(el('div', 'mi-conviction-value', (v.risk_level || 'LOW') + ' - ' + (v.summary || 'No summary')));
    wrap.appendChild(top);

    String(report.narrative || '').split(/\n{2,}/).forEach(function (p) {
      var text = p.replace(/\*\*/g, '').trim();
      if (!text) return;
      var row = el('div', 'mi-conviction-row');
      row.appendChild(el('div', 'mi-conviction-value', text));
      wrap.appendChild(row);
    });

    if (Array.isArray(v.signals) && v.signals.length > 0) {
      var sig = el('div', 'mi-conviction-signals');
      sig.appendChild(el('div', 'mi-conviction-sub-label', 'Why it matters'));
      var ul = el('ul', 'mi-conviction-list confirming');
      v.signals.forEach(function (line) { ul.appendChild(el('li', null, line)); });
      sig.appendChild(ul);
      wrap.appendChild(sig);
    }

    if (Array.isArray(report.candidate_fundamentals) && report.candidate_fundamentals.length > 0) {
      var bestBar = el('div', 'mi-conviction-best');
      bestBar.appendChild(el('span', 'mi-conviction-sub-label', 'Ledger checked: '));
      report.candidate_fundamentals.slice(0, 8).forEach(function (f) {
        var chip = scannerLink(f.symbol || '?', 'mi-conviction-ticker');
        chip.title = f.unavailable ? 'Fundamentals unavailable' : [
          f.valuation_engine || 'valuation engine N/A',
          f.valuation_state || 'valuation N/A',
          f.valuation_gap_pct != null ? 'gap ' + Number(f.valuation_gap_pct).toFixed(1) + '%' : null,
          f.quality_grade ? 'quality ' + f.quality_grade : null
        ].filter(Boolean).join(' | ');
        bestBar.appendChild(chip);
      });
      wrap.appendChild(bestBar);
    }
    body.appendChild(wrap);
  }

  function openNarrativeClusterReport(c, skipLoad) {
    var backdrop = document.getElementById('mi-drawer-backdrop');
    var drawer = document.getElementById('mi-drawer');
    var drawerName = document.getElementById('mi-drawer-name');
    var drawerSummary = document.getElementById('mi-drawer-summary');
    var drawerBody = document.getElementById('mi-drawer-body');
    var drawerEngineRow = document.getElementById('mi-drawer-engine-row');
    if (!drawer || !drawerBody) return;

    if (!skipLoad && (!NARRATIVE_REPORTS[String(c.id)] || NARRATIVE_REPORTS[String(c.id)].error)) {
      loadNarrativeClusterReport(c);
    }

    drawerName.textContent = (c.title || c.slug || ('cluster ' + c.id)) + ' — Narrative Report';
    drawerSummary.innerHTML = '';
    appendLinkedTickerText(drawerSummary, c.summary || '');
    drawerEngineRow.innerHTML = '';
    drawerEngineRow.appendChild(el('span', 'mi-card-engine social', 'Narrative Radar'));
    drawerEngineRow.appendChild(el('span', 'mi-confidence-pill medium', c.status || 'WATCH'));
    (Array.isArray(c.validity_flags) ? c.validity_flags : []).forEach(function (f) {
      var chip = el('span', 'mi-flag-chip ' + flagSeverity(f), f);
      chip.title = flagTip(f);
      drawerEngineRow.appendChild(chip);
    });
    drawerBody.innerHTML = '';

    var stats = el('div', 'mi-drawer-grid-2');
    [
      ['Claims', String(c.claim_count || 0)],
      ['Sources', String(c.source_hit_count || 0)],
      ['Breadth', c.source_breadth == null ? 'N/A' : Number(c.source_breadth).toFixed(2)],
      ['Updated', fmtDateTime(c.updated_at || c.last_seen_at || c.first_seen_at)]
    ].forEach(function (kv) {
      var stat = el('div', 'mi-stat');
      stat.appendChild(el('div', 'mi-stat-label', kv[0]));
      stat.appendChild(el('div', 'mi-stat-value', kv[1]));
      stats.appendChild(stat);
    });
    drawerBody.appendChild(stats);

    var tickers = Array.isArray(c.mapped_tickers) ? c.mapped_tickers : [];
    var tickRow = el('div', 'mi-conviction-best');
    tickRow.appendChild(el('span', 'mi-conviction-sub-label', 'Mapped tickers: '));
    if (tickers.length) {
      tickers.forEach(function (sym) {
        var a = scannerLink(sym, 'mi-conviction-ticker');
        tickRow.appendChild(a);
      });
    } else {
      tickRow.appendChild(el('span', '', 'none'));
    }
    drawerBody.appendChild(tickRow);
    appendNarrativeClusterReport(drawerBody, c);
    backdrop.classList.add('open');
    drawer.classList.add('open');
  }

  function initNarrativeRadar() {
    var section = document.getElementById('mi-narrative-section');
    var header = document.getElementById('mi-narrative-header');
    var toggle = document.getElementById('mi-narrative-toggle');
    if (!section || !header || !toggle) return;

    function setExpanded(open) {
      section.classList.toggle('expanded', open);
      toggle.textContent = open ? '\u2212' : '+';
      if (open && !NARRATIVE_LOADED) {
        NARRATIVE_LOADED = true;
        fetchNarrativeClusters();
      }
    }

    header.addEventListener('click', function () {
      setExpanded(!section.classList.contains('expanded'));
    });

    var filter = document.getElementById('mi-narrative-status-filter');
    if (filter) {
      filter.addEventListener('change', function () {
        NARRATIVE_STATE.status = filter.value || 'all';
        if (NARRATIVE_LOADED) fetchNarrativeClusters();
      });
    }

    var refresh = document.getElementById('mi-narrative-refresh');
    if (refresh) {
      refresh.addEventListener('click', function (ev) {
        ev.stopPropagation();
        NARRATIVE_LOADED = true;
        fetchNarrativeClusters();
      });
    }
  }

  // ----------------------------------------------------------
  // Theme Performance (Phase 5)
  // ----------------------------------------------------------
  var QUALITY_LOADED = false;

  function initQualityDashboard() {
    var section = document.getElementById('mi-quality-section');
    var header = document.getElementById('mi-quality-header');
    var toggle = document.getElementById('mi-quality-toggle');
    if (!section || !header || !toggle) return;

    function setExpanded(open) {
      section.classList.toggle('expanded', open);
      toggle.textContent = open ? '\u2212' : '+';
      if (open && !QUALITY_LOADED) {
        QUALITY_LOADED = true;
        fetchQualityDashboard();
        fetchQualityOutcomes();
      }
    }
    header.addEventListener('click', function () {
      setExpanded(!section.classList.contains('expanded'));
    });

    var exportBtn = document.getElementById('mi-quality-export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportQualityOutcomesCsv);
    }
  }

  var _qualityOutcomes = [];
  var _symbolNameCache = {};

  function fetchQualityDashboard() {
    fetch(API_BASE + '/quality/dashboard')
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.success) return;
        renderQualityThemes(res.data.snapshots || []);
        var summary = document.getElementById('mi-quality-summary');
        if (summary) summary.textContent = 'themes: ' + (res.data.total || 0);
      })
      .catch(function () {});
  }

  function fetchQualityOutcomes() {
    fetch(API_BASE + '/quality/outcomes?limit=200')
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.success) return;
        _qualityOutcomes = res.data.outcomes || [];
        _qualityOutcomes.forEach(function (o) {
          if (o.company_name) _symbolNameCache[o.symbol] = o.company_name;
        });
        renderQualityOutcomes(_qualityOutcomes);
        renderQualityThemes_updateNames();
        var summary = document.getElementById('mi-quality-summary');
        if (summary) {
          var cur = summary.textContent || '';
          var parts = cur.split('\u00b7');
          summary.textContent = (parts[0] || 'themes: 0').trim() + ' \u00b7 outcomes: ' + _qualityOutcomes.length;
        }
      })
      .catch(function () {});
  }

  function renderQualityThemes_updateNames() {
    var links = document.querySelectorAll('[data-quality-sym]');
    links.forEach(function (el) {
      var sym = el.getAttribute('data-quality-sym');
      if (_symbolNameCache[sym]) {
        el.title = _symbolNameCache[sym] + ' (' + sym + ')';
      }
    });
  }

  var THEME_DISPLAY_NAMES = {
    ai_capex_acceleration: 'AI Capex Acceleration',
    ai_capex_pullback: 'AI Capex Pullback',
    china_growth: 'China Growth',
    rates_higher: 'Rates Higher',
    rates_lower: 'Rates Lower',
    energy_supply: 'Energy Supply',
    dollar_strength: 'Dollar Strength',
    consumer_strength: 'Consumer Strength',
    consumer_weakness: 'Consumer Weakness',
    consumer_cycle: 'Consumer Cycle',
    consumer_dupe_culture: 'Consumer Dupe Culture',
    defense_spending_up: 'Defense Spending',
    geopolitical_escalation_eu: 'Geopolitical (EU)',
    geopolitical_escalation_mideast: 'Geopolitical (Mideast)',
    healthcare_policy_change: 'Healthcare Policy',
    semis_supply_shock: 'Semis Supply Shock',
    inflation_rising: 'Inflation Rising',
    housing_demand_change: 'Housing Demand',
    commodity_supply_shock_softs: 'Commodity Softs',
  };

  var ENGINE_DISPLAY_NAMES = {
    news_cluster: 'Macro Engine',
    topic_anomaly: 'Social Arb',
    mixed_anomaly_led: 'Mixed Signal',
  };

  function themeLabel(key) {
    return THEME_DISPLAY_NAMES[key] || key.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
  }

  function engineLabelFromPath(path) {
    if (path == null || path === '') return 'All';
    return ENGINE_DISPLAY_NAMES[path] || String(path).replace(/_/g, ' ') || 'All';
  }

  function renderQualityThemes(snapshots) {
    var container = document.getElementById('mi-quality-themes-table');
    if (!container) return;
    if (!snapshots.length) {
      container.innerHTML = '<p style="color:var(--color-text-muted);padding:8px;">No theme performance data yet. Run forward_tracking job first.</p>';
      return;
    }

    var html = '<table class="mi-table"><thead><tr>';
    html += '<th class="mi-sortable-th">Theme</th>';
    html += '<th class="mi-sortable-th">Source</th>';
    html += '<th class="mi-sortable-th">Tracked</th>';
    html += '<th class="mi-sortable-th" title="% of scenarios where price moved in the predicted direction">Hit Rate</th>';
    html += '<th class="mi-sortable-th">Avg Return</th>';
    html += '<th class="mi-sortable-th" title="Average Max Favorable Excursion — best unrealized gain">Avg Best</th>';
    html += '<th class="mi-sortable-th" title="Average Max Adverse Excursion — worst unrealized drawdown">Avg Worst</th>';
    html += '<th>Top Winners</th>';
    html += '<th>Top Losers</th>';
    html += '<th class="mi-sortable-th">Date</th>';
    html += '</tr></thead><tbody>';

    snapshots.forEach(function (s) {
      var hitClass = s.direction_hit_rate >= 55 ? 'color:var(--color-up)' : s.direction_hit_rate < 45 ? 'color:var(--color-down)' : '';
      var retClass = s.avg_forward_return > 0 ? 'color:var(--color-up)' : s.avg_forward_return < 0 ? 'color:var(--color-down)' : '';
      html += '<tr>';
      html += '<td style="font-weight:600;" title="' + esc(s.primary_theme) + '">' + esc(themeLabel(s.primary_theme)) + '</td>';
      html += '<td>' + esc(engineLabelFromPath(s.detection_path)) + '</td>';
      html += '<td>' + s.scenarios_tracked + '</td>';
      html += '<td style="' + hitClass + ';font-weight:600;">' + s.direction_hit_rate.toFixed(1) + '%</td>';
      html += '<td style="' + retClass + '">' + (s.avg_forward_return > 0 ? '+' : '') + s.avg_forward_return.toFixed(2) + '%</td>';
      html += '<td style="color:var(--color-up)">+' + s.avg_mfe.toFixed(2) + '%</td>';
      html += '<td style="color:var(--color-down)">\u2212' + s.avg_mae.toFixed(2) + '%</td>';
      html += '<td>' + (s.top_winners || []).map(function (w) {
        var nm = _symbolNameCache[w.s] || '';
        var tip = nm ? nm + ' (' + w.s + ')' : w.s;
        return '<a href="/scanner?symbol=' + w.s + '" data-quality-sym="' + w.s + '" title="' + esc(tip) + '" style="color:var(--color-up);text-decoration:none;">' + w.s + '</a> <span style="color:var(--color-text-muted);">(' + (w.r > 0 ? '+' : '') + w.r.toFixed(1) + '%)</span>';
      }).join(', ') + '</td>';
      html += '<td>' + (s.top_losers || []).map(function (w) {
        var nm = _symbolNameCache[w.s] || '';
        var tip = nm ? nm + ' (' + w.s + ')' : w.s;
        return '<a href="/scanner?symbol=' + w.s + '" data-quality-sym="' + w.s + '" title="' + esc(tip) + '" style="color:var(--color-down);text-decoration:none;">' + w.s + '</a> <span style="color:var(--color-text-muted);">(' + (w.r > 0 ? '+' : '') + w.r.toFixed(1) + '%)</span>';
      }).join(', ') + '</td>';
      html += '<td>' + esc(s.snapshot_date) + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  var DIRECTION_LABELS = {
    long_winner:       { text: 'Bullish',  color: 'var(--color-up)',   icon: '\u25B2', note: '' },
    short_loser:       { text: 'Bearish',  color: 'var(--color-down)', icon: '\u25BC', note: '' },
    long_loser:        { text: 'Bearish',  color: 'var(--color-down)', icon: '\u25BC', note: '' },
    short_winner:      { text: 'Bullish',  color: 'var(--color-up)',   icon: '\u25B2', note: '' },
    long:              { text: 'Bullish',  color: 'var(--color-up)',   icon: '\u25B2', note: '' },
    short:             { text: 'Bearish',  color: 'var(--color-down)', icon: '\u25BC', note: '' },
    long_beneficiary:  { text: 'Bullish',  color: 'var(--color-up)',   icon: '\u25B2', note: '2nd-order beneficiary' },
    short_beneficiary: { text: 'Bearish',  color: 'var(--color-down)', icon: '\u25BC', note: '2nd-order beneficiary' },
    long_hedge:        { text: 'Bullish',  color: 'var(--color-up)',   icon: '\u25B2', note: 'hedge' },
    short_hedge:       { text: 'Bearish',  color: 'var(--color-down)', icon: '\u25BC', note: 'hedge' },
  };

  function renderQualityOutcomes(outcomes) {
    var container = document.getElementById('mi-quality-outcomes-table');
    if (!container) return;
    if (!outcomes.length) {
      container.innerHTML = '<p style="color:var(--color-text-muted);padding:8px;">No outcome data yet. Run forward_tracking job first.</p>';
      return;
    }

    var groups = {};
    var groupOrder = [];
    outcomes.forEach(function (o) {
      var key = o.situation_id;
      if (!groups[key]) {
        groups[key] = [];
        groupOrder.push(key);
      }
      groups[key].push(o);
    });

    var COL_COUNT = 8;
    var html = '<table class="mi-table"><thead><tr>';
    html += '<th>Symbol</th>';
    html += '<th>Outlook</th>';
    html += '<th title="Composite conviction rank (higher = stronger signal)">Rank</th>';
    html += '<th title="Actual return since scenario was created">Return</th>';
    html += '<th title="Max Favorable Excursion — best unrealized gain during the tracking period">Best</th>';
    html += '<th title="Max Adverse Excursion — worst unrealized drawdown during the tracking period">Worst</th>';
    html += '<th title="Did the price move in the predicted direction?">Correct?</th>';
    html += '<th>Age</th>';
    html += '</tr></thead><tbody>';

    groupOrder.forEach(function (sid) {
      var rows = groups[sid];
      var first = rows[0];
      var scenarioLabel = '#' + sid + ' \u2014 ' + (first.scenario_title ? esc(first.scenario_title) : 'Scenario');
      var summaryText = first.scenario_summary ? esc(first.scenario_summary) : '';
      if (summaryText.length > 150) summaryText = summaryText.substring(0, 150) + '\u2026';

      var avgRet = rows.reduce(function (s, o) { return s + o.forward_return_pct; }, 0) / rows.length;
      var avgRetClass = avgRet > 0 ? 'color:var(--color-up)' : avgRet < 0 ? 'color:var(--color-down)' : '';
      var hits = rows.filter(function (o) { return o.direction_hit; }).length;

      var labelVal = first.operator_label || '';

      var groupId = 'qo-group-' + sid;

      html += '<tr style="background:var(--color-surface);border-top:2px solid var(--color-border);cursor:pointer;" onclick="window._toggleOutcomeGroup(\'' + groupId + '\',this)">';
      html += '<td colspan="' + COL_COUNT + '" style="padding:10px 8px 6px;">';
      html += '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">';
      html += '<div style="flex:1;min-width:0;">';
      html += '<span style="display:inline-block;width:16px;font-size:0.8em;color:var(--color-text-muted);transition:transform .15s;" data-chevron>\u25B6</span> ';
      html += '<a href="#" onclick="window._openScenarioDrawer(' + sid + ');event.stopPropagation();return false;" style="color:var(--color-accent);text-decoration:none;font-weight:600;font-size:0.95em;" title="Click to view scenario details">' + scenarioLabel + '</a>';
      if (summaryText) {
        html += '<div style="margin-top:3px;margin-left:16px;font-size:0.8em;color:var(--color-text-muted);line-height:1.4;">' + summaryText + '</div>';
      }
      html += '<div style="margin-top:4px;margin-left:16px;font-size:0.78em;color:var(--color-text-subtle);">';
      html += rows.length + ' ticker' + (rows.length !== 1 ? 's' : '');
      html += ' \u00b7 ' + first.days_tracked + 'd tracked';
      html += ' \u00b7 avg return: <span style="' + avgRetClass + ';font-weight:600;">' + (avgRet > 0 ? '+' : '') + avgRet.toFixed(2) + '%</span>';
      html += ' \u00b7 ' + hits + '/' + rows.length + ' correct';
      html += '</div>';
      html += '</div>';
      html += '<div style="flex-shrink:0;padding-top:2px;" onclick="event.stopPropagation()">';
      html += '<select data-sid="' + sid + '" data-sym="' + first.symbol + '" onchange="window._setOutcomeLabel(this)" style="font-size:0.8em;">';
      html += '<option value=""' + (!labelVal ? ' selected' : '') + '>\u2014</option>';
      html += '<option value="TRUE_POSITIVE"' + (labelVal === 'TRUE_POSITIVE' ? ' selected' : '') + '>TP</option>';
      html += '<option value="FALSE_POSITIVE"' + (labelVal === 'FALSE_POSITIVE' ? ' selected' : '') + '>FP</option>';
      html += '<option value="INCONCLUSIVE"' + (labelVal === 'INCONCLUSIVE' ? ' selected' : '') + '>?</option>';
      html += '</select>';
      html += '</div>';
      html += '</div>';
      html += '</td></tr>';

      rows.forEach(function (o) {
        var retClass = o.forward_return_pct > 0 ? 'color:var(--color-up)' : o.forward_return_pct < 0 ? 'color:var(--color-down)' : '';
        var dir = DIRECTION_LABELS[o.exposure_direction] || { text: o.exposure_direction, color: 'inherit', icon: '', note: '' };
        var symbolTitle = o.company_name ? o.company_name + ' (' + o.symbol + ')' : o.symbol;

        html += '<tr class="' + groupId + '" style="display:none;">';
        html += '<td style="padding-left:24px;"><a href="/scanner?symbol=' + o.symbol + '" style="color:var(--color-accent);text-decoration:none;" title="' + esc(symbolTitle) + '">' + esc(o.symbol) + '</a></td>';

        html += '<td style="color:' + dir.color + ';font-weight:600;" title="' + esc(o.exposure_direction) + '">' + dir.icon + ' ' + dir.text;
        if (dir.note) html += ' <span style="font-weight:400;font-size:0.8em;color:var(--color-text-muted);">(' + dir.note + ')</span>';
        html += '</td>';

        html += '<td>' + o.composite_rank.toFixed(1) + '</td>';
        html += '<td style="' + retClass + ';font-weight:600;">' + (o.forward_return_pct > 0 ? '+' : '') + o.forward_return_pct.toFixed(2) + '%</td>';
        html += '<td style="color:var(--color-up)">+' + o.max_favorable_pct.toFixed(2) + '%</td>';
        html += '<td style="color:var(--color-down)">\u2212' + o.max_adverse_pct.toFixed(2) + '%</td>';
        html += '<td style="text-align:center;">' + (o.direction_hit ? '\u2705' : '\u274c') + '</td>';
        html += '<td>' + o.days_tracked + 'd</td>';
        html += '</tr>';
      });
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  window._toggleOutcomeGroup = function (groupId, headerRow) {
    var rows = document.querySelectorAll('.' + groupId);
    var isOpen = rows.length > 0 && rows[0].style.display !== 'none';
    rows.forEach(function (r) { r.style.display = isOpen ? 'none' : ''; });
    var chevron = headerRow.querySelector('[data-chevron]');
    if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(90deg)';
  };

  window._setOutcomeLabel = function (sel) {
    var sid = sel.getAttribute('data-sid');
    var sym = sel.getAttribute('data-sym');
    var label = sel.value;
    fetch(API_BASE + '/quality/outcomes/' + sid + '/' + sym + '/label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: label })
    }).catch(function () {});
  };

  function exportQualityOutcomesCsv() {
    if (!_qualityOutcomes.length) return;
    var headers = ['situation_id', 'symbol', 'direction', 'rank', 'return_pct', 'mfe_pct', 'mae_pct', 'direction_hit', 'days_tracked', 'theme', 'engine', 'status', 'operator_label'];
    var rows = _qualityOutcomes.map(function (o) {
      return [o.situation_id, o.symbol, o.exposure_direction, o.composite_rank.toFixed(1),
        o.forward_return_pct.toFixed(2), o.max_favorable_pct.toFixed(2), o.max_adverse_pct.toFixed(2),
        o.direction_hit ? 'Y' : 'N', o.days_tracked, o.primary_theme, o.detection_path, o.scenario_status,
        o.operator_label || ''].join(',');
    });
    var csv = headers.join(',') + '\n' + rows.join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'quality-outcomes-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
  }

  // ----------------------------------------------------------
  // Macro Source Monitor
  // ----------------------------------------------------------
  var MACRO_SOURCE_LOADED = false;
  var MACRO_SOURCE_JOB_NAMES = {
    macro_fed_collector: true,
    macro_news_collector: true,
    macro_econ_collector: true,
    embedding_pipeline: true,
    macro_clustering: true,
    cluster_naming: true,
    cross_engine_corroboration: true,
    consumer_cycle_adapter: true
  };

  function isMacroSourceJob(job) {
    var def = (job && job.definition) || {};
    var name = def.name || '';
    return !!MACRO_SOURCE_JOB_NAMES[name] || name.indexOf('macro_') === 0;
  }

  function jobRuntimeAge(value) {
    if (!value) return 'never';
    var ms = Date.parse(value);
    if (!Number.isFinite(ms)) return 'unknown';
    return fmtAge(Math.floor(ms / 1000));
  }

  function fetchMacroSourceMonitor() {
    var table = document.getElementById('mi-macro-source-table');
    if (table) table.innerHTML = '<div class="mi-operator-empty">Loading macro source jobs...</div>';
    return fetch(API_BASE + '/scheduler/status', {
      headers: { 'Accept': 'application/json' }
    })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        if (!payload || payload.success !== true) {
          throw new Error((payload && payload.error) || 'Malformed scheduler response');
        }
        renderMacroSourceMonitor(((payload.data || {}).jobs || []).filter(isMacroSourceJob));
      })
      .catch(function (err) {
        if (table) table.innerHTML = '<div class="mi-operator-empty" style="color:var(--color-down);">Load failed: ' + esc(err.message) + '</div>';
      });
  }

  function renderMacroSourceMonitor(jobs) {
    var summary = document.getElementById('mi-macro-source-summary');
    var table = document.getElementById('mi-macro-source-table');
    if (!table) return;
    var running = jobs.filter(function (j) { return !!((j.runtime || {}).running); }).length;
    if (summary) summary.textContent = 'jobs: ' + jobs.length + ' \u00b7 running: ' + running;
    if (!jobs.length) {
      table.innerHTML = '<div class="mi-operator-empty">No macro source jobs registered.</div>';
      return;
    }

    var html = '<table class="mi-operator-table"><thead><tr>';
    html += '<th>job</th><th>kind</th><th>cadence</th><th>enabled</th><th>last run</th><th>status</th>';
    html += '</tr></thead><tbody>';
    jobs.forEach(function (j) {
      var def = j.definition || {};
      var cfg = j.config || {};
      var rt = j.runtime || {};
      var enabled = cfg.enabled !== false;
      var ok = rt.last_exit_code === 0;
      var status = rt.running ? 'running' : rt.last_finished_at ? (ok ? 'OK' : 'FAIL') : 'never run';
      var statusColor = rt.running ? 'var(--color-info)' : rt.last_finished_at ? (ok ? 'var(--color-up)' : 'var(--color-down)') : 'var(--color-text-subtle)';
      html += '<tr title="' + esc(def.description || '') + '">';
      html += '<td style="font-weight:600;">' + esc(def.name || 'unknown') + '</td>';
      html += '<td>' + esc(def.kind || '-') + '</td>';
      html += '<td>' + esc(j.effective_cron_expression || def.defaultCronExpression || '-') + '</td>';
      html += '<td style="color:' + (enabled ? 'var(--color-up)' : 'var(--color-text-subtle)') + ';">' + (enabled ? 'ON' : 'OFF') + '</td>';
      html += '<td>' + esc(jobRuntimeAge(rt.last_finished_at)) + '</td>';
      html += '<td style="color:' + statusColor + ';font-weight:600;">' + esc(status) + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    table.innerHTML = html;
  }

  function initMacroSourceMonitor() {
    var section = document.getElementById('mi-macro-source-section');
    var header = document.getElementById('mi-macro-source-header');
    var toggle = document.getElementById('mi-macro-source-toggle');
    if (!section || !header || !toggle) return;

    function setExpanded(open) {
      section.classList.toggle('expanded', open);
      toggle.textContent = open ? '\u2212' : '+';
      if (open && !MACRO_SOURCE_LOADED) {
        MACRO_SOURCE_LOADED = true;
        fetchMacroSourceMonitor();
      }
    }
    header.addEventListener('click', function (e) {
      if (e.target && e.target.tagName === 'BUTTON' && e.target !== toggle) return;
      setExpanded(!section.classList.contains('expanded'));
    });

    var refresh = document.getElementById('mi-macro-source-refresh');
    if (refresh) refresh.addEventListener('click', function (e) {
      e.stopPropagation();
      MACRO_SOURCE_LOADED = true;
      fetchMacroSourceMonitor();
    });
  }

  function initEigenPerturbationEngine() {
    var section = document.getElementById('mi-eigen-section');
    var header = document.getElementById('mi-eigen-header');
    var toggle = document.getElementById('mi-eigen-toggle');
    if (!section || !header || !toggle) return;

    function setExpanded(open) {
      section.classList.toggle('expanded', open);
      toggle.textContent = open ? '\u2212' : '+';
      if (open && !EIGEN_LOADED) {
        EIGEN_LOADED = true;
        fetchEigenPerturbations();
        fetchReaccelerationScreen();
      }
    }

    header.addEventListener('click', function (e) {
      if (e.target && e.target.tagName === 'BUTTON' && e.target !== toggle) return;
      setExpanded(!section.classList.contains('expanded'));
    });

    var refresh = document.getElementById('mi-eigen-refresh');
    if (refresh) refresh.addEventListener('click', function (e) {
      e.stopPropagation();
      EIGEN_LOADED = true;
      fetchEigenPerturbations();
    });

    var reaccelRefresh = document.getElementById('mi-reacceleration-refresh');
    if (reaccelRefresh) reaccelRefresh.addEventListener('click', function (e) {
      e.stopPropagation();
      fetchReaccelerationScreen();
    });

    var reaccelSection = document.getElementById('mi-reacceleration-section');
    var reaccelHeader = document.getElementById('mi-reacceleration-header');
    var reaccelToggle = document.getElementById('mi-reacceleration-toggle');
    if (reaccelSection && reaccelHeader && reaccelToggle) {
      function setReaccelExpanded(open) {
        reaccelSection.classList.toggle('expanded', open);
        reaccelToggle.textContent = open ? '\u2212' : '+';
      }
      reaccelHeader.addEventListener('click', function (e) {
        if (e.target && e.target.tagName === 'BUTTON' && e.target !== reaccelToggle) return;
        setReaccelExpanded(!reaccelSection.classList.contains('expanded'));
      });
    }

    var run = document.getElementById('mi-eigen-run');
    if (run) run.addEventListener('click', function (e) {
      e.stopPropagation();
      runEigenScanNow();
    });
  }

  function initScenarioPanelToggles() {
    function wire(panelId, target, loadWhenOpen) {
      var panel = document.getElementById(panelId);
      var btn = document.querySelector('.mi-panel-collapse[data-collapse-target="' + target + '"]');
      if (!panel || !btn) return;
      var loaded = false;
      function setOpen(open) {
        panel.classList.toggle('collapsed', !open);
        btn.textContent = open ? '\u2212' : '+';
        btn.title = open ? 'Collapse ' + target + ' engine' : 'Expand ' + target + ' engine';
        if (open && loadWhenOpen && !loaded) {
          loaded = true;
          loadWhenOpen();
        }
      }
      setOpen(!panel.classList.contains('collapsed'));
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        setOpen(panel.classList.contains('collapsed'));
      });
    }
    wire('mi-macro-panel', 'macro', render);
    wire('mi-social-panel', 'social', render);
  }

  function initOperatorTools() {
    var section = document.getElementById('mi-operator-section');
    var header = document.getElementById('mi-operator-header');
    var toggle = document.getElementById('mi-operator-toggle');
    if (!section || !header || !toggle) return;

    function setExpanded(open) {
      section.classList.toggle('expanded', open);
      toggle.textContent = open ? '\u2212' : '+';
      if (open && !OPERATOR_LOADED) {
        OPERATOR_LOADED = true;
        fetchSocialArbAudit();
        fetchSocialArbPromotedLedger();
        fetchUniverseMovers();
        fetchTrackedConcepts();
        fetchEmergingTopicsForOperator();
      }
    }
    header.addEventListener('click', function (e) {
      if (e.target && e.target.tagName === 'BUTTON' && e.target !== toggle) return;
      setExpanded(!section.classList.contains('expanded'));
    });

    function initSubCard(cardId) {
      var card = document.getElementById(cardId);
      if (!card) return;
      var cardHeader = card.querySelector('.mi-operator-card-header');
      var cardToggle = card.querySelector('.mi-card-toggle');
      if (!cardHeader || !cardToggle) return;

      function setCardExpanded(open) {
        card.classList.toggle('collapsed', !open);
        cardToggle.textContent = open ? '\u2212' : '+';
        cardToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      }

      setCardExpanded(!card.classList.contains('collapsed'));
      cardHeader.addEventListener('click', function (e) {
        var tag = e.target && e.target.tagName;
        if (tag === 'BUTTON' && e.target !== cardToggle) return;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'A') return;
        setCardExpanded(card.classList.contains('collapsed'));
      });
    }

    [
      'mi-intake-card',
      'mi-candidate-intel-card',
      'mi-universe-movers-card',
      'mi-listening-rules-card',
      'mi-promotion-queue-card'
    ].forEach(initSubCard);

    document.getElementById('mi-tracked-search').addEventListener('input', function (e) {
      OPERATOR_STATE.tracked.search = String(e.target.value || '').trim();
    });
    document.getElementById('mi-tracked-search').addEventListener('change', function () { fetchTrackedConcepts(); });
    document.getElementById('mi-tracked-status-filter').addEventListener('change', function (e) {
      OPERATOR_STATE.tracked.status = e.target.value; fetchTrackedConcepts();
    });
    document.getElementById('mi-tracked-target-filter').addEventListener('change', function (e) {
      OPERATOR_STATE.tracked.target_type = e.target.value; fetchTrackedConcepts();
    });
    document.getElementById('mi-tracked-refresh').addEventListener('click', fetchTrackedConcepts);

    document.getElementById('mi-emerging-filter').addEventListener('change', function (e) {
      OPERATOR_STATE.emerging.filter = e.target.value; fetchEmergingTopicsForOperator();
    });
    document.getElementById('mi-emerging-refresh').addEventListener('click', fetchEmergingTopicsForOperator);
    var auditRefresh = document.getElementById('mi-social-audit-refresh');
    if (auditRefresh) auditRefresh.addEventListener('click', fetchSocialArbAudit);
    var ledgerRefresh = document.getElementById('mi-social-ledger-refresh');
    if (ledgerRefresh) ledgerRefresh.addEventListener('click', fetchSocialArbPromotedLedger);
    var moversRefresh = document.getElementById('mi-universe-movers-refresh');
    if (moversRefresh) moversRefresh.addEventListener('click', fetchUniverseMovers);
  }

  // ----------------------------------------------------------
  // Wire-up
  // ----------------------------------------------------------
  function init() {
    bindScannerLinkDelegation();

    document.querySelectorAll('.mi-engine-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.mi-engine-tab').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        STATE.engineView = btn.getAttribute('data-engine-view');
        render();
      });
    });

    ['macro', 'social'].forEach(function (engineKey) {
      document.querySelectorAll('#mi-' + engineKey + '-status-tabs .mi-status-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
          document.querySelectorAll('#mi-' + engineKey + '-status-tabs .mi-status-tab').forEach(function (t) { t.classList.remove('active'); });
          tab.classList.add('active');
          STATE[engineKey].status = tab.getAttribute('data-status');
          render();
        });
      });
      document.querySelectorAll('#mi-' + engineKey + '-coverage-chips .mi-coverage-chip').forEach(function (chip) {
        if (engineKey === 'social' && chip.classList.contains('disabled-default')) {
          // mega disabled by default in social per D22; user can re-enable by clicking
        }
        chip.addEventListener('click', function () {
          chip.classList.toggle('active');
          chip.classList.remove('disabled-default');
          var tier = chip.getAttribute('data-tier');
          if (chip.classList.contains('active')) STATE[engineKey].coverageTiers.add(tier);
          else STATE[engineKey].coverageTiers.delete(tier);
          render();
        });
      });
    });

    var minStrength = document.getElementById('mi-min-strength');
    minStrength.addEventListener('input', function () {
      STATE.global.minStrength = +minStrength.value;
      document.getElementById('mi-min-strength-val').textContent = minStrength.value;
      render();
    });
    var minConfidence = document.getElementById('mi-min-confidence');
    minConfidence.addEventListener('input', function () {
      STATE.global.minConfidence = +minConfidence.value;
      document.getElementById('mi-min-confidence-val').textContent = minConfidence.value;
      render();
    });
    document.getElementById('mi-time-horizon').addEventListener('change', function (e) {
      STATE.global.timeHorizon = e.target.value; render();
    });
    document.getElementById('mi-sort-mode').addEventListener('change', function (e) {
      STATE.global.sortMode = e.target.value === 'newest' ? 'newest' : 'priority';
      render();
    });
    document.getElementById('mi-include-invalidated').addEventListener('change', function (e) {
      STATE.global.includeInvalidated = e.target.checked; render();
    });
    document.getElementById('mi-include-suppressed').addEventListener('change', function (e) {
      STATE.global.includeSuppressed = e.target.checked; render();
    });

    var auth = document.getElementById('mi-social-auth');
    auth.addEventListener('input', function () {
      STATE.social.minAuthenticity = +auth.value / 100;
      document.getElementById('mi-social-auth-val').textContent = STATE.social.minAuthenticity.toFixed(2);
      render();
    });
    document.getElementById('mi-social-min-z').addEventListener('input', function (e) {
      STATE.social.minZ = parseFloat(e.target.value || '0');
      render();
    });
    document.getElementById('mi-social-cross-platform').addEventListener('change', function (e) {
      STATE.social.crossPlatformOnly = e.target.checked;
      render();
    });

    document.getElementById('mi-drawer-close').addEventListener('click', closeDrawer);
    document.getElementById('mi-drawer-backdrop').addEventListener('click', closeDrawer);
    var reportClose = document.getElementById('mi-report-close');
    var reportBackdrop = document.getElementById('mi-report-modal-backdrop');
    var reportCopy = document.getElementById('mi-report-copy');
    var reportDownload = document.getElementById('mi-report-download');
    if (reportClose) reportClose.addEventListener('click', closeShareableReport);
    if (reportBackdrop) reportBackdrop.addEventListener('click', closeShareableReport);
    if (reportCopy) reportCopy.addEventListener('click', copyShareableReport);
    if (reportDownload) reportDownload.addEventListener('click', downloadShareableReport);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeShareableReport();
        closeDrawer();
      }
    });

    document.getElementById('mi-refresh-btn').addEventListener('click', function () {
      loadFromApi();
      fetchReaccelerationScreen();
    });

    initOperatorTools();
    initNarrativeRadar();
    initQualityDashboard();
    initMacroSourceMonitor();
    initEigenPerturbationEngine();
    initScenarioPanelToggles();
    initEventRiskRadar();
    initSocialThesisAlerts();
    initConvergenceScoreboard();
    initBaseBreakCause();
    fetchReaccelerationScreen();

    // Restore UI controls from persisted state
    document.querySelectorAll('.mi-engine-tab').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-engine-view') === STATE.engineView);
    });
    ['macro', 'social'].forEach(function (engineKey) {
      document.querySelectorAll('#mi-' + engineKey + '-status-tabs .mi-status-tab').forEach(function (tab) {
        tab.classList.toggle('active', tab.getAttribute('data-status') === STATE[engineKey].status);
      });
      document.querySelectorAll('#mi-' + engineKey + '-coverage-chips .mi-coverage-chip').forEach(function (chip) {
        var tier = chip.getAttribute('data-tier');
        chip.classList.toggle('active', STATE[engineKey].coverageTiers.has(tier));
        chip.classList.remove('disabled-default');
      });
    });
    var msEl = document.getElementById('mi-min-strength');
    if (msEl) { msEl.value = STATE.global.minStrength; document.getElementById('mi-min-strength-val').textContent = STATE.global.minStrength; }
    var mcEl = document.getElementById('mi-min-confidence');
    if (mcEl) { mcEl.value = STATE.global.minConfidence; document.getElementById('mi-min-confidence-val').textContent = STATE.global.minConfidence; }
    var thEl = document.getElementById('mi-time-horizon');
    if (thEl) thEl.value = STATE.global.timeHorizon;
    var smEl = document.getElementById('mi-sort-mode');
    if (smEl) smEl.value = STATE.global.sortMode === 'newest' ? 'newest' : 'priority';
    var iiEl = document.getElementById('mi-include-invalidated');
    if (iiEl) iiEl.checked = STATE.global.includeInvalidated;
    var isEl = document.getElementById('mi-include-suppressed');
    if (isEl) isEl.checked = STATE.global.includeSuppressed;
    var authEl = document.getElementById('mi-social-auth');
    if (authEl) { authEl.value = Math.round(STATE.social.minAuthenticity * 100); document.getElementById('mi-social-auth-val').textContent = STATE.social.minAuthenticity.toFixed(2); }
    var zEl = document.getElementById('mi-social-min-z');
    if (zEl) zEl.value = STATE.social.minZ;

    render();
    loadKnownTickerUniverse();
    loadFromApi();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// ── Options Flow Anomaly Engine ──────────────────────────────────────────
(function () {
  'use strict';
  var API_URL = window.API_URL || '';

  function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function scannerLinkHtml(symbol, className, label) {
    return window.miScannerLinkHtml
      ? window.miScannerLinkHtml(symbol, className, label)
      : escHtml(label || symbol || '');
  }
  function linkKnownSymbolsHtml(text, symbols) {
    return window.miLinkKnownTickerUniverseHtml
      ? window.miLinkKnownTickerUniverseHtml(text, symbols)
      : escHtml(text || '');
  }

  window.miLoadOptionsAnomalies = async function () {
    var body = document.getElementById('mi-options-body');
    if (!body) return;
    body.innerHTML = '<div class="mi-panel-empty">Loading options flow data&hellip;</div>';

    try {
      var directionEl = document.getElementById('mi-options-direction');
      var direction = directionEl ? directionEl.value : 'both';
      var tierEl = document.getElementById('mi-options-tier');
      var tier = tierEl ? tierEl.value : 'heavy';
      var res = await fetch(API_URL + '/api/options-flow/anomalies?direction=' + encodeURIComponent(direction) + '&tier=' + encodeURIComponent(tier));
      var json = await res.json();
      if (!json.success || !json.data || !json.data.length) {
        body.innerHTML = '<div class="mi-panel-empty">No options flow data collected yet. Click "Collect Now" to start.</div>';
        return;
      }

      var rows = json.data;
      var html = '<table style="width:100%;border-collapse:collapse;font-size:12px;font-family:var(--font-mono);">';
      html += '<thead><tr style="border-bottom:1px solid var(--color-border);color:var(--color-text-muted);font-size:10px;text-transform:uppercase;letter-spacing:0.05em;">';
      html += '<th style="text-align:left;padding:6px 8px;">Symbol</th>';
      html += '<th style="text-align:right;padding:6px 8px;">Price</th>';
      html += '<th style="text-align:left;padding:6px 8px;">Bias</th>';
      html += '<th style="text-align:left;padding:6px 8px;">Tier</th>';
      html += '<th style="text-align:right;padding:6px 8px;">P/C</th>';
      html += '<th style="text-align:right;padding:6px 8px;">C/P</th>';
      html += '<th style="text-align:right;padding:6px 8px;">Put Vol</th>';
      html += '<th style="text-align:right;padding:6px 8px;">Call Vol</th>';
      html += '<th style="text-align:right;padding:6px 8px;">IV Skew</th>';
      html += '<th style="text-align:right;padding:6px 8px;">Score</th>';
      html += '<th style="text-align:left;padding:6px 8px;">Flags</th>';
      html += '</tr></thead><tbody>';

      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var pc = r.put_call_volume_ratio || 0;
        var cp = r.call_put_volume_ratio || ((r.total_put_volume || 0) > 0 ? (r.total_call_volume || 0) / r.total_put_volume : 0);
        var bias = r.flow_bias || (pc >= 1.3 ? 'put_heavy' : cp >= 1.3 ? 'call_heavy' : 'balanced');
        var pcColor = pc >= 2.0 ? '#ef4444' : pc >= 1.3 ? '#f59e0b' : '#6b7280';
        var cpColor = cp >= 2.0 ? '#4ade80' : cp >= 1.3 ? '#22c55e' : '#6b7280';
        var biasColor = bias === 'put_heavy' ? pcColor : bias === 'call_heavy' ? cpColor : '#6b7280';
        var biasLabel = bias === 'put_heavy' ? 'Put-heavy' : bias === 'call_heavy' ? 'Call-heavy' : 'Balanced';
        var tierLabel = r.imbalance_tier || (Math.max(pc, cp) >= 20 ? 'absurd' : Math.max(pc, cp) >= 5 ? 'extreme' : Math.max(pc, cp) >= 2 ? 'heavy' : 'elevated');
        var tierColor = tierLabel === 'absurd' ? '#c084fc' : tierLabel === 'extreme' ? '#ef4444' : tierLabel === 'heavy' ? '#f59e0b' : '#6b7280';
        var score = r.anomaly_score || 0;
        var scoreColor = score >= 50 ? '#ef4444' : score >= 20 ? '#f59e0b' : '#6b7280';
        var flags = Array.isArray(r.anomaly_flags) ? r.anomaly_flags : [];
        var flagHtml = flags.map(function(f) {
          return '<span style="padding:1px 5px;border-radius:4px;font-size:9px;background:rgba(239,68,68,0.12);color:#fca5a5;">' + escHtml(f) + '</span>';
        }).join(' ');
        var skew = r.iv_skew;
        var skewStr = skew != null ? (skew > 0 ? '+' : '') + (skew * 100).toFixed(1) + '%' : 'N/A';

        html += '<tr style="border-bottom:1px solid var(--color-border-subtle);cursor:pointer;' + (pc >= 2.0 ? 'background:rgba(239,68,68,0.04);' : cp >= 2.0 ? 'background:rgba(74,222,128,0.04);' : '') + '" onclick="miShowReport(\'' + escHtml(r.symbol) + '\')">';
        html += '<td style="padding:6px 8px;font-weight:600;color:var(--color-text);">' + scannerLinkHtml(r.symbol, 'mi-open-scanner-link mi-scanner-symbol-link') + '</td>';
        html += '<td style="text-align:right;padding:6px 8px;">$' + (r.stock_price || 0).toFixed(0) + '</td>';
        html += '<td style="padding:6px 8px;color:' + biasColor + ';font-weight:700;">' + biasLabel + '</td>';
        html += '<td style="padding:6px 8px;color:' + tierColor + ';font-weight:700;text-transform:capitalize;">' + escHtml(tierLabel) + '</td>';
        html += '<td style="text-align:right;padding:6px 8px;color:' + pcColor + ';font-weight:700;">' + pc.toFixed(2) + '</td>';
        html += '<td style="text-align:right;padding:6px 8px;color:' + cpColor + ';font-weight:700;">' + cp.toFixed(2) + '</td>';
        html += '<td style="text-align:right;padding:6px 8px;">' + (r.total_put_volume || 0).toLocaleString() + '</td>';
        html += '<td style="text-align:right;padding:6px 8px;">' + (r.total_call_volume || 0).toLocaleString() + '</td>';
        html += '<td style="text-align:right;padding:6px 8px;">' + skewStr + '</td>';
        html += '<td style="text-align:right;padding:6px 8px;color:' + scoreColor + ';font-weight:600;">' + score.toFixed(0) + '</td>';
        html += '<td style="padding:6px 8px;">' + (flagHtml || '<span style="color:var(--color-text-subtle);">—</span>') + '</td>';
        html += '</tr>';
      }

      html += '</tbody></table>';
      body.innerHTML = html;

    } catch (err) {
      body.innerHTML = '<div class="mi-panel-empty" style="color:#f87171;">Failed to load options flow data: ' + escHtml(String(err)) + '</div>';
    }
  };

  window.miRunOptionsCollect = async function () {
    var body = document.getElementById('mi-options-body');
    if (body) body.innerHTML = '<div class="mi-panel-empty" style="color:#f59e0b;">Starting options flow collection (top 100 symbols)&hellip;</div>';

    try {
      var res = await fetch(API_URL + '/api/options-flow/run-collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ top: 100 }),
      });
      var json = await res.json();

      if (json?.data?.started) {
        if (body) body.innerHTML = '<div class="mi-panel-empty" style="color:#f59e0b;">Collection running&hellip; This takes ~2 min for 100 symbols. Refresh when done.</div>';
        var poll = setInterval(async function () {
          try {
            var sr = await fetch(API_URL + '/api/options-flow/status');
            var sj = await sr.json();
            if (sj?.data && !sj.data.running) {
              clearInterval(poll);
              window.miLoadOptionsAnomalies();
            } else if (sj?.data?.last_message && body) {
              body.innerHTML = '<div class="mi-panel-empty" style="color:#f59e0b;">' + escHtml(sj.data.last_message) + '</div>';
            }
          } catch (e) { /* ignore */ }
        }, 5000);
      }
    } catch (err) {
      if (body) body.innerHTML = '<div class="mi-panel-empty" style="color:#f87171;">Failed to start collection.</div>';
    }
  };

  window.miShowReport = async function (symbol) {
    var backdrop = document.getElementById('mi-drawer-backdrop');
    var drawer = document.getElementById('mi-drawer');
    var drawerName = document.getElementById('mi-drawer-name');
    var drawerSummary = document.getElementById('mi-drawer-summary');
    var drawerBody = document.getElementById('mi-drawer-body');
    var drawerEngineRow = document.getElementById('mi-drawer-engine-row');

    if (!drawer || !drawerBody) return;

    drawerName.innerHTML = scannerLinkHtml(symbol, 'mi-scanner-symbol-link') + ' — Options Flow Report';
    drawerSummary.textContent = 'Assembling deterministic report…';
    drawerEngineRow.innerHTML = '<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#ef4444;"><span style="width:8px;height:8px;border-radius:50%;background:#ef4444;display:inline-block;"></span> Options Flow Anomaly Engine</span>';
    drawerBody.innerHTML = '<div style="padding:20px;color:var(--color-text-muted);">Loading report data for ' + scannerLinkHtml(symbol, 'mi-scanner-symbol-link') + '…</div>';
    drawer.classList.add('open');
    if (backdrop) backdrop.classList.add('open');

    try {
      var res = await fetch(API_URL + '/api/options-flow/report/' + encodeURIComponent(symbol));
      var json = await res.json();

      if (!json.success || !json.data) {
        drawerBody.innerHTML = '<div style="padding:20px;color:#f87171;">Failed to generate report.</div>';
        return;
      }

      var rpt = json.data;
      var v = rpt.verdict || {};
      var riskColor = v.risk_level === 'CRITICAL' ? '#ef4444' : v.risk_level === 'HIGH' ? '#f59e0b' : v.risk_level === 'ELEVATED' ? '#eab308' : '#6b7280';

      drawerSummary.textContent = v.summary || 'Report generated.';

      var html = '';

      if (rpt.company_type) {
        var ctLabel = rpt.company_type === 'reit' ? 'REIT' : rpt.company_type === 'financial_company' ? 'Financial' : rpt.company_type === 'preprofit_growth' ? 'Pre-Profit Growth' : 'Operating Company';
        var ctColor = rpt.company_type === 'reit' ? '#818cf8' : rpt.company_type === 'financial_company' ? '#f59e0b' : rpt.company_type === 'preprofit_growth' ? '#fb923c' : '#6b7280';
        html += '<div style="margin-bottom:8px;display:flex;gap:6px;align-items:center;">';
        html += '<span style="padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;background:' + ctColor + '22;color:' + ctColor + ';border:1px solid ' + ctColor + '44;">' + escHtml(ctLabel) + '</span>';
        html += '<span style="font-size:10px;color:var(--color-text-subtle);">Valuation engine: ' + escHtml(rpt.valuation_engine || 'dcf_operating') + '</span>';
        html += '</div>';
      }

      if (rpt.narrative) {
        html += '<div style="margin-bottom:16px;padding:14px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid var(--color-border);line-height:1.6;">';
        html += '<div style="font-size:11px;color:var(--color-text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Intelligence Report</div>';
        var paragraphs = rpt.narrative.split('\n\n');
        paragraphs.forEach(function(p) {
          if (p.trim()) html += '<p style="margin:0 0 10px 0;font-size:12.5px;color:var(--color-text);">' + linkKnownSymbolsHtml(p.trim(), [symbol]) + '</p>';
        });
        html += '</div>';
      }

      html += '<div style="margin-bottom:16px;padding:12px;border-radius:8px;border:1px solid ' + riskColor + '33;background:' + riskColor + '0a;">';
      html += '<div style="font-size:13px;font-weight:700;color:' + riskColor + ';margin-bottom:6px;">VERDICT: ' + escHtml(v.risk_level || 'LOW') + '</div>';
      if (v.signals && v.signals.length) {
        html += '<ul style="margin:0;padding-left:16px;font-size:12px;color:var(--color-text-muted);">';
        v.signals.forEach(function(s) { html += '<li style="margin-bottom:3px;">' + linkKnownSymbolsHtml(s, [symbol]) + '</li>'; });
        html += '</ul>';
      }
      html += '</div>';

      var of = rpt.options_flow;
      if (of && of.latest) {
        var l = of.latest;
        html += '<div style="margin-bottom:16px;">';
        html += '<div style="font-size:11px;color:var(--color-text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Options Flow (' + escHtml(l.trade_date || '') + ')</div>';
        html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">';
        var cpRatio = l.call_put_volume_ratio || ((l.total_put_volume || 0) > 0 ? (l.total_call_volume || 0) / l.total_put_volume : 0);
        var flowBias = l.flow_bias || ((l.put_call_volume_ratio || 0) >= 1.3 ? 'put_heavy' : cpRatio >= 1.3 ? 'call_heavy' : 'balanced');
        var reportTier = l.imbalance_tier || (Math.max(l.put_call_volume_ratio || 0, cpRatio) >= 20 ? 'absurd' : Math.max(l.put_call_volume_ratio || 0, cpRatio) >= 5 ? 'extreme' : Math.max(l.put_call_volume_ratio || 0, cpRatio) >= 2 ? 'heavy' : 'elevated');
        html += metricTile('Flow Bias', flowBias === 'put_heavy' ? 'Put-heavy' : flowBias === 'call_heavy' ? 'Call-heavy' : 'Balanced', flowBias === 'put_heavy' ? '#ef4444' : flowBias === 'call_heavy' ? '#4ade80' : null);
        html += metricTile('Tier', reportTier, reportTier === 'absurd' ? '#c084fc' : reportTier === 'extreme' ? '#ef4444' : reportTier === 'heavy' ? '#f59e0b' : null);
        html += metricTile('P/C Ratio', (l.put_call_volume_ratio || 0).toFixed(2), l.put_call_volume_ratio >= 2 ? '#ef4444' : l.put_call_volume_ratio >= 1.3 ? '#f59e0b' : null);
        html += metricTile('C/P Ratio', cpRatio.toFixed(2), cpRatio >= 2 ? '#4ade80' : cpRatio >= 1.3 ? '#22c55e' : null);
        html += metricTile('Put Vol', (l.total_put_volume || 0).toLocaleString());
        html += metricTile('Call Vol', (l.total_call_volume || 0).toLocaleString());
        html += metricTile('Put OI', (l.total_put_oi || 0).toLocaleString());
        html += metricTile('Call OI', (l.total_call_oi || 0).toLocaleString());
        var skewStr = l.iv_skew != null ? (l.iv_skew > 0 ? '+' : '') + (l.iv_skew * 100).toFixed(1) + '%' : 'N/A';
        html += metricTile('IV Skew', skewStr);
        html += '</div>';
        if (l.anomaly_flags && l.anomaly_flags.length) {
          html += '<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;">';
          l.anomaly_flags.forEach(function(f) {
            html += '<span style="padding:2px 6px;border-radius:4px;font-size:10px;background:rgba(239,68,68,0.15);color:#fca5a5;">' + escHtml(f) + '</span>';
          });
          html += '</div>';
        }
        html += '</div>';
      }

      var fund = rpt.fundamentals;
      if (fund) {
        html += '<div style="margin-bottom:16px;">';
        html += '<div style="font-size:11px;color:var(--color-text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Fundamentals</div>';
        var valuationSnapshot = fund.valuation_snapshot || fund.valuationSnapshot || null;
        if (valuationSnapshot) {
          var gapVal = valuationSnapshot.valuation_gap_pct;
          var gapColor = gapVal != null && Number(gapVal) < 0 ? '#ef4444' : (gapVal != null && Number(gapVal) > 0 ? '#4ade80' : null);
          var stateLabel = valuationSnapshot.state || valuationSnapshot.valuation_state || valuationSnapshot.valuationState || 'N/A';
          html += '<div style="margin-bottom:10px;">';
          html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:8px;">';
          html += metricTile('DCF State', stateLabel, /overvalued/i.test(stateLabel) ? '#ef4444' : (/undervalued/i.test(stateLabel) ? '#4ade80' : null));
          html += metricTile('DCF Gap', gapVal != null ? (Number(gapVal) > 0 ? '+' : '') + Number(gapVal).toFixed(1) + '%' : 'N/A', gapColor);
          html += metricTile('Fair Value', valuationSnapshot.fair_value_mid != null ? '$' + Number(valuationSnapshot.fair_value_mid).toFixed(2) : 'N/A');
          html += metricTile('Current', valuationSnapshot.current_price != null ? '$' + Number(valuationSnapshot.current_price).toFixed(2) : 'N/A');
          html += '</div>';
          html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:8px;">';
          html += metricTile('Low', valuationSnapshot.fair_value_low != null ? '$' + Number(valuationSnapshot.fair_value_low).toFixed(2) : 'N/A');
          html += metricTile('High', valuationSnapshot.fair_value_high != null ? '$' + Number(valuationSnapshot.fair_value_high).toFixed(2) : 'N/A');
          html += metricTile('Snapshot Price', valuationSnapshot.snapshot_price != null ? '$' + Number(valuationSnapshot.snapshot_price).toFixed(2) : 'N/A');
          html += metricTile('Quality', (valuationSnapshot.quality_grade || 'N/A') + (valuationSnapshot.quality_score != null ? ' ' + Number(valuationSnapshot.quality_score).toFixed(0) : ''));
          html += '</div>';
          html += '<div style="font-size:10px;color:var(--color-text-subtle);line-height:1.5;">Coverage: ' + escHtml((valuationSnapshot.coverage_mode || 'N/A').replace(/_/g, ' ')) + (valuationSnapshot.as_of ? ' · As of ' + escHtml(String(valuationSnapshot.as_of).slice(0, 10)) : '') + '</div>';
          html += '</div>';
        }
        if (fund.dcf_summary) {
          var dcf = fund.dcf_summary;
          html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px;">';
          html += metricTile('Fair Value', dcf.fair_value != null ? '$' + dcf.fair_value.toFixed(0) : 'N/A');
          html += metricTile('Price', dcf.current_price != null ? '$' + dcf.current_price.toFixed(0) : 'N/A');
          var upsideColor = dcf.upside_pct > 0 ? '#4ade80' : '#ef4444';
          html += metricTile('Upside', dcf.upside_pct != null ? (dcf.upside_pct > 0 ? '+' : '') + dcf.upside_pct.toFixed(0) + '%' : 'N/A', upsideColor);
          html += '</div>';
          html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:8px;">';
          html += metricTile('Sector', dcf.sector || 'N/A');
          html += metricTile('Valuation', dcf.valuation_label || 'N/A', dcf.valuation_label === 'overvalued' ? '#ef4444' : dcf.valuation_label === 'undervalued' ? '#4ade80' : null);
          html += metricTile('Quality', dcf.quality_grade || 'N/A');
          html += metricTile('Industry', dcf.industry || 'N/A');
          html += '</div>';
          html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:8px;">';
          html += metricTile('D/E', dcf.debt_to_equity != null ? String(Number(dcf.debt_to_equity).toFixed(1)) : 'N/A', dcf.debt_to_equity > 100 ? '#ef4444' : null);
          html += metricTile('Cur. Ratio', dcf.current_ratio != null ? String(Number(dcf.current_ratio).toFixed(2)) : 'N/A', dcf.current_ratio < 1 ? '#ef4444' : null);
          html += metricTile('Rev Growth', dcf.revenue_growth != null ? (dcf.revenue_growth > 0 ? '+' : '') + Number(dcf.revenue_growth).toFixed(1) + '%' : 'N/A', dcf.revenue_growth < 0 ? '#ef4444' : '#4ade80');
          html += metricTile('Profit Margin', dcf.profit_margin_pct != null ? Number(dcf.profit_margin_pct).toFixed(1) + '%' : 'N/A');
          html += '</div>';
          html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">';
          html += metricTile('FCF', dcf.free_cash_flow != null ? '$' + (dcf.free_cash_flow / 1e6).toFixed(0) + 'M' : 'N/A');
          html += metricTile('Short Float', dcf.short_float_pct != null ? Number(dcf.short_float_pct).toFixed(1) + '%' : 'N/A', dcf.short_float_pct > 10 ? '#ef4444' : null);
          html += metricTile('Short Ratio', dcf.short_ratio != null ? Number(dcf.short_ratio).toFixed(1) : 'N/A');
          html += metricTile('P/E', dcf.pe_ratio != null ? String(Number(dcf.pe_ratio).toFixed(1)) : 'N/A');
          html += '</div>';
        }

        if (fund.earnings_execution) {
          var ee = fund.earnings_execution;
          html += '<div style="margin-top:10px;">';
          html += '<div style="font-size:10px;color:var(--color-text-subtle);margin-bottom:4px;font-weight:600;">Earnings Execution:</div>';
          html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:4px;">';
          html += metricTile('Exec Score', ee.score != null ? ee.score + '/100' : 'N/A');
          html += metricTile('Beat Streak', String(ee.eps_beat_streak ?? 'N/A'));
          html += metricTile('Avg Surprise', ee.avg_eps_surprise_pct != null ? (ee.avg_eps_surprise_pct > 0 ? '+' : '') + Number(ee.avg_eps_surprise_pct).toFixed(1) + '%' : 'N/A');
          html += '</div>';
          html += '</div>';
        }

        if (fund.forward_expectations) {
          var fe = fund.forward_expectations;
          html += '<div style="margin-top:6px;">';
          html += '<div style="font-size:10px;color:var(--color-text-subtle);margin-bottom:4px;font-weight:600;">Forward Expectations:</div>';
          html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">';
          html += metricTile('Fwd Score', fe.score != null ? fe.score + '/100' : 'N/A');
          html += metricTile('Signal', fe.signal || 'N/A', fe.signal === 'supportive' ? '#4ade80' : fe.signal === 'deteriorating' ? '#ef4444' : null);
          html += metricTile('Rev Growth QoQ', fe.quarterly_revenue_growth_pct != null ? (fe.quarterly_revenue_growth_pct > 0 ? '+' : '') + Number(fe.quarterly_revenue_growth_pct).toFixed(1) + '%' : 'N/A');
          html += '</div>';
          html += '</div>';
        }

        if (fund.status_note || fund.risk_note) {
          html += '<div style="margin-top:8px;">';
          if (fund.status_note) {
            html += '<div style="padding:4px 8px;border-radius:4px;background:rgba(255,255,255,0.02);font-size:11px;color:var(--color-text-muted);margin-bottom:4px;border-left:3px solid #6b7280;">' + linkKnownSymbolsHtml(fund.status_note, [symbol]) + '</div>';
          }
          if (fund.risk_note) {
            html += '<div style="padding:4px 8px;border-radius:4px;background:rgba(239,68,68,0.04);font-size:11px;color:var(--color-text-muted);border-left:3px solid #ef4444;">' + linkKnownSymbolsHtml(fund.risk_note, [symbol]) + '</div>';
          }
          html += '</div>';
        }

        if (fund.risk_flags && fund.risk_flags.length) {
          html += '<div style="margin-top:8px;">';
          html += '<div style="font-size:10px;color:var(--color-text-subtle);margin-bottom:4px;">Risk Flags:</div>';
          fund.risk_flags.forEach(function(f) {
            var flagColor = f.severity === 'high' || f.severity === 'critical' ? '#ef4444' : f.severity === 'medium' ? '#f59e0b' : '#6b7280';
            html += '<div style="margin-bottom:4px;padding:4px 8px;border-radius:4px;border-left:3px solid ' + flagColor + ';background:rgba(255,255,255,0.02);font-size:11px;">';
            html += '<span style="color:' + flagColor + ';font-weight:600;">' + escHtml(f.label || f.code) + '</span>';
            if (f.short) html += ' <span style="color:var(--color-text);">' + linkKnownSymbolsHtml(f.short, [symbol]) + '</span>';
            if (f.detail) html += ' <span style="color:var(--color-text-muted);">— ' + linkKnownSymbolsHtml(f.detail, [symbol]) + '</span>';
            html += '</div>';
          });
          html += '</div>';
        }
        if (fund.tags && fund.tags.length) {
          html += '<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;">';
          fund.tags.forEach(function(t) {
            var label = typeof t === 'string' ? t : (t.label || t);
            var tone = typeof t === 'object' ? t.tone : null;
            var tagBg = tone === 'danger' ? 'rgba(239,68,68,0.12)' : tone === 'positive' ? 'rgba(74,222,128,0.12)' : 'var(--color-surface-hover)';
            var tagColor = tone === 'danger' ? '#fca5a5' : tone === 'positive' ? '#86efac' : 'var(--color-text-subtle)';
            html += '<span style="padding:2px 6px;border-radius:4px;font-size:10px;background:' + tagBg + ';color:' + tagColor + ';">' + escHtml(label) + '</span>';
          });
          html += '</div>';
        }
        html += '</div>';
      }

      if (rpt.insider_activity && rpt.insider_activity.length) {
        html += '<div style="margin-bottom:16px;">';
        html += '<div style="font-size:11px;color:var(--color-text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Recent Insider Activity</div>';
        rpt.insider_activity.forEach(function(t) {
          var isSell = (t.transaction_type || '').includes('S');
          var txColor = isSell ? '#ef4444' : '#4ade80';
          html += '<div style="display:flex;justify-content:space-between;font-size:11px;padding:3px 0;border-bottom:1px solid var(--color-border-subtle);">';
          html += '<span style="color:var(--color-text-muted);">' + escHtml(t.filing_date || '') + '</span>';
          html += '<span style="color:var(--color-text);">' + escHtml(t.reporter_name || '').slice(0, 25) + '</span>';
          html += '<span style="color:' + txColor + ';font-weight:600;">' + escHtml(t.transaction_type || '') + '</span>';
          html += '<span style="color:var(--color-text-muted);">' + (t.shares || 0).toLocaleString() + ' @ $' + (t.price_per_share || 0).toFixed(2) + '</span>';
          html += '</div>';
        });
        html += '</div>';
      }

      var sb = rpt.social_buzz;
      if (sb) {
        html += '<div style="margin-bottom:16px;">';
        html += '<div style="font-size:11px;color:var(--color-text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Social Buzz</div>';
        html += '<div style="font-size:11px;color:var(--color-text-subtle);margin-bottom:8px;">' + escHtml(sb.source_label || 'StockTwits + Yahoo Finance') + '</div>';

        var sentScore = sb.sentiment_score;
        var sentLabel = sb.sentiment_label || '';
        if (sentLabel) {
          var sentColor = sentLabel === 'very_bullish' || sentLabel === 'bullish' ? '#4ade80' : sentLabel === 'very_bearish' || sentLabel === 'bearish' ? '#ef4444' : '#6b7280';
          html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px;">';
          html += metricTile('Sentiment', sentLabel.replace(/_/g, ' '), sentColor);
          html += metricTile('Score', sentScore != null ? String(sentScore) : 'N/A', sentColor);
          html += metricTile('Messages', String(sb.sampled_message_count || sb.message_count || 0));
          html += '</div>';
        }

        if (sb.bullish_pct != null || sb.bearish_pct != null) {
          html += '<div style="display:flex;gap:8px;margin-bottom:8px;font-size:11px;">';
          if (sb.bullish_pct != null) html += '<span style="color:#4ade80;">Bullish: ' + sb.bullish_pct.toFixed(0) + '%</span>';
          if (sb.bearish_pct != null) html += '<span style="color:#ef4444;">Bearish: ' + sb.bearish_pct.toFixed(0) + '%</span>';
          html += '</div>';
        }

        var msgs = Array.isArray(sb.recent_messages) ? sb.recent_messages : [];
        if (msgs.length) {
          var srcCounts = {};
          msgs.forEach(function(m) {
            var s = m.source || 'Unknown';
            srcCounts[s] = (srcCounts[s] || 0) + 1;
          });
          html += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">';
          Object.keys(srcCounts).forEach(function(src) {
            html += '<span style="padding:2px 6px;border-radius:4px;font-size:10px;background:var(--color-surface-hover);color:var(--color-text-subtle);">' + escHtml(src) + ': ' + srcCounts[src] + '</span>';
          });
          html += '</div>';

          msgs.slice(0, 8).forEach(function(m) {
            var mSent = m.sentiment;
            var mColor = mSent === 'Bullish' ? '#4ade80' : mSent === 'Bearish' ? '#ef4444' : 'var(--color-text-subtle)';
            html += '<div style="margin-bottom:4px;padding:4px 8px;border-radius:4px;background:rgba(255,255,255,0.02);font-size:11px;border-left:3px solid ' + mColor + ';">';
            html += '<span style="color:var(--color-text-subtle);font-weight:600;font-size:10px;">[' + escHtml(m.source || '') + ']</span> ';
            html += '<span style="color:var(--color-text-muted);">' + linkKnownSymbolsHtml(String(m.body || '').slice(0, 200), [symbol]) + '</span>';
            html += '</div>';
          });
        }
        html += '</div>';
      }

      drawerBody.innerHTML = html;

    } catch (err) {
      drawerBody.innerHTML = '<div style="padding:20px;color:#f87171;">Error: ' + escHtml(String(err)) + '</div>';
    }
  };

  function metricTile(label, value, color) {
    return '<div style="padding:6px 8px;border-radius:6px;background:var(--color-surface-hover);text-align:center;">' +
      '<div style="font-size:9px;color:var(--color-text-subtle);text-transform:uppercase;">' + escHtml(label) + '</div>' +
      '<div style="font-size:14px;font-weight:700;font-family:var(--font-mono);' + (color ? 'color:' + color + ';' : '') + '">' + escHtml(value) + '</div>' +
      '</div>';
  }

  function initOptionsFlowPanel() {
    var panel = document.getElementById('mi-options-panel');
    var toggle = document.getElementById('mi-options-toggle');
    if (!panel || !toggle) return;
    var loaded = false;
    function setOpen(open) {
      panel.classList.toggle('collapsed', !open);
      toggle.textContent = open ? '\u2212' : '+';
      toggle.title = open ? 'Collapse options flow anomaly engine' : 'Expand options flow anomaly engine';
      if (open && !loaded) {
        loaded = true;
        window.miLoadOptionsAnomalies();
      }
    }
    setOpen(!panel.classList.contains('collapsed'));
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(panel.classList.contains('collapsed'));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOptionsFlowPanel);
  } else {
    initOptionsFlowPanel();
  }
})();
