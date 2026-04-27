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
  // Live-data cache (Phase 1.4: rendered in place of SAMPLE_SCENARIOS
  // once /api/market-intelligence/scenarios responds). On API failure
  // we fall back to the mock so the page is never blank.
  // ----------------------------------------------------------
  var SCENARIOS = SAMPLE_SCENARIOS.slice();
  var LIVE_DETAILS = {};

  // ----------------------------------------------------------
  // State
  // ----------------------------------------------------------
  var STATE = {
    engineView: 'both',
    macro: {
      status: 'ALL',
      coverageTiers: new Set(['barely_covered', 'lightly_covered', 'well_covered', 'mega_covered'])
    },
    social: {
      status: 'ALL',
      coverageTiers: new Set(['barely_covered', 'lightly_covered', 'well_covered']),
      minAuthenticity: 0.65,
      minZ: 3.0,
      crossPlatformOnly: false
    },
    global: {
      timeHorizon: '',
      minStrength: 0,
      minConfidence: 0,
      includeInvalidated: false,
      includeSuppressed: false
    },
    dataSource: 'mock',
    apiError: null,
    liveTotal: 0
  };

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------
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

  function isStale(scenario) {
    var sla = (scenario.engine === 'social_arbitrage' || scenario.detection_path === 'mixed_anomaly_led') ? 1800 : 7200;
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

  function flagSeverity(flag) {
    if (flag === 'LIKELY_INAUTHENTIC' || flag === 'CONTRADICTORY_REACTION' || flag === 'NO_MARKET_CONFIRMATION') return 'severity-bad';
    if (flag === 'AUTHENTICITY_BORDERLINE' || flag === 'MEGA_COVERAGE_PENALTY' || flag === 'HIGH_MAINSTREAM_SATURATION' || flag === 'LOW_PARTICIPATION') return 'severity-warn';
    return '';
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
    if (!STATE.macro.coverageTiers.has(s.coverage_tier)) return false;
    return true;
  }

  function passesSocialPanel(s) {
    if (s.engine !== 'social_arbitrage' && s.detection_path !== 'mixed_anomaly_led') return false;
    if (STATE.social.status !== 'ALL' && s.status !== STATE.social.status) return false;
    if (!STATE.social.coverageTiers.has(s.coverage_tier)) return false;
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
  function renderCard(s) {
    var card = el('div', 'mi-card');
    if (isStale(s)) card.classList.add('stale');
    card.setAttribute('data-id', s.id);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    var top = el('div', 'mi-card-top');
    var engineBadge = el('span', 'mi-card-engine ' + engineBadgeClass(s), engineLabel(s));
    top.appendChild(engineBadge);
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
    card.appendChild(el('div', 'mi-card-summary', s.summary));

    var meta = el('div', 'mi-card-meta');
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
    meta.appendChild(el('span', null, 'updated ' + fmtAge(s.last_updated_at) + (isStale(s) ? ' (stale)' : '')));
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
        flagsWrap.appendChild(el('span', 'mi-flag-chip ' + flagSeverity(f), f));
      });
      card.appendChild(flagsWrap);
    }

    if (s.top_universe_candidates && s.top_universe_candidates.length > 0) {
      var cw = el('div', 'mi-card-candidates');
      s.top_universe_candidates.slice(0, 3).forEach(function (c) {
        var row = el('div', 'mi-card-candidate-row');
        row.appendChild(el('span', 'mi-card-candidate-symbol', c.symbol));
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
  function openDrawer(s) {
    var bd = document.getElementById('mi-drawer-backdrop');
    var dr = document.getElementById('mi-drawer');
    // Kick off live-detail fetch on every open. If detail isn't cached
    // yet, the resolver re-invokes openDrawer(s) once the payload lands,
    // which re-renders the body in place. The first paint below uses
    // placeholders.
    loadDetailFromApi(s);

    var engineRow = document.getElementById('mi-drawer-engine-row');
    engineRow.innerHTML = '';
    var badge = el('span', 'mi-card-engine ' + engineBadgeClass(s), engineLabel(s));
    engineRow.appendChild(badge);
    var coverage = el('span', 'mi-card-coverage ' + coverageChipClass(s.coverage_tier, s.engine), s.coverage_tier.replace('_', ' '));
    engineRow.appendChild(coverage);
    engineRow.appendChild(el('span', 'mi-confidence-pill ' + s.confidence_level, 'confidence ' + s.confidence_level));
    if (s.validity_flags.length > 0) {
      s.validity_flags.forEach(function (f) {
        engineRow.appendChild(el('span', 'mi-flag-chip ' + flagSeverity(f), f));
      });
    }

    document.getElementById('mi-drawer-name').textContent = s.display_name;
    document.getElementById('mi-drawer-summary').textContent = s.summary;

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

    var detail = DRAWER_DETAIL[s.id] || LIVE_DETAILS[s.id];

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
        row.appendChild(el('div', 'mi-evidence-text', ev.text));
        row.appendChild(el('div', 'mi-evidence-source', ev.source));
        body.appendChild(row);
      });
    } else {
      body.appendChild(el('div', 'mi-panel-empty', 'Evidence timeline not yet wired in this mock. Phase 1 fetches GET /scenarios/' + s.slug + '/evidence.'));
    }

    body.appendChild(el('div', 'mi-drawer-section-title', 'Top universe candidates'));
    if (s.top_universe_candidates && s.top_universe_candidates.length > 0) {
      var tbl = el('table', 'mi-candidates-table');
      var thead = el('thead');
      var hr = el('tr');
      ['symbol', 'coverage', 'direction', 'rank', ''].forEach(function (h) { hr.appendChild(el('th', null, h)); });
      thead.appendChild(hr); tbl.appendChild(thead);
      var tbody = el('tbody');
      s.top_universe_candidates.forEach(function (c) {
        var tr = el('tr', 'candidate-row');
        tr.appendChild(el('td', null, c.symbol));
        tr.appendChild(el('td', null, c.coverage_tier));
        tr.appendChild(el('td', null, c.exposure_direction));
        tr.appendChild(el('td', null, c.composite_rank.toFixed(1)));
        var actionTd = el('td', null);
        var link = el('a', 'mi-open-scanner-link', 'Open in Scanner \u2192');
        link.href = '/scanner?symbol=' + c.symbol;
        actionTd.appendChild(link);
        tr.appendChild(actionTd);
        tbody.appendChild(tr);
      });
      tbl.appendChild(tbody);
      body.appendChild(tbl);
    } else {
      body.appendChild(el('div', 'mi-panel-empty', 'No tradable candidates (suppressed or untradable).'));
    }

    bd.classList.add('open');
    dr.classList.add('open');
  }

  function buildConsequenceChip(parentRow, effect) {
    var chip = el('span', 'mi-consequence-chip dir-' + effect.direction);
    if (effect.source_method === 'llm_assist') chip.classList.add('llm-assist');
    chip.textContent = effect.asset_type + ':' + effect.asset_key + ' (' + effect.magnitude + ')';
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
      source_count: 0,
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
        asset_type: e.asset_type,
        asset_key: e.asset_key,
        direction: e.exposure_direction,
        magnitude: 'moderate',
        source_method: 'derived'
      };
    }) : [];
    var secondOrder = Array.isArray(detail.second_order_effects) ? detail.second_order_effects.map(function (e) {
      return {
        asset_type: e.asset_type,
        asset_key: e.asset_key,
        direction: e.exposure_direction,
        magnitude: 'moderate',
        source_method: 'derived'
      };
    }) : [];
    var evidenceTimeline = Array.isArray(detail.evidence_timeline) ? detail.evidence_timeline.map(function (ev) {
      return {
        ts: Number(ev.published_at) || 0,
        source: ev.source_name || ev.evidence_type || '(source unknown)',
        text: ev.headline_or_label + (ev.summary ? ' — ' + ev.summary : '')
      };
    }) : [];
    return {
      first_order_effects: firstOrder,
      second_order_effects: secondOrder,
      authenticity_signals: null, // engine wires this in Phase 2; placeholders OK
      evidence_timeline: evidenceTimeline,
      candidates: Array.isArray(detail.top_universe_candidates) ? detail.top_universe_candidates : []
    };
  }

  // Data-source pill labels (visible). Tooltips hover-state.
  var DATA_SOURCE_LABELS = {
    'loading':       { label: 'loading',       title: 'Fetching scenarios from the API…' },
    'live':          { label: 'live',          title: 'Connected to /api/market-intelligence — showing real DB rows.' },
    'live-empty':    { label: 'live · empty',  title: 'API healthy but the DB has no scenarios. Run scripts/seed_dev_scenarios.py or wait for collectors.' },
    'mock-fallback': { label: 'MOCK',          title: 'API unavailable; falling back to in-memory sample fixtures.' }
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
    return fetch(API_BASE + '/scenarios?limit=200', { headers: { 'Accept': 'application/json' } })
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
        STATE.dataSource = 'mock-fallback';
        SCENARIOS = SAMPLE_SCENARIOS.slice();
        render();
        setDataSource('mock-fallback', STATE.apiError);
        // Surface to the console so devs notice during local work.
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[market-intelligence] API load failed; using mock data:', err);
        }
        return { source: 'mock-fallback', total: SCENARIOS.length, error: STATE.apiError };
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

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------
  function render() {
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

    macroToShow.sort(scenarioSort).forEach(function (s) { macroBody.appendChild(renderCard(s)); });
    socialToShow.sort(scenarioSort).forEach(function (s) { socialBody.appendChild(renderCard(s)); });

    if (macroToShow.length === 0)  macroBody.appendChild(el('div', 'mi-panel-empty', 'No scenarios match the current filters.'));
    if (socialToShow.length === 0) socialBody.appendChild(el('div', 'mi-panel-empty', 'No scenarios match the current filters.'));

    renderSummary(visibleGlobal);

    document.getElementById('mi-last-updated').textContent = new Date().toLocaleTimeString();
  }

  function scenarioSort(a, b) {
    return b.scenario_score - a.scenario_score || (b.last_updated_at - a.last_updated_at);
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
    var topSocial = visible.filter(function (s) { return (s.engine === 'social_arbitrage' || s.detection_path === 'mixed_anomaly_led') && s.status === 'EARLY' && (s.coverage_tier === 'barely_covered' || s.coverage_tier === 'lightly_covered') && (s.authenticity_score || 0) >= 0.65; }).sort(scenarioSort)[0];

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
    var tickers = (scenario.top_universe_candidates || []).slice(0, 3).map(function (c) { return c.symbol; }).join('  ');
    var row = el('div', 'mi-summary-headline-row');
    row.appendChild(el('span', 'mi-summary-headline-tickers', tickers || '(no candidates)'));
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
  // Wire-up
  // ----------------------------------------------------------
  function init() {
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

    // Mega is excluded by default for social per D22; reflect in initial state
    STATE.social.coverageTiers.delete('mega_covered');

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
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });

    document.getElementById('mi-refresh-btn').addEventListener('click', function () {
      loadFromApi();
    });

    render();
    loadFromApi();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
