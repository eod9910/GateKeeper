from __future__ import annotations

import argparse
import json
import math
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean, pstdev
from typing import Any, Dict, Iterable, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.social_intelligence_db import SocialIntelligenceDb

SYMBOL_CATALOG_DB_PATH = ROOT / "backend" / "data" / "symbol-catalog.sqlite"


def _safe_div(num: float, den: float) -> Optional[float]:
    if not den:
        return None
    return num / den


def _clamp(value: Optional[float], low: float, high: float) -> Optional[float]:
    if value is None or not math.isfinite(value):
        return None
    return max(low, min(high, value))


def _to_float(value: Any) -> Optional[float]:
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    return num if math.isfinite(num) else None


def _mean_std(values: List[float]) -> Tuple[Optional[float], Optional[float]]:
    filtered = [float(v) for v in values if v is not None and math.isfinite(float(v))]
    if not filtered:
        return None, None
    if len(filtered) == 1:
        return filtered[0], 0.0
    return mean(filtered), pstdev(filtered)


def _zscore(current: Optional[float], history: List[float]) -> Optional[float]:
    if current is None:
        return None
    avg, std = _mean_std(history)
    if avg is None:
        return None
    if std is None or std == 0:
        return 0.0
    return (current - avg) / std


def _downgrade_confidence(confidence: str) -> str:
    order = ["LOW", "MEDIUM", "HIGH"]
    try:
        index = order.index(str(confidence or "LOW").upper())
    except ValueError:
        return "LOW"
    return order[max(0, index - 1)]


def _assess_score_trust(
    *,
    history_dates: int,
    posts_30d: int,
    unique_authors_7d: int,
    platforms_active: int,
    author_concentration: Optional[float],
    trailing_mentions: List[float],
) -> Dict[str, Any]:
    reasons: List[str] = []
    if history_dates < 14:
        reasons.append("LOW_HISTORY")
    elif history_dates < 30:
        reasons.append("WEAK_HISTORY")

    if posts_30d < 10:
        reasons.append("LOW_POST_COUNT")
    elif posts_30d < 30:
        reasons.append("THIN_POST_BASELINE")

    if unique_authors_7d < 5:
        reasons.append("LOW_UNIQUE_AUTHORS")
    elif unique_authors_7d < 10:
        reasons.append("THIN_AUTHOR_BASELINE")

    if platforms_active < 2:
        reasons.append("ONE_PLATFORM_ONLY")

    if author_concentration is not None and math.isfinite(author_concentration) and author_concentration >= 0.75:
        reasons.append("HIGH_AUTHOR_CONCENTRATION")

    baseline_values = [float(v) for v in trailing_mentions if v is not None and math.isfinite(float(v))]
    if baseline_values and len(set(round(v, 6) for v in baseline_values)) <= 1:
        reasons.append("ZERO_VARIANCE_BASELINE")

    if history_dates < 14 or posts_30d < 10 or unique_authors_7d < 5:
        validity = "INVALID"
    elif history_dates < 30 or posts_30d < 30 or unique_authors_7d < 10 or platforms_active < 2:
        validity = "WEAK"
    elif (
        history_dates >= 60
        and posts_30d >= 100
        and unique_authors_7d >= 25
        and platforms_active >= 2
        and (author_concentration is None or author_concentration <= 0.60)
    ):
        validity = "STRONG"
    else:
        validity = "USABLE"

    confidence = {
        "INVALID": "LOW",
        "WEAK": "LOW",
        "USABLE": "MEDIUM",
        "STRONG": "HIGH",
    }.get(validity, "LOW")

    if "HIGH_AUTHOR_CONCENTRATION" in reasons or "ZERO_VARIANCE_BASELINE" in reasons:
        confidence = _downgrade_confidence(confidence)

    score_multiplier = {
        "INVALID": 0.25,
        "WEAK": 0.60,
        "USABLE": 1.0,
        "STRONG": 1.05,
    }.get(validity, 0.60)

    return {
        "validity": validity,
        "confidence": confidence,
        "is_valid": validity in {"USABLE", "STRONG"},
        "reason_codes": sorted(set(reasons)),
        "score_multiplier": score_multiplier,
    }


def _parse_trade_date(value: Any) -> str:
    return str(value or "").strip()[:10]


def _load_tradability_scores() -> Dict[str, float]:
    if not SYMBOL_CATALOG_DB_PATH.exists():
        return {}
    conn = sqlite3.connect(SYMBOL_CATALOG_DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT s.symbol,
               COALESCE(MAX(CASE WHEN m.metric_name = 'market_cap' THEN m.metric_value_num END), 0) AS market_cap,
               COALESCE(MAX(CASE WHEN s.optionable = 1 THEN 1 ELSE 0 END), 0) AS optionable
        FROM symbols s
        LEFT JOIN symbol_metrics m
          ON m.symbol = s.symbol
        GROUP BY s.symbol
        """
    ).fetchall()
    conn.close()

    scores: Dict[str, float] = {}
    for row in rows:
        symbol = str(row["symbol"])
        market_cap = float(row["market_cap"] or 0.0)
        optionable = bool(row["optionable"])
        market_cap_score = 0.0
        if market_cap >= 50_000_000_000:
            market_cap_score = 1.0
        elif market_cap >= 10_000_000_000:
            market_cap_score = 0.85
        elif market_cap >= 2_000_000_000:
            market_cap_score = 0.65
        elif market_cap > 0:
            market_cap_score = 0.4
        score = 100.0 * ((0.65 * market_cap_score) + (0.35 * (1.0 if optionable else 0.0)))
        scores[symbol] = round(score, 1)
    return scores


def _iter_dates(rows: Iterable[sqlite3.Row], trade_date: Optional[str]) -> List[str]:
    dates = sorted({_parse_trade_date(row["trade_date"]) for row in rows if _parse_trade_date(row["trade_date"])})
    if trade_date:
        return [trade_date] if trade_date in dates else []
    return dates


def main() -> int:
    parser = argparse.ArgumentParser(description="Build daily social features and buzz scores from stored posts.")
    parser.add_argument("--trade-date", default="", help="Optional YYYY-MM-DD trade date to finalize.")
    args = parser.parse_args()

    db = SocialIntelligenceDb(ROOT)
    tradability_scores = _load_tradability_scores()

    with db._connect() as conn:
        post_rows = conn.execute(
            """
            SELECT c.raw_post_id,
                   c.symbol,
                   c.platform,
                   c.trade_date,
                   c.canonical_author_key,
                   c.cleaned_text,
                   c.posted_at,
                   r.like_count,
                   r.reply_count,
                   r.repost_count,
                   r.engagement_score,
                   s.sentiment_label,
                   s.sentiment_score
            FROM social_posts_clean c
            JOIN social_posts_raw r
              ON r.raw_post_id = c.raw_post_id
            LEFT JOIN social_post_sentiment s
              ON s.raw_post_id = c.raw_post_id
            ORDER BY c.symbol, c.trade_date, c.platform, c.posted_at
            """
        ).fetchall()

    trade_dates = _iter_dates(post_rows, _parse_trade_date(args.trade_date))
    if not trade_dates:
        print(json.dumps({"processed_trade_dates": [], "daily_rows": 0, "score_rows": 0}, indent=2))
        return 0

    grouped: Dict[tuple[str, str, str], List[sqlite3.Row]] = defaultdict(list)
    for row in post_rows:
        trade_date = _parse_trade_date(row["trade_date"])
        if trade_date not in trade_dates:
            continue
        grouped[(str(row["symbol"]), trade_date, str(row["platform"]))].append(row)

    platform_rows: List[Dict[str, Any]] = []
    aggregate_rows: List[Dict[str, Any]] = []

    all_known_author_dates: Dict[str, set[str]] = defaultdict(set)
    raw_author_counters_by_symbol_date: Dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    for row in post_rows:
        symbol = str(row["symbol"])
        trade_date = _parse_trade_date(row["trade_date"])
        author_key = str(row["canonical_author_key"] or "").strip()
        if author_key:
            all_known_author_dates[author_key].add(trade_date)
            raw_author_counters_by_symbol_date[(symbol, trade_date)][author_key] += 1

    for (symbol, trade_date, platform), rows in grouped.items():
        mention_count_1d = len(rows)
        author_counter = Counter(str(row["canonical_author_key"] or "") for row in rows if str(row["canonical_author_key"] or "").strip())
        unique_authors_1d = len(author_counter)
        top5_posts = sum(count for _, count in author_counter.most_common(5))
        new_authors = 0
        for author_key in author_counter:
            prior_dates = [d for d in all_known_author_dates.get(author_key, set()) if d < trade_date]
            if not prior_dates:
                new_authors += 1
        sentiment_labels = [str(row["sentiment_label"] or "neutral").lower() for row in rows]
        bullish_count = sum(1 for label in sentiment_labels if label == "bullish")
        bearish_count = sum(1 for label in sentiment_labels if label == "bearish")
        neutral_count = sum(1 for label in sentiment_labels if label == "neutral")
        sentiment_scores = [float(row["sentiment_score"]) for row in rows if row["sentiment_score"] is not None]
        engagement_values = [float(row["engagement_score"] or 0.0) for row in rows]
        likes = [float(row["like_count"] or 0.0) for row in rows]
        replies = [float(row["reply_count"] or 0.0) for row in rows]
        reposts = [float(row["repost_count"] or 0.0) for row in rows]
        weighted_numerator = 0.0
        weighted_denominator = 0.0
        for row in rows:
            score = row["sentiment_score"]
            if score is None:
                continue
            weight = max(1.0, float(row["engagement_score"] or 0.0))
            weighted_numerator += float(score) * weight
            weighted_denominator += weight

        feature_row = {
            "symbol": symbol,
            "trade_date": trade_date,
            "platform": platform,
            "mention_count_1d": mention_count_1d,
            "mention_count_3d": None,
            "mention_count_7d": None,
            "mention_count_30d": None,
            "unique_authors_1d": unique_authors_1d,
            "unique_authors_7d": None,
            "posts_per_author": round(_safe_div(mention_count_1d, unique_authors_1d) or 0.0, 4) if unique_authors_1d else None,
            "author_concentration": round(_safe_div(top5_posts, mention_count_1d) or 0.0, 4) if mention_count_1d else None,
            "new_authors_ratio": round(_safe_div(new_authors, unique_authors_1d) or 0.0, 4) if unique_authors_1d else None,
            "bullish_count": bullish_count,
            "bearish_count": bearish_count,
            "neutral_count": neutral_count,
            "bullish_ratio": round(_safe_div(bullish_count, mention_count_1d) or 0.0, 4) if mention_count_1d else None,
            "bearish_ratio": round(_safe_div(bearish_count, mention_count_1d) or 0.0, 4) if mention_count_1d else None,
            "net_sentiment": round(_safe_div((bullish_count - bearish_count), mention_count_1d) or 0.0, 4) if mention_count_1d else None,
            "weighted_sentiment": round(_safe_div(weighted_numerator, weighted_denominator) or 0.0, 4) if weighted_denominator else None,
            "engagement_per_post": round(_safe_div(sum(engagement_values), mention_count_1d) or 0.0, 4) if mention_count_1d else None,
            "likes_per_post": round(_safe_div(sum(likes), mention_count_1d) or 0.0, 4) if mention_count_1d else None,
            "replies_per_post": round(_safe_div(sum(replies), mention_count_1d) or 0.0, 4) if mention_count_1d else None,
            "reposts_per_post": round(_safe_div(sum(reposts), mention_count_1d) or 0.0, 4) if mention_count_1d else None,
            "payload": {
                "sentiment_scores_sample": sentiment_scores[:5],
            },
        }
        platform_rows.append(feature_row)

    by_symbol_date: Dict[tuple[str, str], List[Dict[str, Any]]] = defaultdict(list)
    for row in platform_rows:
        by_symbol_date[(row["symbol"], row["trade_date"])].append(row)

    symbol_date_history: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

    for (symbol, trade_date), rows in sorted(by_symbol_date.items()):
        aggregate = {
            "symbol": symbol,
            "trade_date": trade_date,
            "platform": "aggregate",
            "mention_count_1d": sum(int(row.get("mention_count_1d") or 0) for row in rows),
            "mention_count_3d": None,
            "mention_count_7d": None,
            "mention_count_30d": None,
            "unique_authors_1d": None,
            "unique_authors_7d": None,
            "posts_per_author": None,
            "author_concentration": None,
            "new_authors_ratio": None,
            "bullish_count": sum(int(row.get("bullish_count") or 0) for row in rows),
            "bearish_count": sum(int(row.get("bearish_count") or 0) for row in rows),
            "neutral_count": sum(int(row.get("neutral_count") or 0) for row in rows),
            "bullish_ratio": None,
            "bearish_ratio": None,
            "net_sentiment": None,
            "weighted_sentiment": None,
            "engagement_per_post": None,
            "likes_per_post": None,
            "replies_per_post": None,
            "reposts_per_post": None,
            "payload": {
                "platforms": [row["platform"] for row in rows],
            },
        }
        total_mentions = int(aggregate["mention_count_1d"] or 0)
        if total_mentions:
            unique_authors = 0
            author_counter = raw_author_counters_by_symbol_date.get((symbol, trade_date), Counter())
            unique_authors = len(author_counter)
            aggregate["unique_authors_1d"] = unique_authors
            aggregate["posts_per_author"] = round(_safe_div(total_mentions, unique_authors) or 0.0, 4) if unique_authors else None
            aggregate["author_concentration"] = round(_safe_div(sum(count for _, count in author_counter.most_common(5)), total_mentions) or 0.0, 4) if author_counter else None
            new_authors = 0
            for author_key in author_counter:
                prior_dates = [d for d in all_known_author_dates.get(author_key, set()) if d < trade_date]
                if not prior_dates:
                    new_authors += 1
            aggregate["new_authors_ratio"] = round(_safe_div(new_authors, unique_authors) or 0.0, 4) if unique_authors else None
            aggregate["bullish_ratio"] = round(_safe_div(int(aggregate["bullish_count"] or 0), total_mentions) or 0.0, 4)
            aggregate["bearish_ratio"] = round(_safe_div(int(aggregate["bearish_count"] or 0), total_mentions) or 0.0, 4)
            aggregate["net_sentiment"] = round(
                _safe_div((int(aggregate["bullish_count"] or 0) - int(aggregate["bearish_count"] or 0)), total_mentions) or 0.0,
                4,
            )
            weighted_parts = [row.get("weighted_sentiment") for row in rows if row.get("weighted_sentiment") is not None]
            aggregate["weighted_sentiment"] = round(mean(weighted_parts), 4) if weighted_parts else None
            for field in ("engagement_per_post", "likes_per_post", "replies_per_post", "reposts_per_post"):
                values = [row.get(field) for row in rows if row.get(field) is not None]
                aggregate[field] = round(mean(values), 4) if values else None

        aggregate_rows.append(aggregate)
        symbol_date_history[symbol].append(aggregate)

    for symbol, rows in symbol_date_history.items():
        rows.sort(key=lambda item: item["trade_date"])
        mention_series = [int(row.get("mention_count_1d") or 0) for row in rows]
        author_series = [int(row.get("unique_authors_1d") or 0) for row in rows]
        engagement_series = [float(row.get("engagement_per_post") or 0.0) for row in rows]
        sentiment_series = [float(row.get("net_sentiment") or 0.0) for row in rows]

        for index, row in enumerate(rows):
            row["mention_count_3d"] = sum(mention_series[max(0, index - 2) : index + 1])
            row["mention_count_7d"] = sum(mention_series[max(0, index - 6) : index + 1])
            row["mention_count_30d"] = sum(mention_series[max(0, index - 29) : index + 1])
            row["unique_authors_7d"] = sum(author_series[max(0, index - 6) : index + 1])

    all_daily_rows = platform_rows + aggregate_rows
    db.bulk_upsert_daily_features(all_daily_rows)

    score_rows: List[Dict[str, Any]] = []
    platform_lookup = {(row["symbol"], row["trade_date"], row["platform"]): row for row in platform_rows}
    for symbol, rows in symbol_date_history.items():
        mention_series = [int(row.get("mention_count_1d") or 0) for row in rows]
        author_series = [int(row.get("unique_authors_1d") or 0) for row in rows]
        engagement_series = [float(row.get("engagement_per_post") or 0.0) for row in rows]
        sentiment_series = [float(row.get("net_sentiment") or 0.0) for row in rows]
        velocity_history: List[float] = []
        for index, row in enumerate(rows):
            trade_date = row["trade_date"]
            current_mentions = float(row.get("mention_count_1d") or 0.0)
            current_authors = float(row.get("unique_authors_1d") or 0.0)
            current_engagement = float(row.get("engagement_per_post") or 0.0)
            current_sentiment = float(row.get("net_sentiment") or 0.0)

            trailing_mentions = mention_series[max(0, index - 30) : index]
            trailing_authors = author_series[max(0, index - 30) : index]
            trailing_engagement = engagement_series[max(0, index - 30) : index]
            trailing_sentiment_3d = sentiment_series[max(0, index - 3) : index]
            trailing_sentiment_7d = sentiment_series[max(0, index - 7) : index]

            baseline_7 = mention_series[max(0, index - 7) : index]
            baseline_7_avg = mean(baseline_7) if baseline_7 else current_mentions
            mention_velocity = _safe_div(current_mentions, baseline_7_avg) if baseline_7_avg else None
            acceleration_baseline = velocity_history[max(0, len(velocity_history) - 3) :]
            mention_acceleration = None
            if mention_velocity is not None:
                prev_velocity_avg = mean(acceleration_baseline) if acceleration_baseline else mention_velocity
                mention_acceleration = mention_velocity - prev_velocity_avg
                velocity_history.append(mention_velocity)

            yahoo_row = platform_lookup.get((symbol, trade_date, "Yahoo Finance"))
            stocktwits_row = platform_lookup.get((symbol, trade_date, "StockTwits"))
            yahoo_sentiment = yahoo_row.get("net_sentiment") if yahoo_row else None
            stocktwits_sentiment = stocktwits_row.get("net_sentiment") if stocktwits_row else None
            recent_platforms = set()
            for prior_row in rows[max(0, index - 29) : index + 1]:
                prior_trade_date = prior_row["trade_date"]
                prior_yahoo = platform_lookup.get((symbol, prior_trade_date, "Yahoo Finance"))
                prior_stocktwits = platform_lookup.get((symbol, prior_trade_date, "StockTwits"))
                if prior_yahoo and int(prior_yahoo.get("mention_count_1d") or 0) > 0:
                    recent_platforms.add("Yahoo Finance")
                if prior_stocktwits and int(prior_stocktwits.get("mention_count_1d") or 0) > 0:
                    recent_platforms.add("StockTwits")
            platforms_active = len(recent_platforms)
            cross_platform_agreement = None
            if yahoo_sentiment is not None and stocktwits_sentiment is not None:
                cross_platform_agreement = max(0.0, 1.0 - (abs(float(yahoo_sentiment) - float(stocktwits_sentiment)) / 2.0))

            buzz_zscore = _zscore(current_mentions, trailing_mentions)
            unique_author_zscore = _zscore(current_authors, trailing_authors)
            engagement_zscore = _zscore(current_engagement, trailing_engagement)
            sentiment_trend_3d = current_sentiment - mean(trailing_sentiment_3d) if trailing_sentiment_3d else None
            sentiment_trend_7d = current_sentiment - mean(trailing_sentiment_7d) if trailing_sentiment_7d else None
            tradability_score = tradability_scores.get(symbol)

            score_components = [
                18.0 * (_clamp(buzz_zscore, -3.0, 3.0) or 0.0),
                14.0 * (_clamp(unique_author_zscore, -3.0, 3.0) or 0.0),
                10.0 * (_clamp(engagement_zscore, -3.0, 3.0) or 0.0),
                12.0 * ((_clamp(mention_velocity, 0.0, 3.0) or 0.0) - 1.0),
                8.0 * (_clamp(mention_acceleration, -2.0, 2.0) or 0.0),
                18.0 * (_clamp(current_sentiment, -1.0, 1.0) or 0.0),
                10.0 * (_clamp(sentiment_trend_3d, -1.0, 1.0) or 0.0),
                5.0 * ((_clamp(cross_platform_agreement, 0.0, 1.0) or 0.5) - 0.5),
                5.0 * (((tradability_score or 50.0) / 100.0) - 0.5),
            ]
            raw_buzz_score = 50.0 + sum(score_components)
            trust = _assess_score_trust(
                history_dates=index + 1,
                posts_30d=int(row.get("mention_count_30d") or current_mentions or 0),
                unique_authors_7d=int(row.get("unique_authors_7d") or row.get("unique_authors_1d") or 0),
                platforms_active=platforms_active,
                author_concentration=_to_float(row.get("author_concentration")),
                trailing_mentions=[float(v) for v in trailing_mentions],
            )
            final_buzz_score = round(50.0 + ((raw_buzz_score - 50.0) * float(trust["score_multiplier"])), 2)
            score_rows.append(
                {
                    "symbol": symbol,
                    "trade_date": trade_date,
                    "buzz_zscore": round(buzz_zscore, 4) if buzz_zscore is not None else None,
                    "unique_author_zscore": round(unique_author_zscore, 4) if unique_author_zscore is not None else None,
                    "engagement_zscore": round(engagement_zscore, 4) if engagement_zscore is not None else None,
                    "mention_velocity": round(mention_velocity, 4) if mention_velocity is not None else None,
                    "mention_acceleration": round(mention_acceleration, 4) if mention_acceleration is not None else None,
                    "sentiment_trend_3d": round(sentiment_trend_3d, 4) if sentiment_trend_3d is not None else None,
                    "sentiment_trend_7d": round(sentiment_trend_7d, 4) if sentiment_trend_7d is not None else None,
                    "yahoo_mentions": int(yahoo_row.get("mention_count_1d") or 0) if yahoo_row else 0,
                    "stocktwits_mentions": int(stocktwits_row.get("mention_count_1d") or 0) if stocktwits_row else 0,
                    "yahoo_sentiment": yahoo_sentiment,
                    "stocktwits_sentiment": stocktwits_sentiment,
                    "cross_platform_agreement": round(cross_platform_agreement, 4) if cross_platform_agreement is not None else None,
                    "tradability_score": tradability_score,
                    "final_buzz_score": final_buzz_score,
                    "buzz_rank": None,
                    "score_validity": trust["validity"],
                    "confidence_tier": trust["confidence"],
                    "is_score_valid": trust["is_valid"],
                    "reason_codes": trust["reason_codes"],
                    "payload": {
                        "current_net_sentiment": current_sentiment,
                        "raw_buzz_score": round(raw_buzz_score, 2),
                        "history_dates": index + 1,
                        "posts_30d": int(row.get("mention_count_30d") or current_mentions or 0),
                        "unique_authors_7d": int(row.get("unique_authors_7d") or row.get("unique_authors_1d") or 0),
                        "platforms_active_30d": platforms_active,
                        "score_multiplier": trust["score_multiplier"],
                    },
                }
            )

    by_date: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in score_rows:
        by_date[str(row["trade_date"])].append(row)
    for trade_date, rows in by_date.items():
        ranked = sorted(rows, key=lambda item: float(item.get("final_buzz_score") or 0.0), reverse=True)
        for rank, row in enumerate(ranked, start=1):
            row["buzz_rank"] = rank

    db.bulk_upsert_buzz_scores(score_rows)
    print(
        json.dumps(
            {
                "processed_trade_dates": trade_dates,
                "daily_rows": len(all_daily_rows),
                "score_rows": len(score_rows),
                "db_stats": db.db_stats(),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
