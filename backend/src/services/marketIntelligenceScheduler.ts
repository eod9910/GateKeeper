/**
 * Market Intelligence scheduler.
 *
 * Mirrors the operational pattern of `socialIntelligenceScheduler.ts`, but
 * generalised to a multi-job registry so each collector / engine / rollup can
 * have its own cadence (PRD §Operational Architecture).
 *
 * v1 registers a single job:
 *   - hackernews_collector (every 30 min, disabled by default)
 *
 * Adding more jobs is a matter of appending to JOB_REGISTRY below.
 *
 * Persistence
 *   - Config             json_documents [namespace=market_intelligence_scheduler, key=config]
 *                        + mirrored to backend/data/preferences/market-intelligence-schedule.local.json
 *   - Per-job runtime    json_documents [namespace=market_intelligence_scheduler, key=runtime:<job_name>]
 *
 * IMPORTANT — config precedence (footgun, see open-infra item in
 * `.planning/plans/ACTIVE/market-intelligence-checklist.md`, discovered
 * 2026-04-27):
 *
 *   loadMarketIntelligenceScheduleConfig() resolves in this order:
 *     1. in-memory `_config` (set on first read of either backing store)
 *     2. SQLite `app-state.sqlite` (json_documents row above)        <-- WINS
 *     3. JSON file `market-intelligence-schedule.local.json`         <-- LEGACY
 *     4. defaultConfig() (everything disabled)
 *
 *   Practical consequence: if you hand-edit the JSON file while the SQLite
 *   row exists, your edits will be SILENTLY IGNORED — the in-memory cache
 *   was hydrated from SQLite at server start, persistConfig() always writes
 *   both stores, and the file is then re-overwritten on the next save.
 *
 *   Always update the schedule via `POST /scheduler/config` (which calls
 *   persistConfig() and writes to BOTH stores). To intentionally drop SQLite
 *   state and bootstrap from a hand-edited JSON file, delete the
 *   namespace=market_intelligence_scheduler / document_key=config row from
 *   `backend/data/app-state.sqlite` first, then restart the server.
 *
 * Notes
 *   - This service intentionally does NOT call into the synchronous
 *     `POST /collectors/:source_type/run` path (that endpoint stays for ad-hoc
 *     dev triggering). The scheduler spawns its own child processes
 *     fire-and-forget so cron tick handlers return immediately.
 *   - On server start, `resumeMarketIntelligenceSchedulerFromDisk()` rehydrates
 *     config and re-arms cron handlers. Any runtime row that was left in
 *     `running: true` (i.e. a previous server died mid-collection) is reset.
 */

import cron, { ScheduledTask } from 'node-cron';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import {
  hasJsonDocument,
  readJsonDocument,
  writeJsonDocument,
} from './appStateDb';

// ----------------------------------------------------------------------------
// Constants + paths
// ----------------------------------------------------------------------------

const SCHEDULER_NAMESPACE = 'market_intelligence_scheduler';
const CONFIG_DOCUMENT_KEY = 'config';
const RUNTIME_DOCUMENT_KEY_PREFIX = 'runtime:';

const LOCAL_CONFIG_FILE = path.join(
  __dirname,
  '..',
  '..',
  'data',
  'preferences',
  'market-intelligence-schedule.local.json',
);

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

const COLLECTOR_SCRIPTS_DIR = path.join(
  PROJECT_ROOT,
  'backend',
  'scripts',
);

function getPythonLauncher(): string {
  return (
    process.env.MI_PYTHON_BIN ||
    (process.platform === 'win32' ? 'py' : process.env.PYTHON || 'python3')
  );
}

// ----------------------------------------------------------------------------
// Job registry — append-only as new collectors / engines / rollups land
// ----------------------------------------------------------------------------

export type JobKind = 'collector' | 'engine' | 'rollup';

export interface JobDefinition {
  /** Stable internal name. Used as the runtime document key suffix. */
  name: string;
  kind: JobKind;
  /** Absolute path to the Python script the job spawns. */
  scriptPath: string;
  /** Default cron expression (overridable in config). */
  defaultCronExpression: string;
  /** Default IANA timezone (overridable in config). */
  defaultTimezone: string;
  /** Human-readable description for the operator UI. */
  description: string;
  /** Default CLI arguments passed to the Python script. */
  defaultArgs: string[];
}

const JOB_REGISTRY: readonly JobDefinition[] = [
  {
    name: 'hackernews_collector',
    kind: 'collector',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'collect_hackernews_intraday.py',
    ),
    defaultCronExpression: '*/30 * * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Collect Hacker News stories + comments for tracked concepts (PRD D29).',
    defaultArgs: ['--since-hours', '6', '--max-pages', '5'],
  },
  {
    name: 'fourchan_collector',
    kind: 'collector',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'collect_fourchan_intraday.py',
    ),
    // Stagger 5 minutes off HN so we don't pound both APIs at the same
    // wall-clock minute. /biz/ + /g/ catalogs roll fast enough that
    // every 30 min is plenty of resolution.
    defaultCronExpression: '5,35 * * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Collect 4chan /biz/ + /g/ catalog OPs and last_replies for tracked concepts. ' +
      'Provides cross-platform corroboration alongside the HN collector (PRD D29).',
    defaultArgs: ['--since-hours', '6', '--boards', 'biz,g'],
  },
  {
    name: 'bluesky_collector',
    kind: 'collector',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'collect_bluesky_intraday.py',
    ),
    // Stagger 10 minutes off HN (and 5 off 4chan) so the three pollers
    // don't fight for outbound bandwidth on the same wall-clock minute.
    // Bluesky's public endpoint is rate-limited to 3000 req / 5 min per
    // IP, well above what 50-200 concepts need at this cadence.
    defaultCronExpression: '10,40 * * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Collect Bluesky posts for tracked concepts via app.bsky.feed.searchPosts. ' +
      'Third source-type alongside HN + 4chan, unlocks real cross-platform ' +
      'corroboration for the z-score engine (PRD D29).',
    defaultArgs: ['--since-hours', '6', '--max-pages', '3'],
  },
  {
    name: 'niche_forums_collector',
    kind: 'collector',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'collect_niche_forums.py',
    ),
    // Hourly at :20 — staggered 10 min off Bluesky, 15 off 4chan, 20 off
    // HN. Forum RSS feeds update slowly (XenForo caches feeds for 60s,
    // most threads stay live for hours), so an hourly cadence is plenty
    // and cuts our outbound footprint to 7 GETs / hour.
    defaultCronExpression: '20 * * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Collect niche-forum RSS/Atom feeds for tracked concepts (≥6 forums: ASR, ' +
      'Head-Fi, Tom\'s Hardware, Guru3D, Steve Hoffman, Gearspace, Bogleheads). ' +
      'Fourth source-type "forum" alongside HN/4chan/Bluesky — surfaces practitioner ' +
      'discussion that often precedes broader social chatter (PRD D08 trade-craft signal).',
    defaultArgs: ['--since-hours', '6'],
  },
  {
    name: 'discord_collector',
    kind: 'collector',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'collect_discord_intraday.py',
    ),
    // Stagger at :25/:55 — 5 min after forums (:20), 15 off Bluesky (:10/:40),
    // 20 off 4chan (:05/:35), and 5 min before concept_extraction (:27/:57).
    // The :25 hits will be picked up on the :42 extraction tick (cursor-based,
    // no data loss). Discord global rate limit is 50 req/sec; ~12 servers * 3
    // pages each = ~36 GETs / tick, well within budget.
    //
    // FIFTH source-type alongside HN/4chan/Bluesky/forums — completes Phase 1's
    // multi-platform corroboration target (PRD D29). The collector returns a
    // success envelope with auth_mode="skipped" if DISCORD_BOT_TOKEN is unset,
    // so registering the job is safe even before the operator wires creds.
    //
    // Operator setup (one-time, see backend/data/preferences/discord-servers.json):
    //   1. Create a Discord application + bot, enable MESSAGE CONTENT INTENT.
    //   2. Set DISCORD_BOT_TOKEN env var (or pass via POST /collectors/discord/run).
    //   3. Invite the bot to every guild with View Channels + Read Message History.
    //   4. Populate discord-servers.json with real guild_id + channel_id snowflakes.
    defaultCronExpression: '25,55 * * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Collect Discord messages from operator-curated public servers/channels for ' +
      'tracked concepts. Polls REST /channels/:id/messages (no Gateway/WebSocket) ' +
      'so it slots into the same cron model as HN/4chan/Bluesky/forums. Gracefully ' +
      'skips with auth_mode="skipped" when DISCORD_BOT_TOKEN is unset, so the job ' +
      'can be registered before credentials are provisioned (PRD D29).',
    defaultArgs: ['--since-hours', '1', '--max-pages-per-channel', '3'],
  },
  {
    name: 'macro_fed_collector',
    kind: 'collector',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'collect_macro_fed_intraday.py',
    ),
    // Hourly at :47 — clean slot between authenticity (:37/:52),
    // concept_extraction (:42/:57) and forums (:20). Fed publishes a few
    // releases per business day at most, so hourly polling with a 2-hour
    // lookback window means we can miss one tick and still recover.
    //
    // FIRST Macro Engine source-type (PRD Phase 1.5). Lands hits in
    // mi_raw_hits with source_type='rss_federal_reserve' and
    // matched_concept_ids_json='[]' so they're invisible to the social-arb
    // concept_daily_counts rollup but visible to the upcoming embedding +
    // clustering pipeline (separate Phase 1.5 deliverables).
    defaultCronExpression: '47 * * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Collect Federal Reserve RSS feeds (press_all, press_monetary, speeches, ' +
      'testimony) for the Macro Engine. Public, no auth, ~10kB per feed; lands ' +
      'in mi_raw_hits with source_type="rss_federal_reserve" and an empty ' +
      'matched_concept_ids_json so the social-arb stack ignores it while the ' +
      'Phase 1.5 embedding/clustering pipeline picks it up.',
    defaultArgs: ['--since-hours', '2'],
  },
  {
    name: 'macro_news_collector',
    kind: 'collector',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'collect_macro_news_intraday.py',
    ),
    // Hourly at :52 — 5 min after macro_fed (:47), staggered off
    // authenticity (:52 is the same minute, but authenticity runs on a
    // different cadence — :7/:22/:37/:52 vs this job at :52 only).
    // Pulls Yahoo Finance + Reuters + AP via Google News RSS proxy.
    // Google News returns ~100 items per source per day, so an hourly
    // tick with --since-hours 2 gives ample overlap for missed ticks.
    defaultCronExpression: '52 * * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Collect macro news from Yahoo Finance RSS + Reuters/AP via Google News ' +
      'RSS proxy. Lands in mi_raw_hits with source_type "rss_yahoo_finance", ' +
      '"rss_reuters", "rss_ap" and empty matched_concept_ids_json. ' +
      'Phase 1.5 second macro collector.',
    defaultArgs: ['--since-hours', '2'],
  },
  {
    name: 'macro_econ_collector',
    kind: 'collector',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'collect_macro_econ_intraday.py',
    ),
    // Every 6 hours at :03 (03:03, 09:03, 15:03, 21:03). EIA updates
    // daily (weekdays); BLS monthly. 6-hour cadence with idempotent
    // dedup means we catch every release well within the same day.
    // Uses DEMO_KEY for EIA (30 req/hr) and unauthenticated BLS
    // (25 req/day) by default — operator can set EIA_API_KEY and
    // BLS_API_KEY env vars for higher limits.
    defaultCronExpression: '3 */6 * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Collect EIA (WTI crude, Henry Hub nat gas) and BLS (CPI-U, nonfarm ' +
      'employment) economic data via JSON APIs. Synthesises title + body text ' +
      'for the embedding pipeline. Phase 1.5 third macro collector.',
    defaultArgs: ['--eia-lookback', '10'],
  },
  {
    name: 'embedding_pipeline',
    kind: 'engine',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'run_embedding_pipeline.py',
    ),
    // Every 2 hours at :07 — processes all unembedded macro hits since the
    // last run. Sits AFTER macro collectors (fed :47, news :52, econ :03)
    // so each tick sees freshly collected hits. Loads the sentence-transformer
    // model once per run (~5s cold start, <1s warm) and embeds in batches
    // of 64. Dictionary-based entity extraction uses universe_clean.json
    // (4,313 stocks). Typical throughput: ~350 hits/min.
    defaultCronExpression: '7 */2 * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Embed macro hits with sentence-transformers/all-MiniLM-L6-v2 and extract ' +
      'entities (tickers, commodities, policy bodies, countries, sectors) via ' +
      'dictionary matching against universe_clean.json. Writes to hit_embeddings ' +
      'table for downstream cluster matching (PRD D21 M2).',
    defaultArgs: ['--batch-size', '64'],
  },
  {
    name: 'macro_clustering',
    kind: 'engine',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'run_macro_clustering.py',
    ),
    // Every 2 hours at :12 — runs 5 min after the embedding pipeline (:07)
    // so freshly embedded hits are available for cluster matching. Cosine
    // threshold 0.78 + min 1 shared entity per PRD D4 / D21 M3.
    defaultCronExpression: '12 */2 * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Macro Engine cluster matching (PRD D21 M3-M4). Matches embedded macro hits ' +
      'against open news_cluster scenarios by cosine similarity (>=0.78) + entity ' +
      'overlap (>=1). Creates new market_situations or attaches evidence to existing ones.',
    defaultArgs: ['--limit', '1000', '--commit-every', '100'],
  },
  {
    name: 'news_consequence_analysis',
    kind: 'engine',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'run_news_consequence_analysis.py',
    ),
    defaultCronExpression: '14 */2 * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'LLM consequence-analysis pass for newly created Macro scenarios. ' +
      'Runs immediately after macro_clustering to reason through market ' +
      'ramifications, valuation assumptions, second-order effects, and ' +
      'invalidation evidence before ordinary scoring can bury a one-source shock.',
    defaultArgs: ['--llm-provider', 'openai', '--since-hours', '6', '--limit', '25'],
  },
  {
    name: 'cluster_naming',
    kind: 'engine',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'run_cluster_naming.py',
    ),
    defaultCronExpression: '17 */2 * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'LLM cluster-naming + theme-proposal (PRD D4, M3). Names multi-evidence ' +
      'news_cluster scenarios via OpenAI gpt-4o-mini, generating human-readable ' +
      'titles, summaries, and corrected primary_theme / scenario_type. Reads API ' +
      'key from backend/.env. Runs 5 min after macro_clustering (:12).',
    defaultArgs: ['--llm-provider', 'openai'],
  },
  {
    name: 'macro_scoring',
    kind: 'engine',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'run_macro_scoring.py',
    ),
    defaultCronExpression: '22 */2 * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Macro Engine scoring profile (PRD D27). Rescores all news_cluster scenarios ' +
      'using the Macro profile weights (event 0.30, market_confirmation 0.25, ' +
      'source_breadth 0.20, attention 0.15, novelty 0.10) with no coverage penalty ' +
      'and no authenticity multiplier. Runs 5 min after cluster_naming (:17).',
    defaultArgs: [],
  },
  {
    name: 'cross_engine_corroboration',
    kind: 'engine',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'run_cross_engine_corroboration.py',
    ),
    defaultCronExpression: '27 */2 * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Cross-engine corroboration (PRD D21 M5, S8). When entities overlap between ' +
      'Macro and Social Arb scenarios, upgrades detection_path to mixed_news_led or ' +
      'mixed_anomaly_led and adds +0.10 to confidence_score. Runs 5 min after ' +
      'macro_scoring (:22).',
    defaultArgs: [],
  },
  {
    name: 'consumer_cycle_adapter',
    kind: 'engine',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'run_consumer_cycle_adapter.py',
    ),
    defaultCronExpression: '0 6 * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Consumer Cycle adapter (PRD D12). Polls the Consumer Cycle Monitor for ' +
      'state-change events (e.g., autos yellow→red) and injects them as ' +
      'consumer_cycle_state_change signals into matching Macro scenarios. ' +
      'FRED data is quarterly, so daily at 6 AM PT is sufficient.',
    defaultArgs: ['--force-refresh'],
  },
  {
    name: 'exposure_mapping',
    kind: 'engine',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'run_exposure_mapping.py',
    ),
    defaultCronExpression: '32 */2 * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Exposure mapping populator (PRD D2, Phase 2). For each scenario with a ' +
      'primary_theme matching the theme taxonomy, inserts first/second-order ' +
      'situation_exposure rows (source_method=hand_curated) and resolves ' +
      'ticker seeds against universe_clean.json. Runs 5 min after ' +
      'cross_engine_corroboration (:27). Idempotent — skips scenarios that ' +
      'already have exposure rows.',
    defaultArgs: ['--verbose'],
  },
  {
    name: 'llm_exposure_mapping',
    kind: 'engine',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'run_llm_exposure_mapping.py',
    ),
    defaultCronExpression: '37 */2 * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'LLM-assist exposure mapping (PRD D2, Phase 2 Tier 2). For scenarios ' +
      'whose primary_theme is not in the hand-curated taxonomy, uses OpenAI ' +
      'gpt-4o-mini to propose first/second-order effects. Results validated ' +
      'against universe symbols, inserted with source_method=llm_assist and ' +
      '0.6 confidence discount. Runs 5 min after hand-curated exposure (:32).',
    defaultArgs: ['--verbose', '--llm-provider', 'openai'],
  },
  {
    name: 'universe_ranking',
    kind: 'engine',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'run_universe_ranking.py',
    ),
    defaultCronExpression: '42 */2 * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Universe ranking engine (PRD Phase 3). Computes composite_rank for ' +
      'all situation_exposure rows with universe symbols. Joins valuation ' +
      '(dcf_gap, quality_score), buzz, and technical readiness. Formula: ' +
      '0.30 relevance + 0.25 valuation + 0.15 quality + 0.15 tech + ' +
      '0.10 buzz + 0.05 liquidity. Persists top-N per scenario. ' +
      'Runs 5 min after LLM exposure mapping (:37).',
    defaultArgs: ['--verbose', '--skip-technical'],
  },
  {
    name: 'conviction_producer',
    kind: 'engine',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'run_conviction_producer.py',
    ),
    defaultCronExpression: '47 */2 * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Conviction-layer producer (PRD D3, D16). Assembles evidence + exposure ' +
      'pack per scenario, calls OpenAI gpt-4o-mini with scenario-type-aware ' +
      'prompt, validates output (tickers must intersect exposure, fields ' +
      'non-empty), caches by pack hash. Sets CONVICTION_LAYER_UNRELIABLE ' +
      'flag on double-failure. Runs 5 min after universe ranking (:42).',
    defaultArgs: ['--verbose'],
  },
  {
    name: 'forward_tracking',
    kind: 'engine',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'run_forward_tracking.py',
    ),
    defaultCronExpression: '0 7 * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Forward-tracking metrics engine (PRD Phase 5). Fetches OHLCV for ' +
      'top-N candidates per scenario, computes forward return, MFE/MAE, ' +
      'direction hit rate. Builds per-theme quality snapshots. Runs daily ' +
      'at 7am PT (after market close + data settling).',
    defaultArgs: ['--verbose', '--max-scenarios', '100'],
  },
  {
    name: 'google_trends_collector',
    kind: 'collector',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'collect_google_trends.py',
    ),
    defaultCronExpression: '0 8 * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Google Trends collector (PRD Phase 6, D19). Fetches 90-day interest-' +
      'over-time for brand keywords from brand_to_ticker, computes 7d/30d ' +
      'acceleration ratio, stores in consumer_brand_signals. Daily at 8am PT.',
    defaultArgs: ['--verbose', '--top-n', '50'],
  },
  {
    name: 'appstore_rankings_collector',
    kind: 'collector',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'collect_appstore_rankings.py',
    ),
    defaultCronExpression: '30 8 * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'App Store rankings collector (PRD Phase 6, D19). Fetches Apple App ' +
      'Store top-free/paid/grossing feeds, matches against brand_to_ticker ' +
      'registry, stores rank + velocity in consumer_brand_signals.',
    defaultArgs: ['--verbose'],
  },
  {
    name: 'amazon_reviews_collector',
    kind: 'collector',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'collect_amazon_reviews.py',
    ),
    defaultCronExpression: '0 9 * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Amazon review velocity collector (PRD Phase 6, D19). Fetches review ' +
      'count + rating for mapped brand ASINs, computes daily velocity ' +
      '(new reviews/day) as consumer adoption proxy.',
    defaultArgs: ['--verbose'],
  },
  {
    name: 'social_buzz_bridge',
    kind: 'engine',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'run_social_buzz_bridge.py',
    ),
    defaultCronExpression: '15 */2 * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Social buzz bridge. Imports StockTwits + Yahoo Finance mention data ' +
      'from social-intelligence.sqlite into MI consumer_brand_signals for ' +
      'all brand-mapped and exposure-mapped tickers. Every 2h at :15.',
    defaultArgs: ['--verbose'],
  },
  {
    name: 'social_raw_bridge',
    kind: 'engine',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'run_social_raw_bridge.py',
    ),
    defaultCronExpression: '22 */2 * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Social raw evidence bridge. Normalizes recent StockTwits, Yahoo Finance, ' +
      'and Reddit posts from social-intelligence.sqlite into MI mi_raw_hits when ' +
      'they match active Social ARB concepts by search term or watch ticker. ' +
      'This lets ticker-indexed social chatter feed z-score spikes, promoted ' +
      'topics, cards, and Ledger evidence. Every 2h at :22.',
    defaultArgs: ['--verbose', '--days-back', '7', '--limit', '25000'],
  },
  {
    name: 'universe_mention_normalization',
    kind: 'engine',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'run_universe_mention_normalization.py',
    ),
    defaultCronExpression: '28 */2 * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Universe mention normalization (PRD D30). Matches raw Market Intelligence ' +
      'evidence against the full clean universe, rolls up symbol/source/community ' +
      'baselines, and scores abnormal perturbations so Social ARB starts from the ' +
      'whole field instead of a hand-picked ticker watchlist. Every 2h at :28.',
    defaultArgs: ['--verbose', '--days-back', '14'],
  },
  {
    name: 'universe_mover_claims',
    kind: 'engine',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'run_universe_mover_claims.py',
    ),
    defaultCronExpression: '30 */2 * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Universe mover claim bridge (PRD D30). Converts strong clean-universe ' +
      'symbol perturbations into emerging_claims so narrative clustering can ' +
      'decide whether they become Social ARB cards. Conservative defaults require ' +
      'organic discovery, multiple mentions, and a real z-score/score threshold. ' +
      'Every 2h at :30, after universe_mention_normalization.',
    defaultArgs: ['--verbose'],
  },
  {
    name: 'ticker_migration_bridge',
    kind: 'engine',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'run_ticker_migration_bridge.py',
    ),
    defaultCronExpression: '*/30 * * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Ticker-indexed migration bridge (PRD D28). Reads StockTwits + Yahoo ' +
      'buzz spikes from social-intelligence.sqlite and checks if mapped ' +
      'tickers from emerging topics have spiked. Sets migration_to_ticker_indexed ' +
      'flag and can escalate EARLY -> DEVELOPING. Every 30 min.',
    defaultArgs: ['--verbose'],
  },
  {
    name: 'concept_extraction_worker',
    kind: 'engine',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'run_concept_extraction.py',
    ),
    // Slot at minutes 12,27,42,57 — sits AFTER all collectors (HN :00/:30,
    // 4chan :05/:35, Bluesky :10/:40, forums :20) so each tick sees the
    // freshest mi_raw_hits, and still finishes BEFORE the zscore_engine
    // (every :00/:15/:30/:45) so polarity_mean + intent_mix_json are
    // populated when the engine recomputes daily-count anomalies.
    defaultCronExpression: '12,27,42,57 * * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Concept-extraction worker (PRD D08, §LLM cost discipline). Reads new ' +
      'mi_raw_hits past a persisted cursor, applies pre-filter + registry-only ' +
      'skips, batches the remainder for an LLM (mock by default — switch to ' +
      'openai once API key is wired), UPSERTs tracked_concepts, and enriches ' +
      'concept_daily_counts.polarity_mean + intent_mix_json so downstream ' +
      'scoring profiles see real signal instead of NULL.',
    defaultArgs: ['--llm-provider', 'mock', '--max-batches', '20'],
  },
  {
    name: 'narrative_claim_extraction',
    kind: 'engine',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'run_narrative_claim_extraction.py',
    ),
    // Runs shortly after concept_extraction_worker so fresh raw hits have
    // first had a chance to update the listening-concept registry.
    defaultCronExpression: '14,29,44,59 * * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Asymmetric Narrative claim extractor. Reads recent mi_raw_hits and emits ' +
      'structured emerging_claims for frontier themes such as tokenization, quantum, ' +
      'defense AI, AI power/grid, and consumer product breakouts.',
    defaultArgs: ['--since-hours', '6', '--limit', '5000'],
  },
  {
    name: 'youtube_transcript_collector',
    kind: 'collector',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'collect_youtube_transcripts.py',
    ),
    // This is operator-fed in v1: pass --url or --urls-file when running
    // manually or via scheduler config. The default job is registered so the
    // Macro Source Monitor / settings page can manage it, but it is harmless
    // until URLs are configured.
    defaultCronExpression: '8 */2 * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'YouTube transcript collector for asymmetric narratives. Normalizes Shorts, ' +
      'watch, and youtu.be URLs to canonical watch URLs and stores caption ' +
      'transcripts as mi_raw_hits source_type="youtube_transcript". Configure ' +
      '--url or --urls-file before enabling scheduled runs.',
    defaultArgs: ['--urls-file', 'backend/data/preferences/youtube-watchlist.txt'],
  },
  {
    name: 'youtube_channel_feed_collector',
    kind: 'collector',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'collect_youtube_channel_feeds.py',
    ),
    defaultCronExpression: '11 */2 * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'YouTube channel/feed watcher for Social ARB discovery (PRD D31). Reads ' +
      'operator-curated channel ids/handles from youtube-channels.json, pulls ' +
      'free YouTube RSS uploads, stores youtube_video metadata rows, and can ' +
      'optionally hand URLs to the transcript collector. Skips cleanly when no ' +
      'channels are configured.',
    defaultArgs: ['--channels-file', 'backend/data/preferences/youtube-channels.json'],
  },
  {
    name: 'narrative_cluster_builder',
    kind: 'engine',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'run_narrative_cluster_builder.py',
    ),
    // Runs a few minutes after claim extraction. It stages WATCH/RESEARCH/
    // SCENARIO_READY clusters with claim lineage; promotion is a separate step.
    defaultCronExpression: '2,17,32,47 * * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Asymmetric Narrative cluster builder. Groups emerging_claims into ' +
      'narrative_clusters, assigns WATCH/RESEARCH/SCENARIO_READY, and preserves ' +
      'claim lineage in narrative_cluster_claims.',
    defaultArgs: ['--limit', '5000'],
  },
  {
    name: 'narrative_cluster_promotion',
    kind: 'rollup',
    scriptPath: path.join(
      COLLECTOR_SCRIPTS_DIR,
      'promote_narrative_clusters.py',
    ),
    // Runs after narrative_cluster_builder. Only SCENARIO_READY clusters with
    // mapped exposure and no existing promotion_situation_id are promoted.
    defaultCronExpression: '4,19,34,49 * * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Asymmetric Narrative promotion bridge. Promotes SCENARIO_READY ' +
      'narrative_clusters into market_situations while preserving claim/source ' +
      'lineage in metadata and situation_evidence.',
    defaultArgs: ['--limit', '25'],
  },
  {
    name: 'zscore_engine',
    kind: 'engine',
    scriptPath: path.join(COLLECTOR_SCRIPTS_DIR, 'run_zscore_engine.py'),
    defaultCronExpression: '*/15 * * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Z-score anomaly detection over concept_daily_counts; emits emerging_topics rows (PRD D17).',
    defaultArgs: ['--score-only'],
  },
  {
    name: 'baseline_rebuild',
    kind: 'engine',
    scriptPath: path.join(COLLECTOR_SCRIPTS_DIR, 'run_zscore_engine.py'),
    defaultCronExpression: '30 1 * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Nightly rebuild of topic_baselines from concept_daily_counts (PRD §Operational Architecture).',
    defaultArgs: ['--rebuild-baselines'],
  },
  {
    name: 'coverage_tier_refresh',
    kind: 'engine',
    scriptPath: path.join(COLLECTOR_SCRIPTS_DIR, 'refresh_coverage_tiers.py'),
    // Weekly Saturday 02:00 PT — yfinance is slow + rate-limited; weekly is the
    // PRD-recommended cadence (coverage-thresholds.json refresh_cadence) and
    // catches new IPOs / delistings without hammering Yahoo.
    defaultCronExpression: '0 2 * * 6',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Coverage Filter weekly refresh (PRD D22). Pulls market_cap, analyst_count, ADV, ' +
      'institutional_ownership for every brand_to_ticker symbol + active scenario tickers, ' +
      'computes composite_score, applies untradable rules, upserts coverage_tiers.',
    defaultArgs: [],
  },
  {
    name: 'authenticity_scorer',
    kind: 'engine',
    scriptPath: path.join(COLLECTOR_SCRIPTS_DIR, 'run_authenticity_scorer.py'),
    // Slot at minutes 7,22,37,52 — between zscore_engine (*/15 starting :00)
    // and topic_promotion (*/15 starting :00). Ensures any emerging_topic
    // written at *:00 has a real authenticity_score by the time the promoter
    // runs at *:15. Without this offset the promoter sees the 0.5 placeholder.
    defaultCronExpression: '7,22,37,52 * * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Authenticity Layer scorer (PRD D23). Replaces emerging_topics.authenticity_score placeholders ' +
      'with values computed from raw mi_raw_hits. Slots between zscore_engine and topic_promotion so ' +
      'the gate the promoter checks is real, not the 0.5 sentinel.',
    defaultArgs: [],
  },
  {
    name: 'topic_promotion',
    kind: 'rollup',
    scriptPath: path.join(COLLECTOR_SCRIPTS_DIR, 'promote_emerging_topics.py'),
    defaultCronExpression: '*/15 * * * *',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Promote emerging_topics into market_situations rows (PRD: bridge from statistical layer to scenario stream).',
    defaultArgs: [],
  },
  {
    name: 'options_optionability_refresh',
    kind: 'collector',
    scriptPath: path.join(
      PROJECT_ROOT,
      'backend',
      'scripts',
      'collect_options_flow.py',
    ),
    defaultCronExpression: '30 6 * * 6',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Weekly clean-universe optionability refresh. The clean universe remains the master list; ' +
      'this job updates options_symbol_optionability in options-flow.sqlite so daily options flow ' +
      'collection only scans clean-universe symbols that have listed options.',
    defaultArgs: ['--refresh-optionability-only', '--universe-source', 'clean-all', '--sleep-ms', '250'],
  },
  {
    name: 'options_flow_collector',
    kind: 'collector',
    scriptPath: path.join(
      PROJECT_ROOT,
      'backend',
      'scripts',
      'collect_options_flow.py',
    ),
    defaultCronExpression: '0 17 * * 1-5',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Options Flow anomaly scanner. Collects daily options chain data (put/call volume, ' +
      'open interest, implied volatility, IV skew, and raw contract snapshots) for clean-universe symbols marked optionable via yfinance. ' +
      'Compares to 20-day historical averages and flags extreme_volume, extreme_put_buying, ' +
      'put_skew_spike, and smart_money_warning anomalies. Weekdays at 5pm PT (after market close).',
    defaultArgs: ['--universe-source', 'optionable-clean', '--sleep-ms', '250'],
  },
  {
    name: 'universe_ohlcv_refresh',
    kind: 'collector',
    scriptPath: path.join(
      PROJECT_ROOT,
      'backend',
      'scripts',
      'refresh_universe_ohlcv.py',
    ),
    defaultCronExpression: '30 16 * * 1-5',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Daily clean-universe OHLCV refresh. Updates backend/data/universe daily price CSVs ' +
      'after market close so eigen/PCA perturbation scans and historical replay are not ' +
      'running on stale local market data.',
    defaultArgs: ['--period', '6mo', '--batch-size', '50', '--sleep', '0.5'],
  },
  {
    name: 'eigen_perturbation_scan',
    kind: 'engine',
    scriptPath: path.join(
      PROJECT_ROOT,
      'backend',
      'scripts',
      'run_eigen_perturbation_lab.py',
    ),
    defaultCronExpression: '30 17 * * 1-5',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Daily clean-universe Eigen/PCA residual scan. Removes dominant market factors, ' +
      'ranks unexplained single-name moves, and overlays options flow, Social ARB ' +
      'perturbations, and Ledger valuation state for Market Intelligence review.',
    defaultArgs: ['--max-symbols', '0', '--lookback', '120', '--factors', '5', '--top', '150'],
  },
  {
    name: 'eigen_report_precompiler',
    kind: 'rollup',
    scriptPath: path.join(
      PROJECT_ROOT,
      'backend',
      'scripts',
      'precompile_eigen_reports.py',
    ),
    defaultCronExpression: '40 17 * * 1-5',
    defaultTimezone: 'America/Los_Angeles',
    description:
      'Precompiles Ledger Eigen investigation reports for the latest positive ' +
      'pre-explosion pressure hits after the daily clean-universe eigen scan. ' +
      'Caches reports so clicking a Market Intelligence hit opens immediately.',
    defaultArgs: ['--limit', '6'],
  },
] as const;

const JOB_DEFINITIONS_BY_NAME: Record<string, JobDefinition> = JOB_REGISTRY
  .reduce((acc, j) => {
    acc[j.name] = j;
    return acc;
  }, {} as Record<string, JobDefinition>);

// ----------------------------------------------------------------------------
// Config + runtime types
// ----------------------------------------------------------------------------

export interface JobConfig {
  enabled: boolean;
  /** null = use the job's defaultCronExpression. */
  cron_expression: string | null;
  /** null = use the job's defaultTimezone. */
  timezone: string | null;
}

export interface MarketIntelligenceScheduleConfig {
  /** Master switch. When false, no cron handlers are armed regardless of per-job state. */
  enabled: boolean;
  /** Per-job overrides keyed by job name. */
  jobs: Record<string, JobConfig>;
}

export interface JobRuntimeState {
  job_name: string;
  running: boolean;
  pid: number | null;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_exit_code: number | null;
  last_source: 'manual' | 'scheduled' | null;
  last_error: string | null;
  last_message: string | null;
}

// ----------------------------------------------------------------------------
// Module state
// ----------------------------------------------------------------------------

const _cronTasks: Record<string, ScheduledTask | null> = {};
const _runningProcesses: Record<string, ChildProcess | null> = {};
const _runtimes: Record<string, JobRuntimeState> = {};
let _config: MarketIntelligenceScheduleConfig | null = null;

// Initialise per-job runtime state from disk; reset stuck `running: true` rows.
for (const def of JOB_REGISTRY) {
  const persisted = loadRuntimeState(def.name) || initialRuntimeState(def.name);
  const cleaned = persisted.running
    ? { ...persisted, running: false, pid: null }
    : persisted;
  _runtimes[def.name] = cleaned;
  if (persisted.running) {
    saveRuntimeState(cleaned);
  }
  _cronTasks[def.name] = null;
  _runningProcesses[def.name] = null;
}

// ----------------------------------------------------------------------------
// Config IO
// ----------------------------------------------------------------------------

function defaultJobConfig(): JobConfig {
  return { enabled: false, cron_expression: null, timezone: null };
}

function defaultConfig(): MarketIntelligenceScheduleConfig {
  const jobs: Record<string, JobConfig> = {};
  for (const def of JOB_REGISTRY) {
    jobs[def.name] = defaultJobConfig();
  }
  return { enabled: false, jobs };
}

function sanitizeJobConfig(input: unknown): JobConfig {
  const base = defaultJobConfig();
  if (!input || typeof input !== 'object') return base;
  const obj = input as Record<string, unknown>;
  const cronStr = typeof obj.cron_expression === 'string'
    ? obj.cron_expression.trim()
    : '';
  const tzStr = typeof obj.timezone === 'string' ? obj.timezone.trim() : '';
  return {
    enabled: obj.enabled !== undefined ? Boolean(obj.enabled) : base.enabled,
    cron_expression: cronStr.length > 0 ? cronStr : null,
    timezone: tzStr.length > 0 ? tzStr : null,
  };
}

function sanitizeConfig(input: unknown): MarketIntelligenceScheduleConfig {
  const base = defaultConfig();
  if (!input || typeof input !== 'object') return base;
  const obj = input as Record<string, unknown>;
  const enabled = obj.enabled !== undefined ? Boolean(obj.enabled) : base.enabled;
  const jobsInput = (obj.jobs && typeof obj.jobs === 'object')
    ? obj.jobs as Record<string, unknown>
    : {};
  const jobs: Record<string, JobConfig> = {};
  for (const def of JOB_REGISTRY) {
    jobs[def.name] = sanitizeJobConfig(jobsInput[def.name]);
  }
  return { enabled, jobs };
}

function loadConfigFile(filePath: string): MarketIntelligenceScheduleConfig | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return sanitizeConfig(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
  } catch {
    return null;
  }
}

function persistConfig(config: MarketIntelligenceScheduleConfig): void {
  _config = { ...config, jobs: { ...config.jobs } };
  fs.mkdirSync(path.dirname(LOCAL_CONFIG_FILE), { recursive: true });
  fs.writeFileSync(
    LOCAL_CONFIG_FILE,
    JSON.stringify(_config, null, 2),
    'utf-8',
  );
  writeJsonDocument(SCHEDULER_NAMESPACE, CONFIG_DOCUMENT_KEY, _config);
}

export function loadMarketIntelligenceScheduleConfig(): MarketIntelligenceScheduleConfig {
  if (_config) return cloneConfig(_config);
  // PRECEDENCE: SQLite row wins over the JSON file. Hand-editing the file
  // while the SQLite row exists is a no-op. See header comment for the
  // reset-to-file recipe. Always update via POST /scheduler/config.
  const persisted = readJsonDocument<MarketIntelligenceScheduleConfig>(
    SCHEDULER_NAMESPACE,
    CONFIG_DOCUMENT_KEY,
  );
  if (persisted && typeof persisted === 'object') {
    _config = sanitizeConfig(persisted);
    return cloneConfig(_config);
  }
  const legacy = loadConfigFile(LOCAL_CONFIG_FILE);
  _config = legacy || defaultConfig();
  return cloneConfig(_config);
}

function cloneConfig(c: MarketIntelligenceScheduleConfig): MarketIntelligenceScheduleConfig {
  return { enabled: c.enabled, jobs: { ...c.jobs } };
}

// ----------------------------------------------------------------------------
// Runtime IO
// ----------------------------------------------------------------------------

function initialRuntimeState(jobName: string): JobRuntimeState {
  return {
    job_name: jobName,
    running: false,
    pid: null,
    last_started_at: null,
    last_finished_at: null,
    last_exit_code: null,
    last_source: null,
    last_error: null,
    last_message: null,
  };
}

function loadRuntimeState(jobName: string): JobRuntimeState | null {
  const persisted = readJsonDocument<JobRuntimeState>(
    SCHEDULER_NAMESPACE,
    RUNTIME_DOCUMENT_KEY_PREFIX + jobName,
  );
  if (!persisted || typeof persisted !== 'object') return null;
  return {
    job_name: jobName,
    running: Boolean(persisted.running),
    pid: persisted.pid ?? null,
    last_started_at: persisted.last_started_at ?? null,
    last_finished_at: persisted.last_finished_at ?? null,
    last_exit_code: persisted.last_exit_code ?? null,
    last_source: persisted.last_source ?? null,
    last_error: persisted.last_error ?? null,
    last_message: persisted.last_message ?? null,
  };
}

function saveRuntimeState(state: JobRuntimeState): void {
  _runtimes[state.job_name] = { ...state };
  writeJsonDocument(
    SCHEDULER_NAMESPACE,
    RUNTIME_DOCUMENT_KEY_PREFIX + state.job_name,
    state,
  );
}

// ----------------------------------------------------------------------------
// Cron arming
// ----------------------------------------------------------------------------

function effectiveCronExpression(def: JobDefinition, jc: JobConfig): string {
  return jc.cron_expression && jc.cron_expression.trim().length > 0
    ? jc.cron_expression
    : def.defaultCronExpression;
}

function effectiveTimezone(def: JobDefinition, jc: JobConfig): string {
  return jc.timezone && jc.timezone.trim().length > 0
    ? jc.timezone
    : def.defaultTimezone;
}

function stopJobCron(jobName: string): void {
  const existing = _cronTasks[jobName];
  if (existing) {
    existing.stop();
    _cronTasks[jobName] = null;
  }
}

function stopAllCrons(): void {
  for (const def of JOB_REGISTRY) {
    stopJobCron(def.name);
  }
}

function ensureSchedules(config: MarketIntelligenceScheduleConfig): void {
  stopAllCrons();
  if (!config.enabled) return;
  for (const def of JOB_REGISTRY) {
    const jc = config.jobs[def.name] || defaultJobConfig();
    if (!jc.enabled) continue;
    const expr = effectiveCronExpression(def, jc);
    if (!cron.validate(expr)) {
      console.warn(
        `[marketIntelligenceScheduler] invalid cron expression for ${def.name}: '${expr}' — skipping`,
      );
      continue;
    }
    const tz = effectiveTimezone(def, jc);
    _cronTasks[def.name] = cron.schedule(
      expr,
      () => {
        void runMarketIntelligenceJobNow(def.name, 'scheduled');
      },
      { timezone: tz },
    );
  }
}

// ----------------------------------------------------------------------------
// Process spawning (fire-and-forget)
// ----------------------------------------------------------------------------

function spawnJobProcess(
  def: JobDefinition,
  args: string[],
  source: 'manual' | 'scheduled',
): { started: boolean; message: string } {
  if (_runningProcesses[def.name]) {
    return {
      started: false,
      message: `Job '${def.name}' is already running.`,
    };
  }
  if (!fs.existsSync(def.scriptPath)) {
    const msg = `Script not available: ${def.scriptPath}`;
    saveRuntimeState({
      ..._runtimes[def.name],
      running: false,
      last_finished_at: new Date().toISOString(),
      last_exit_code: -1,
      last_source: source,
      last_error: msg,
    });
    return { started: false, message: msg };
  }

  const startedAt = new Date().toISOString();
  const child = spawn(getPythonLauncher(), [def.scriptPath, ...args], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  _runningProcesses[def.name] = child;

  saveRuntimeState({
    job_name: def.name,
    running: true,
    pid: child.pid ?? null,
    last_started_at: startedAt,
    last_finished_at: _runtimes[def.name].last_finished_at,
    last_exit_code: null,
    last_source: source,
    last_error: null,
    last_message: `[${def.name}] starting (pid ${child.pid})`,
  });

  child.stdout.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (!text) return;
    saveRuntimeState({
      ..._runtimes[def.name],
      last_message: text.length > 1000 ? text.slice(-1000) : text,
    });
  });
  child.stderr.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (!text) return;
    saveRuntimeState({
      ..._runtimes[def.name],
      last_error: text.length > 1000 ? text.slice(-1000) : text,
      last_message: text.length > 1000 ? text.slice(-1000) : text,
    });
  });
  child.on('error', (err: Error) => {
    _runningProcesses[def.name] = null;
    saveRuntimeState({
      ..._runtimes[def.name],
      running: false,
      pid: null,
      last_finished_at: new Date().toISOString(),
      last_exit_code: -1,
      last_error: err.message || String(err),
    });
  });
  child.on('exit', (code) => {
    _runningProcesses[def.name] = null;
    const exitCode = code ?? 0;
    saveRuntimeState({
      ..._runtimes[def.name],
      running: false,
      pid: null,
      last_finished_at: new Date().toISOString(),
      last_exit_code: exitCode,
      last_error:
        exitCode === 0
          ? null
          : (_runtimes[def.name].last_error || `Process exited with code ${exitCode}`),
    });
    if (def.name === 'eigen_perturbation_scan' && exitCode === 0) {
      const precompiler = JOB_DEFINITIONS_BY_NAME.eigen_report_precompiler;
      if (precompiler) {
        const started = spawnJobProcess(precompiler, precompiler.defaultArgs, source);
        saveRuntimeState({
          ..._runtimes[def.name],
          last_message: started.started
            ? `${_runtimes[def.name].last_message || ''}\n[eigen_report_precompiler] queued after successful scan`.trim()
            : `${_runtimes[def.name].last_message || ''}\n[eigen_report_precompiler] ${started.message}`.trim(),
        });
      }
      // Auto-scan narrative theses across the refreshed convergence board so the
      // UI can show thesis flags without anyone asking. Fire-and-forget HTTP call
      // into our own Node process (the extractor lives there, not in Python).
      try {
        const port = process.env.PORT || '3002';
        void fetch(`http://127.0.0.1:${port}/api/market-intelligence/convergence/theses/scan`, {
          method: 'POST',
        }).catch(() => { /* best-effort background trigger */ });
      } catch { /* best-effort */ }
    }
  });

  return {
    started: true,
    message: `[${def.name}] started (pid ${child.pid}) source=${source}`,
  };
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export function listMarketIntelligenceJobs(): readonly JobDefinition[] {
  return JOB_REGISTRY;
}

export function getMarketIntelligenceJobDefinition(
  jobName: string,
): JobDefinition | null {
  return JOB_DEFINITIONS_BY_NAME[jobName] || null;
}

export interface UpdateScheduleConfigInput {
  enabled?: boolean;
  jobs?: Record<string, Partial<JobConfig>>;
}

export function saveMarketIntelligenceScheduleConfig(
  input: UpdateScheduleConfigInput,
): MarketIntelligenceScheduleConfig {
  const current = loadMarketIntelligenceScheduleConfig();
  const mergedJobs: Record<string, JobConfig> = { ...current.jobs };
  if (input.jobs && typeof input.jobs === 'object') {
    for (const [name, override] of Object.entries(input.jobs)) {
      if (!JOB_DEFINITIONS_BY_NAME[name]) continue;
      mergedJobs[name] = sanitizeJobConfig({
        ...current.jobs[name],
        ...override,
      });
    }
  }
  const next = sanitizeConfig({
    enabled: input.enabled !== undefined ? input.enabled : current.enabled,
    jobs: mergedJobs,
  });
  ensureSchedules(next);
  persistConfig(next);
  return cloneConfig(next);
}

export function setMarketIntelligenceJobEnabled(
  jobName: string,
  enabled: boolean,
): MarketIntelligenceScheduleConfig {
  if (!JOB_DEFINITIONS_BY_NAME[jobName]) {
    throw new Error(`Unknown job: ${jobName}`);
  }
  return saveMarketIntelligenceScheduleConfig({
    jobs: { [jobName]: { enabled } },
  });
}

export function runMarketIntelligenceJobNow(
  jobName: string,
  source: 'manual' | 'scheduled' = 'manual',
): { started: boolean; message: string } {
  const def = JOB_DEFINITIONS_BY_NAME[jobName];
  if (!def) {
    return { started: false, message: `Unknown job: ${jobName}` };
  }
  return spawnJobProcess(def, def.defaultArgs, source);
}

export interface MarketIntelligenceScheduleStatus {
  config: MarketIntelligenceScheduleConfig;
  jobs: Array<{
    definition: JobDefinition;
    config: JobConfig;
    runtime: JobRuntimeState;
    cron_active: boolean;
    effective_cron_expression: string;
    effective_timezone: string;
  }>;
}

export function getMarketIntelligenceScheduleStatus(): MarketIntelligenceScheduleStatus {
  const config = loadMarketIntelligenceScheduleConfig();
  const jobs = JOB_REGISTRY.map((def) => {
    const jc = config.jobs[def.name] || defaultJobConfig();
    return {
      definition: def,
      config: jc,
      runtime: { ..._runtimes[def.name] },
      cron_active: Boolean(_cronTasks[def.name]),
      effective_cron_expression: effectiveCronExpression(def, jc),
      effective_timezone: effectiveTimezone(def, jc),
    };
  });
  return { config, jobs };
}

export function resumeMarketIntelligenceSchedulerFromDisk(): boolean {
  const config = loadMarketIntelligenceScheduleConfig();
  ensureSchedules(config);
  return config.enabled;
}

export function hasPersistedMarketIntelligenceSchedulePreference(): boolean {
  return (
    hasJsonDocument(SCHEDULER_NAMESPACE, CONFIG_DOCUMENT_KEY) ||
    fs.existsSync(LOCAL_CONFIG_FILE)
  );
}
