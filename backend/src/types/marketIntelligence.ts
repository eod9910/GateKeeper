/**
 * Canonical type definitions for the Market Intelligence Scenario Engine.
 *
 * Mirrors the SQLite schema in
 *   backend/scripts/build_market_intelligence_db.py
 * and the API contract in
 *   .planning/plans/ACTIVE/market-intelligence-scenario-engine-prd-pdr.md
 *
 * Naming convention: snake_case throughout, matching the schema columns and
 * the over-the-wire JSON shape. JSON-encoded TEXT columns are exposed here
 * as their parsed structures; the persistence layer is responsible for
 * `JSON.parse` / `JSON.stringify` at the boundary.
 *
 * Two layers:
 *   1. Row*  interfaces — exact DB shape (one per table).
 *   2. Api*  interfaces — denormalized shapes returned by GET endpoints.
 *
 * Phase 0 deliverable. Wired by Phase 1+ services.
 */

// ============================================================================
// SCHEMA VERSION
// ============================================================================

/** Bump in lockstep with backend/scripts/build_market_intelligence_db.py. */
export const MARKET_INTELLIGENCE_SCHEMA_VERSION = 2;

// ============================================================================
// CORE ENUMS
// ============================================================================

/** Lifecycle state of a scenario. */
export type ScenarioStatus =
  | 'EARLY'
  | 'DEVELOPING'
  | 'CONFIRMED'
  | 'CROWDED'
  | 'FADING'
  | 'INVALIDATED';

/** Coarse pattern type used for scoring profile lookups + UI grouping. */
export type ScenarioType =
  | 'macro'
  | 'geopolitical'
  | 'commodity'
  | 'policy'
  | 'sector_rotation'
  | 'single_company_catalyst'
  | 'consumer_cycle'
  | 'tech_disruption'
  | 'other';

/** Tradable/research time horizon. Drives `expires_at` derivation. */
export type TimeHorizon =
  | 'intraday'
  | 'days'
  | 'weeks'
  | 'months'
  | 'quarters'
  | 'structural';

/**
 * Which engine (Macro vs Social Arbitrage) seeded the scenario, and whether
 * it later absorbed evidence from the other engine. The scoring profile and
 * filter-default rules follow this field. (PRD D21, D26, D27).
 */
export type DetectionPath =
  | 'topic_anomaly' // Social Arbitrage Engine, pure
  | 'news_cluster' // Macro Engine, pure
  | 'mixed_news_led' // Macro-seeded, later picked up an attention spike
  | 'mixed_anomaly_led'; // Social-Arb-seeded, later picked up news evidence

/**
 * High-level engine selector exposed in the API and UI. Maps onto
 * `detection_path` per PRD §API §GET /scenarios.
 */
export type EngineFilter = 'macro' | 'social_arbitrage' | 'both';

/**
 * Per-symbol coverage classification driving the asymmetric-edge filter.
 * (PRD D22). `untradable` is informational; never surfaces as a candidate.
 */
export type CoverageTier =
  | 'mega_covered'
  | 'well_covered'
  | 'lightly_covered'
  | 'barely_covered'
  | 'untradable';

/** Source-of-signal enum. Updated in lockstep with the SQL CHECK constraint. */
export type SourceType =
  // Macro Engine inputs
  | 'rss_reuters'
  | 'rss_ap'
  | 'rss_fed'
  | 'rss_eia'
  | 'rss_bls'
  | 'yahoo_news'
  | 'sec_edgar'
  // Ticker-indexed Social Arb inputs (existing infra; D28)
  | 'stocktwits'
  | 'yahoo_community'
  // Topic-indexed Social Arb inputs (v1 D29 basket)
  | 'hackernews'
  | 'fourchan_biz'
  | 'fourchan_g'
  | 'bluesky'
  | 'discord_public'
  | 'forum_audio'
  | 'forum_sneakers'
  | 'forum_beauty'
  | 'forum_watches'
  | 'forum_photo'
  | 'forum_pcbuild'
  // Cross-cutting / synthetic
  | 'consumer_cycle'
  | 'chart_ohlcv'
  | 'operator_manual';
// NOTE: Reddit values (`reddit_wsb`, `reddit_stocks`, `reddit_investing`,
// `reddit_theme`) are reserved for Phase 1.7 per D29. Not in the v1 union.

export type SignalType =
  | 'news_event'
  | 'filing_event'
  | 'social_buzz_spike'
  | 'price_confirmation'
  | 'consumer_cycle_state_change'
  | 'invalidating_event'
  | 'policy_release'
  | 'macro_release';

export type EvidenceType =
  | 'article'
  | 'filing'
  | 'social_post_cluster'
  | 'price_chart'
  | 'policy_release'
  | 'consumer_cycle_note';

export type AssetType =
  | 'equity'
  | 'sector'
  | 'industry'
  | 'commodity'
  | 'fx'
  | 'rate'
  | 'etf';

export type ExposureDirection =
  | 'long_beneficiary'
  | 'short_loser'
  | 'volatility_up'
  | 'volatility_down'
  | 'direction_uncertain';

export type ExposureOrder = 'first' | 'second' | 'third';

export type SourceMethod =
  | 'hand_curated'
  | 'llm_assist'
  | 'operator_override'
  | 'derived';

export type ThemeCategory =
  | 'macro'
  | 'geopolitical'
  | 'commodity'
  | 'policy'
  | 'sector'
  | 'tech'
  | 'consumer';

export type TargetType =
  | 'brand'
  | 'product'
  | 'category'
  | 'behavior'
  | 'keyword'
  | 'event_type';

export type ConceptCreatedBy =
  | 'llm_extractor'
  | 'operator'
  | 'seed_taxonomy';

export type ConceptIntent =
  | 'adoption'
  | 'abandonment'
  | 'complaint'
  | 'praise'
  | 'comparison'
  | 'question'
  | 'prediction';

export type CommunityTier = 'niche' | 'general' | 'mega';

export type Polarity = -1 | 0 | 1;

export type SuppressionReason =
  | 'LIKELY_INAUTHENTIC'
  | 'NO_COVERAGE_ELIGIBLE_TICKERS'
  | 'MEGA_COVERED_ONLY';

/** PRD §Authenticity Layer signal table. Weights live in authenticity-weights.json. */
export type AuthenticitySignalType =
  | 'account_age_distribution'
  | 'posting_cadence'
  | 'account_history_diversity'
  | 'cross_platform_signature'
  | 'comment_depth'
  | 'sentiment_shape'
  | 'account_quality'
  | 'mod_flag_rate'
  | 'linguistic_similarity'
  | 'promoter_co_occurrence';

/**
 * Validity flags. PRD §Confidence Layer. Some flags are engine-scoped:
 *  - Social Arbitrage only: LIKELY_INAUTHENTIC, MEGA_COVERAGE_PENALTY,
 *    AUTHENTICITY_BORDERLINE, OPERATOR_OVERRODE_AUTHENTICITY
 *  - Either engine: everything else
 * No NEWS_DRIVEN_ONLY — that pattern was intentionally removed (D27).
 */
export type ValidityFlag =
  | 'LOW_HISTORY'
  | 'ONE_SOURCE_ONLY'
  | 'LOW_PARTICIPATION'
  | 'NO_MARKET_CONFIRMATION'
  | 'CONTRADICTORY_REACTION'
  | 'HIGH_MAINSTREAM_SATURATION'
  | 'EXPOSURE_MAP_WEAK'
  | 'LOW_UNIVERSE_MATCH'
  | 'NO_GOOD_EXPRESSION'
  | 'THESIS_REAL_EXECUTION_DELAYED'
  | 'STALE'
  | 'CONVICTION_LAYER_UNRELIABLE'
  | 'LLM_BUDGET_EXHAUSTED'
  | 'LIKELY_INAUTHENTIC'
  | 'MEGA_COVERAGE_PENALTY'
  | 'AUTHENTICITY_BORDERLINE'
  | 'OPERATOR_OVERRODE_AUTHENTICITY';

/** UI-friendly bucket derived from `confidence_score` at write time. */
export type ConfidenceLevel = 'low' | 'medium' | 'high';

// ============================================================================
// JSON COLUMN SHAPES
// ============================================================================

/**
 * Shape of an entry inside `market_situations.first_order_effects_json` /
 * `second_order_effects_json`. Snapshotted at recompute time so the card
 * renders without a JOIN.
 */
export interface OrderEffectSnapshot {
  asset_type: AssetType;
  asset_key: string;
  exposure_direction: ExposureDirection;
  exposure_strength: number;
  rationale: string;
}

/**
 * Shape of an entry inside `emerging_topics.resolved_tickers_json`.
 * The Social Arbitrage Engine resolves a (concept, target) pair to one
 * or more candidate tickers and copies their coverage tier here for fast
 * downstream filtering.
 */
export interface ResolvedTickerEntry {
  ticker: string;
  coverage_tier: CoverageTier;
  source_method: SourceMethod;
  confidence: number;
}

/** Shape of `concept_daily_counts.intent_mix_json`. */
export type IntentMix = Partial<Record<ConceptIntent, number>>;

/**
 * Shape of `topic_baselines.dow_multipliers_json` — 7-element array
 * (Mon..Sun) of multiplicative adjustments.
 */
export type DowMultipliers = [number, number, number, number, number, number, number];

/**
 * Shape of `topic_baselines.monthly_seasonality_json` — 12-element array
 * (Jan..Dec) of multiplicative adjustments. Only populated when ≥ 90 days
 * of history exists.
 */
export type MonthlySeasonality = [
  number, number, number, number, number, number,
  number, number, number, number, number, number,
];

/**
 * Shape of `emerging_topics.authenticity_signals_json` — per-signal
 * value/weight/note triples used to render the audit drawer.
 */
export interface AuthenticitySignalSnapshot {
  signal_type: AuthenticitySignalType;
  signal_value: number;
  weight: number;
  notes?: string;
}

/**
 * Shape of `market_situations.conviction_layer_json` — templated LLM output
 * (PRD §Conviction Producer). Schema-validated before persistence.
 */
export interface ConvictionLayer {
  thesis_summary: string;
  why_now: string;
  what_breaks_it: string;
  expression_notes: string;
  generated_at: number;
  prompt_template_version: string;
  cited_evidence_ids: number[];
}

// ============================================================================
// ROW INTERFACES — one per table, exact DB shape
// ============================================================================

/** schema_meta — single-row migration anchor table. */
export interface RowSchemaMeta {
  key: string;
  value: string;
  updated_at: number;
}

/** theme_registry — closed list of valid `primary_theme` values. */
export interface RowThemeRegistry {
  theme_key: string;
  display_name: string;
  category: ThemeCategory;
  taxonomy_version: number;
  created_at: number;
}

/**
 * tracked_concepts — growing registry of (concept, target) pairs the
 * Social Arbitrage Engine is z-scoring. (PRD D21).
 */
export interface RowTrackedConcept {
  id: number;
  concept_key: string;
  target_type: TargetType;
  target_key: string;
  display_label: string;
  created_at: number;
  created_by: ConceptCreatedBy;
  /** `active` | `merged_into:<id>` | `pruned`. Free-form to capture the merge target. */
  status: string;
  metadata_json: Record<string, unknown> | null;
}

/** coverage_tiers — per-symbol classification refreshed weekly. (PRD D22). */
export interface RowCoverageTier {
  symbol: string;
  coverage_tier: CoverageTier;
  sellside_analyst_count: number | null;
  market_cap_usd: number | null;
  institutional_ownership_pct: number | null;
  mainstream_mention_count_90d: number | null;
  daily_dollar_volume_avg: number | null;
  composite_score: number | null;
  as_of: number;
}

/** brand_to_ticker — small registry mapping brand keys to public parents. */
export interface RowBrandToTicker {
  brand_key: string;
  parent_ticker: string;
  secondary_tickers_json: string[] | null;
  confidence: number;
  source_method: SourceMethod;
  created_at: number;
}

/**
 * market_situations — the canonical scenario record. JSON columns are
 * shown here as their parsed structures; the persistence layer handles
 * encode/decode at the boundary.
 */
export interface RowMarketSituation {
  id: number;
  slug: string;
  title: string;
  summary: string;
  primary_theme: string; // FK → theme_registry.theme_key
  scenario_type: ScenarioType;
  status: ScenarioStatus;
  signal_strength: number; // 0..100
  confidence_score: number; // 0..1
  confidence_level: ConfidenceLevel;
  time_horizon: TimeHorizon;
  started_at: number;
  last_confirmed_at: number | null;
  last_updated_at: number;
  expires_at: number | null;
  event_score: number | null;
  attention_score: number | null;
  market_confirmation_score: number | null;
  crowding_score: number | null;
  source_breadth_score: number | null;
  evidence_count: number;
  first_order_effects_json: OrderEffectSnapshot[] | null;
  second_order_effects_json: OrderEffectSnapshot[] | null;
  validity_flags_json: ValidityFlag[] | null;
  confidence_reasons_json: string[] | null;
  conviction_layer_json: ConvictionLayer | null;
  conviction_pack_hash: string | null;
  detection_path: DetectionPath;
  seeded_emerging_topic_id: number | null;
  coverage_tier: CoverageTier | null;
  authenticity_score: number | null;
  peak_z_score: number | null;
  /** SQLite stores 0/1; surface as boolean to TS callers. */
  cross_platform_corroboration: boolean;
  edge_multiplier: number;
  metadata_json: Record<string, unknown> | null;
  schema_version: number;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
}

/** situation_signals — normalized inputs that contributed to a scenario. */
export interface RowSituationSignal {
  id: number;
  situation_id: number;
  signal_type: SignalType;
  source_type: SourceType;
  source_id: string;
  entity: string | null;
  theme: string | null;
  score: number; // 0..1
  weight: number;
  observed_at: number;
  ingested_at: number;
  payload_json: Record<string, unknown> | null;
}

/** situation_evidence — human-readable evidence with traceability. */
export interface RowSituationEvidence {
  id: number;
  situation_id: number;
  evidence_type: EvidenceType;
  source_name: string;
  headline_or_label: string;
  summary: string | null;
  url: string | null;
  published_at: number;
  importance_score: number | null;
  novelty_score: number | null;
  signal_id: number | null;
  payload_json: Record<string, unknown> | null;
}

/** situation_exposure — scenario → sector/asset/security mapping. */
export interface RowSituationExposure {
  id: number;
  situation_id: number;
  asset_type: AssetType;
  asset_key: string;
  exposure_direction: ExposureDirection;
  exposure_order: ExposureOrder;
  exposure_strength: number; // 0..1
  source_method: SourceMethod;
  rationale: string | null;
  confidence: number; // 0..1
  universe_symbol: string | null;
  dcf_gap_pct: number | null;
  quality_score: number | null;
  technical_score: number | null;
  final_buzz_score: number | null;
  composite_rank: number | null;
  last_ranked_at: number | null;
  payload_json: Record<string, unknown> | null;
}

/**
 * concept_mentions — highest-volume table; one row per (post/comment, concept)
 * extraction. Pruned to concept_daily_counts after 90 days.
 */
export interface RowConceptMention {
  id: number;
  concept_id: number;
  signal_id: number;
  community: string;
  community_tier: CommunityTier;
  polarity: Polarity;
  intent: ConceptIntent;
  mentioned_at: number;
  extraction_confidence: number; // 0..1
}

/** concept_daily_counts — pre-aggregated daily summary. */
export interface RowConceptDailyCount {
  concept_id: number;
  community: string;
  /** unix midnight UTC */
  day: number;
  mention_count: number;
  unique_authors: number;
  polarity_mean: number | null;
  intent_mix_json: IntentMix | null;
}

/** topic_baselines — per-(concept, community) baseline statistics. */
export interface RowTopicBaseline {
  concept_id: number;
  community: string;
  as_of_day: number;
  rolling_mean_30d: number;
  rolling_stdev_30d: number;
  dow_multipliers_json: DowMultipliers | null;
  monthly_seasonality_json: MonthlySeasonality | null;
  min_mention_floor: number;
  data_days: number;
}

/**
 * emerging_topics — output of the z-score engine. Seeds a market_situation
 * iff it passes both the authenticity gate and the coverage filter.
 */
export interface RowEmergingTopic {
  id: number;
  concept_id: number;
  seed_community: string;
  peak_z_score: number;
  current_z_score: number;
  corroborating_communities_json: string[] | null;
  cross_platform_corroboration: boolean;
  /** PRD D28 — true when chatter migrates to a ticker-indexed source. */
  migration_to_ticker_indexed: boolean;
  /** Set on the first true→false transition of `migration_to_ticker_indexed`. */
  migrated_at: number | null;
  first_anomaly_at: number;
  last_anomaly_at: number;
  total_mentions: number;
  unique_authors: number;
  authenticity_score: number; // 0..1
  authenticity_signals_json: AuthenticitySignalSnapshot[] | null;
  resolved_target_type: TargetType | null;
  resolved_tickers_json: ResolvedTickerEntry[] | null;
  seeded_situation_id: number | null;
  suppression_reason: SuppressionReason | null;
  created_at: number;
  updated_at: number;
}

/**
 * authenticity_signals — per-signal audit row. Stored separately from
 * emerging_topics so scoring weights can iterate without losing history.
 */
export interface RowAuthenticitySignal {
  id: number;
  emerging_topic_id: number;
  as_of: number;
  signal_type: AuthenticitySignalType;
  signal_value: number; // 0..1
  weight: number; // 0..1
  notes: string | null;
}

// ============================================================================
// API RESPONSE TYPES — denormalized shapes returned by GET endpoints
// ============================================================================

/**
 * One element of `top_universe_candidates` in the scenario list response.
 * Computed snapshot — no JOIN needed at GET time.
 */
export interface ApiUniverseCandidate {
  symbol: string;
  composite_rank: number;
  coverage_tier: CoverageTier;
  exposure_direction: ExposureDirection;
}

/**
 * Per-row response shape for `GET /scenarios`.
 * Mirrors PRD §API §GET /scenarios JSON example verbatim.
 */
export interface ApiScenarioListItem {
  id: number;
  slug: string;
  title: string;
  summary: string;
  status: ScenarioStatus;
  scenario_type: ScenarioType;
  primary_theme: string;
  detection_path: DetectionPath;
  seeded_emerging_topic_id: number | null;
  coverage_tier: CoverageTier | null;
  edge_multiplier: number;
  authenticity_score: number | null;
  peak_z_score: number | null;
  cross_platform_corroboration: boolean;
  signal_strength: number;
  confidence_score: number;
  confidence_level: ConfidenceLevel;
  time_horizon: TimeHorizon;
  /** Per-engine scoring profile output (PRD §Proposed Scoring Framework). */
  scenario_score: number;
  /**
   * Aggregate breadth of distinct sources backing the scenario (0..1). Null
   * until the collector pipeline has run and `situation_signals` rolls up.
   * UI surfaces this so analysts can distinguish single-source rows from
   * cross-platform corroborated rows at a glance.
   */
  source_breadth_score: number | null;
  started_at: number;
  last_updated_at: number;
  expires_at: number | null;
  evidence_count: number;
  validity_flags: ValidityFlag[];
  top_universe_candidates: ApiUniverseCandidate[];
  /** Server-computed `now - last_updated_at`; lets the UI badge stale rows. */
  freshness_seconds: number;
  schema_version: number;
}

/** Detail response for `GET /scenarios/:id_or_slug`. */
export interface ApiScenarioDetail extends ApiScenarioListItem {
  first_order_effects: OrderEffectSnapshot[];
  second_order_effects: OrderEffectSnapshot[];
  confidence_reasons: string[];
  conviction_layer: ConvictionLayer | null;
  affected_sectors: string[];
  affected_assets: string[];
  evidence_timeline: ApiEvidenceItem[];
  consequence_map: ApiConsequenceGraph;
  exposure_list: RowSituationExposure[];
  /** Capped at 20 by the API. */
  top_universe_candidates: ApiUniverseCandidate[];
}

/** A single timeline entry in the scenario detail response. */
export interface ApiEvidenceItem {
  id: number;
  evidence_type: EvidenceType;
  source_name: string;
  headline_or_label: string;
  summary: string | null;
  url: string | null;
  published_at: number;
  importance_score: number | null;
}

/**
 * Graph form of the consequence map (UI rendering). Nodes are themes /
 * sectors / assets; edges carry exposure_direction + order.
 */
export interface ApiConsequenceGraph {
  nodes: Array<{
    id: string;
    label: string;
    kind: 'theme' | AssetType;
  }>;
  edges: Array<{
    from: string;
    to: string;
    exposure_direction: ExposureDirection;
    exposure_order: ExposureOrder;
    exposure_strength: number;
  }>;
}

/** Per-row response shape for `GET /emerging-topics`. */
export interface ApiEmergingTopicItem {
  id: number;
  concept: {
    id: number;
    concept_key: string;
    target_type: TargetType;
    target_key: string;
    display_label: string;
  };
  seed_community: string;
  peak_z_score: number;
  current_z_score: number;
  corroborating_communities: string[];
  cross_platform_corroboration: boolean;
  migration_to_ticker_indexed: boolean;
  migrated_at: number | null;
  first_anomaly_at: number;
  last_anomaly_at: number;
  total_mentions: number;
  unique_authors: number;
  authenticity_score: number;
  resolved_target_type: TargetType | null;
  resolved_tickers: ResolvedTickerEntry[];
  seeded_situation_id: number | null;
  suppression_reason: SuppressionReason | null;
}

/** Per-row response shape for `GET /coverage-tiers/:symbol`. */
export interface ApiCoverageTierItem extends RowCoverageTier {
  /** Server-computed: the multiplier applied in the Social Arbitrage scoring profile. */
  edge_multiplier: number;
}

// ============================================================================
// QUERY PARAMETERS — typed shapes for API request validation
// ============================================================================

export interface ScenarioListQuery {
  status?: ScenarioStatus[];
  theme?: string;
  scenario_type?: ScenarioType;
  time_horizon?: TimeHorizon;
  engine?: EngineFilter;
  detection_path?: DetectionPath[];
  coverage_tier?: CoverageTier[];
  /** Default 0.65; applied only to Social Arbitrage scenarios. */
  min_authenticity_score?: number;
  min_signal_strength?: number;
  min_confidence?: number;
  /** Filters Social Arbitrage scenarios; ignored for Macro. */
  min_peak_z?: number;
  cross_platform_only?: boolean;
  only_early?: boolean;
  include_archived?: boolean;
  include_invalidated?: boolean;
  /** Required to see LIKELY_INAUTHENTIC rows. */
  include_suppressed?: boolean;
  limit?: number;
}

export interface EmergingTopicListQuery {
  min_z?: number;
  min_authenticity?: number;
  cross_platform_only?: boolean;
  community?: string;
  concept_target_type?: TargetType;
  seeded_only?: boolean;
  include_suppressed?: boolean;
  limit?: number;
}

// ============================================================================
// HELPER UTILITY TYPES
// ============================================================================

/**
 * `detection_path` → engine bucket. Useful for routing to the correct
 * scoring profile (PRD D27).
 */
export type EngineBucketFor<P extends DetectionPath> =
  P extends 'topic_anomaly' | 'mixed_anomaly_led' ? 'social_arbitrage' :
  P extends 'news_cluster' | 'mixed_news_led' ? 'macro' :
  never;

export function engineBucket(path: DetectionPath): 'macro' | 'social_arbitrage' {
  switch (path) {
    case 'topic_anomaly':
    case 'mixed_anomaly_led':
      return 'social_arbitrage';
    case 'news_cluster':
    case 'mixed_news_led':
      return 'macro';
  }
}

/**
 * Validity flags that may only fire on Social Arbitrage scenarios.
 * Macro scenarios producing these flags is a bug (PRD §Confidence Layer).
 */
export const SOCIAL_ARBITRAGE_ONLY_FLAGS: readonly ValidityFlag[] = [
  'LIKELY_INAUTHENTIC',
  'MEGA_COVERAGE_PENALTY',
  'AUTHENTICITY_BORDERLINE',
  'OPERATOR_OVERRODE_AUTHENTICITY',
] as const;

/** Coverage tiers eligible for the default Social Arbitrage stream (D22). */
export const SOCIAL_ARBITRAGE_DEFAULT_COVERAGE_TIERS: readonly CoverageTier[] = [
  'barely_covered',
  'lightly_covered',
  'well_covered',
] as const;

/**
 * Default `expires_at` offset (in seconds) keyed by `time_horizon`.
 * Computed at write time per PRD §Backend Data Model.
 */
export const TIME_HORIZON_EXPIRY_SECONDS: Record<TimeHorizon, number | null> = {
  intraday: 1 * 86400,
  days: 14 * 86400,
  weeks: 90 * 86400,
  months: 365 * 86400,
  quarters: 730 * 86400,
  structural: null,
};
