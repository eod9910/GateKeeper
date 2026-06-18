"""
Shared, dependency-free text-quality scoring for social posts.

Single source of truth for three fields that were previously hardcoded in the
StockTwits/Yahoo and Reddit row-builders:

  - spam scoring        -> (is_spam, spam_score)
  - topic labeling      -> a small fixed taxonomy label
  - content dedup key   -> stable hash that groups the SAME post across tickers
                           and copy-paste reposts, while keeping trivial posts
                           distinct (so they don't collapse into one mega-group)

Everything here is cheap and deterministic (no LLM, no network). Heavy semantic
judgment stays downstream at the thesis-extraction stage.
"""
from __future__ import annotations

import hashlib
import re
from typing import Any, Dict, Optional, Tuple

# --- normalization -----------------------------------------------------------

_URL_RE = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
_MD_LINK_RE = re.compile(r"\[([^\]]*)\]\([^)]*\)")        # [text](url) -> text
_CASHTAG_RE = re.compile(r"[\$#][A-Za-z][A-Za-z.\-]{0,9}\b")
_MENTION_RE = re.compile(r"@\w+")
_NON_WORD_RE = re.compile(r"[^a-z0-9\s]+")
_WS_RE = re.compile(r"\s+")
_EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF\u2190-\u21FF\u2B00-\u2BFF]"
)


def normalize_for_dedup(text: Optional[str]) -> str:
    """Aggressively normalize text for content-identity hashing."""
    if not text:
        return ""
    t = str(text).lower()
    t = _MD_LINK_RE.sub(r"\1", t)
    t = _URL_RE.sub(" ", t)
    t = _CASHTAG_RE.sub(" ", t)
    t = _MENTION_RE.sub(" ", t)
    t = _EMOJI_RE.sub(" ", t)
    t = _NON_WORD_RE.sub(" ", t)
    t = _WS_RE.sub(" ", t).strip()
    return t


def content_dedup_key(text: Optional[str], canonical_post_key: Optional[str] = None) -> Optional[str]:
    """Stable key grouping identical/near-identical content.

    Posts with real, matching content share a key (so one viral cross-ticker
    post or copy-paste repost can be collapsed to ONE when counting corpus-wide).
    Trivial/short posts fall back to their unique canonical id so a thousand
    "to the moon" one-liners don't collapse into a single bogus group.
    """
    norm = normalize_for_dedup(text)
    if len(norm) >= 16 and len(norm.split()) >= 3:
        return hashlib.md5(norm.encode("utf-8")).hexdigest()
    if canonical_post_key:
        return hashlib.md5(f"trivial:{canonical_post_key}".encode("utf-8")).hexdigest()
    return hashlib.md5(f"trivial:{norm}".encode("utf-8")).hexdigest() if norm else None


# --- spam scoring ------------------------------------------------------------

_PUMP_PHRASES = (
    "to the moon", "moon", "lambo", "rocket", "🚀", "10x", "100x", "next gme",
    "next amc", "easy money", "free money", "guaranteed", "cant lose", "can't lose",
    "all in", "yolo", "pump", "load up", "back up the truck", "buy now", "get in now",
    "dont miss", "don't miss", "to the moon", "squeeze incoming", "going parabolic",
    "join my", "dm me", "telegram", "discord.gg", "link in bio", "sign up",
)
_PROMO_RE = re.compile(r"(t\.me/|discord\.gg/|bit\.ly/|join\s+my|dm\s+me|link\s+in\s+bio)", re.IGNORECASE)
_REPEAT_CHAR_RE = re.compile(r"(.)\1{3,}")          # aaaa, !!!!, 🚀🚀🚀🚀
_LETTERS_RE = re.compile(r"[A-Za-z]")


def score_spam(
    text: Optional[str],
    *,
    token_count: Optional[int] = None,
    dedup_frequency: int = 1,
    has_ticker_mention: Optional[bool] = None,
) -> Tuple[bool, float]:
    """Heuristic spam score in [0,1]; is_spam when score >= 0.5.

    `dedup_frequency` is how many times this post's content key appears across
    the corpus — high counts flag copy-paste / botted chatter.
    """
    raw = str(text or "")
    norm = normalize_for_dedup(raw)
    tokens = norm.split()
    n_tokens = token_count if (token_count is not None) else len(tokens)

    score = 0.0

    # 1. Triviality: empty / emoji-only / one or two words of substance.
    if n_tokens == 0 or not norm:
        score += 0.9
    elif n_tokens <= 2:
        score += 0.45
    elif n_tokens <= 4:
        score += 0.2

    # 2. Pump / promo language.
    low = raw.lower()
    pump_hits = sum(1 for p in _PUMP_PHRASES if p in low)
    if pump_hits:
        score += min(0.45, 0.18 * pump_hits)
    if _PROMO_RE.search(low):
        score += 0.4  # solicitation / off-platform funnel

    # 3. Shouting / repeated characters.
    letters = _LETTERS_RE.findall(raw)
    if len(letters) >= 12:
        caps_ratio = sum(1 for c in letters if c.isupper()) / len(letters)
        if caps_ratio >= 0.7:
            score += 0.2
    if _REPEAT_CHAR_RE.search(raw):
        score += 0.15

    # 4. Link-dominated post with little text.
    if _URL_RE.search(raw) and len(tokens) <= 6:
        score += 0.25

    # 5. Copy-paste / botted: same content repeated many times in the corpus.
    if dedup_frequency >= 25:
        score += 0.4
    elif dedup_frequency >= 8:
        score += 0.2

    score = max(0.0, min(1.0, score))
    return (score >= 0.5, round(score, 3))


# --- topic labeling ----------------------------------------------------------
# Ordered by priority: the first listed topics are catalysts/fundamentals we
# care about most; later ones are generic. On multi-topic posts we pick the
# topic with the most keyword hits, breaking ties by this priority order.
_TOPIC_LEXICON = (
    ("clinical_fda", (
        "fda", "phase 1", "phase 2", "phase 3", "phase i", "phase ii", "phase iii",
        "clinical trial", "trial", "approval", "approved", "pdufa", "ema",
        "efficacy", "endpoint", "indication", "therapy", "drug", "vaccine", "biologic",
    )),
    ("m_and_a", (
        "acquisition", "acquire", "acquired", "merger", "merge", "buyout", "takeover",
        "take private", "tender offer", "deal to buy", "agreed to acquire", "spin-off",
        "spinoff", "divestiture", "strategic alternatives",
    )),
    ("legal", (
        "lawsuit", "sued", "litigation", "settlement", "subpoena", "investigation",
        "sec charges", "doj", "fraud", "class action", "injunction", "court",
    )),
    ("earnings", (
        "earnings", "eps", "revenue", "topline", "top line", "bottom line", "beat",
        "missed", "quarter", "q1", "q2", "q3", "q4", "results", "margins", "report",
    )),
    ("guidance", (
        "guidance", "outlook", "forecast", "raised guidance", "cut guidance",
        "lowered outlook", "reaffirmed", "preannounce",
    )),
    ("analyst_rating", (
        "upgrade", "downgrade", "price target", "initiated", "reiterated", "overweight",
        "underweight", "buy rating", "sell rating", "analyst", "coverage",
    )),
    ("insider", (
        "insider", "form 4", "ceo bought", "cfo bought", "insider buying",
        "insider selling", "10b5-1", "bought shares", "sold shares",
    )),
    ("product_tech", (
        "launch", "launched", "product", "chip", "gpu", "ai model", "artificial intelligence",
        "patent", "robot", "autonomous", "software", "platform", "partnership",
        "contract", "design win", "technology", "breakthrough", "rollout",
    )),
    ("short_squeeze", (
        "short squeeze", "squeeze", "short interest", "borrow fee", "ftd", "gamma",
        "shorts", "days to cover", "short ratio",
    )),
    ("dividend", (
        "dividend", "yield", "payout", "distribution", "buyback", "repurchase",
    )),
    ("macro", (
        "fed", "rate cut", "rate hike", "inflation", "cpi", "ppi", "tariff", "recession",
        "gdp", "jobs report", "fomc", "yields", "treasury",
    )),
    ("technical_chart", (
        "support", "resistance", "breakout", "breakdown", "chart", "moving average",
        "rsi", "macd", "fibonacci", "trendline", "pattern", "gap fill", "vwap",
        "double bottom", "head and shoulders", "cup and handle",
    )),
)


def classify_topic(text: Optional[str], *, is_spam: Optional[bool] = None) -> Optional[str]:
    """Assign a single topic label. Spam / trivial posts -> 'hype_noise';
    substantive-but-unmatched -> 'general_discussion'."""
    if not text:
        return "hype_noise"
    low = " " + str(text).lower() + " "
    best_topic: Optional[str] = None
    best_hits = 0
    for topic, keywords in _TOPIC_LEXICON:
        hits = 0
        for kw in keywords:
            if kw in low:
                hits += 1
        if hits > best_hits:
            best_hits = hits
            best_topic = topic
    if best_topic and best_hits > 0:
        return best_topic
    if is_spam:
        return "hype_noise"
    tokens = normalize_for_dedup(text).split()
    if len(tokens) <= 4:
        return "hype_noise"
    return "general_discussion"


def enrich_post(
    text: Optional[str],
    *,
    token_count: Optional[int] = None,
    canonical_post_key: Optional[str] = None,
    dedup_frequency: int = 1,
    has_ticker_mention: Optional[bool] = None,
) -> Dict[str, Any]:
    """Convenience: compute all quality fields for one post in one call."""
    dkey = content_dedup_key(text, canonical_post_key)
    is_spam, spam_score = score_spam(
        text,
        token_count=token_count,
        dedup_frequency=dedup_frequency,
        has_ticker_mention=has_ticker_mention,
    )
    topic = classify_topic(text, is_spam=is_spam)
    return {
        "duplicate_group_key": dkey,
        "is_spam": is_spam,
        "spam_score": spam_score,
        "topic_label": topic,
    }
