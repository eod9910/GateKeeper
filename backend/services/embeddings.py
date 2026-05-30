"""Embedding + dictionary-based entity extraction for the Macro Engine.

PRD references: D4 (clustering method), D21 M2 (embedding + entity extraction).

Provides:
    EmbeddingModel   – wraps sentence-transformers/all-MiniLM-L6-v2
    EntityExtractor  – dictionary-based extraction from universe_clean.json
    embed_and_extract – convenience for batch processing
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Set, Tuple

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent
DATA_DIR = BACKEND_DIR / "data"

UNIVERSE_CLEAN_PATH = DATA_DIR / "universe_clean.json"

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_DIM = 384


# ---------------------------------------------------------------------------
# Entity types recognised by the extractor
# ---------------------------------------------------------------------------

COMMODITY_LEXICON: Dict[str, str] = {
    "crude oil": "COMMODITY:CL",
    "wti crude": "COMMODITY:CL",
    "wti": "COMMODITY:CL",
    "brent crude": "COMMODITY:BZ",
    "brent": "COMMODITY:BZ",
    "natural gas": "COMMODITY:NG",
    "henry hub": "COMMODITY:NG",
    "gold": "COMMODITY:GC",
    "silver": "COMMODITY:SI",
    "copper": "COMMODITY:HG",
    "lumber": "COMMODITY:LB",
    "wheat": "COMMODITY:ZW",
    "corn": "COMMODITY:ZC",
    "soybeans": "COMMODITY:ZS",
    "soybean": "COMMODITY:ZS",
    "cotton": "COMMODITY:CT",
    "coffee": "COMMODITY:KC",
    "cocoa": "COMMODITY:CC",
    "sugar": "COMMODITY:SB",
    "platinum": "COMMODITY:PL",
    "palladium": "COMMODITY:PA",
    "uranium": "COMMODITY:UX",
    "lithium": "COMMODITY:LI",
    "iron ore": "COMMODITY:IO",
}

POLICY_BODY_LEXICON: Dict[str, str] = {
    "federal reserve": "POLICY:FED",
    "the fed": "POLICY:FED",
    "fed chair": "POLICY:FED",
    "fomc": "POLICY:FOMC",
    "ecb": "POLICY:ECB",
    "european central bank": "POLICY:ECB",
    "bank of japan": "POLICY:BOJ",
    "boj": "POLICY:BOJ",
    "bank of england": "POLICY:BOE",
    "boe": "POLICY:BOE",
    "people's bank of china": "POLICY:PBOC",
    "pboc": "POLICY:PBOC",
    "sec": "POLICY:SEC",
    "securities and exchange commission": "POLICY:SEC",
    "treasury": "POLICY:TREASURY",
    "treasury department": "POLICY:TREASURY",
    "white house": "POLICY:WH",
    "congress": "POLICY:CONGRESS",
    "senate": "POLICY:SENATE",
    "imf": "POLICY:IMF",
    "world bank": "POLICY:WORLDBANK",
    "opec": "POLICY:OPEC",
    "opec+": "POLICY:OPEC",
    "department of justice": "POLICY:DOJ",
    "doj": "POLICY:DOJ",
    "ftc": "POLICY:FTC",
    "federal trade commission": "POLICY:FTC",
    "epa": "POLICY:EPA",
    "fda": "POLICY:FDA",
    "cftc": "POLICY:CFTC",
}

MACRO_CONCEPT_LEXICON: Dict[str, str] = {
    "inflation": "MACRO:INFLATION",
    "cpi": "MACRO:CPI",
    "consumer price index": "MACRO:CPI",
    "pce": "MACRO:PCE",
    "interest rate": "MACRO:RATES",
    "interest rates": "MACRO:RATES",
    "rate hike": "MACRO:RATES",
    "rate cut": "MACRO:RATES",
    "fed funds": "MACRO:RATES",
    "federal funds rate": "MACRO:RATES",
    "treasury yield": "MACRO:YIELDS",
    "yield curve": "MACRO:YIELDS",
    "10-year": "MACRO:YIELDS",
    "unemployment": "MACRO:EMPLOYMENT",
    "nonfarm payroll": "MACRO:EMPLOYMENT",
    "nonfarm payrolls": "MACRO:EMPLOYMENT",
    "jobs report": "MACRO:EMPLOYMENT",
    "gdp": "MACRO:GDP",
    "gross domestic product": "MACRO:GDP",
    "recession": "MACRO:RECESSION",
    "trade deficit": "MACRO:TRADE",
    "trade war": "MACRO:TRADE",
    "tariff": "MACRO:TARIFF",
    "tariffs": "MACRO:TARIFF",
    "sanctions": "MACRO:SANCTIONS",
    "quantitative easing": "MACRO:QE",
    "quantitative tightening": "MACRO:QT",
    "balance sheet": "MACRO:BALANCE_SHEET",
    "debt ceiling": "MACRO:DEBT_CEILING",
    "default": "MACRO:DEFAULT",
    "housing market": "MACRO:HOUSING",
    "housing starts": "MACRO:HOUSING",
    "mortgage rate": "MACRO:HOUSING",
}

COUNTRY_LEXICON: Dict[str, str] = {
    "china": "COUNTRY:CN",
    "chinese": "COUNTRY:CN",
    "russia": "COUNTRY:RU",
    "russian": "COUNTRY:RU",
    "ukraine": "COUNTRY:UA",
    "ukrainian": "COUNTRY:UA",
    "taiwan": "COUNTRY:TW",
    "japan": "COUNTRY:JP",
    "japanese": "COUNTRY:JP",
    "germany": "COUNTRY:DE",
    "german": "COUNTRY:DE",
    "india": "COUNTRY:IN",
    "indian": "COUNTRY:IN",
    "brazil": "COUNTRY:BR",
    "saudi arabia": "COUNTRY:SA",
    "saudi": "COUNTRY:SA",
    "iran": "COUNTRY:IR",
    "iranian": "COUNTRY:IR",
    "mexico": "COUNTRY:MX",
    "canada": "COUNTRY:CA",
    "canadian": "COUNTRY:CA",
    "united kingdom": "COUNTRY:GB",
    "uk": "COUNTRY:GB",
    "south korea": "COUNTRY:KR",
    "korean": "COUNTRY:KR",
    "israel": "COUNTRY:IL",
    "israeli": "COUNTRY:IL",
    "european union": "COUNTRY:EU",
    "eu": "COUNTRY:EU",
}

SECTOR_LEXICON: Dict[str, str] = {
    "semiconductor": "SECTOR:SEMIS",
    "semiconductors": "SECTOR:SEMIS",
    "chip": "SECTOR:SEMIS",
    "chips": "SECTOR:SEMIS",
    "artificial intelligence": "SECTOR:AI",
    "machine learning": "SECTOR:AI",
    "ai": "SECTOR:AI",
    "defense": "SECTOR:DEFENSE",
    "defence": "SECTOR:DEFENSE",
    "aerospace": "SECTOR:AEROSPACE",
    "biotech": "SECTOR:BIOTECH",
    "biotechnology": "SECTOR:BIOTECH",
    "pharmaceutical": "SECTOR:PHARMA",
    "pharma": "SECTOR:PHARMA",
    "electric vehicle": "SECTOR:EV",
    "ev": "SECTOR:EV",
    "renewable energy": "SECTOR:RENEWABLES",
    "solar": "SECTOR:SOLAR",
    "wind energy": "SECTOR:WIND",
    "nuclear": "SECTOR:NUCLEAR",
    "cryptocurrency": "SECTOR:CRYPTO",
    "crypto": "SECTOR:CRYPTO",
    "bitcoin": "SECTOR:CRYPTO",
    "blockchain": "SECTOR:CRYPTO",
    "real estate": "SECTOR:REALESTATE",
    "reit": "SECTOR:REALESTATE",
    "banking": "SECTOR:BANKS",
    "banks": "SECTOR:BANKS",
    "insurance": "SECTOR:INSURANCE",
    "fintech": "SECTOR:FINTECH",
    "cloud computing": "SECTOR:CLOUD",
    "cybersecurity": "SECTOR:CYBERSEC",
    "cyber security": "SECTOR:CYBERSEC",
    "streaming": "SECTOR:STREAMING",
    "social media": "SECTOR:SOCIALMEDIA",
    "e-commerce": "SECTOR:ECOMMERCE",
    "ecommerce": "SECTOR:ECOMMERCE",
    "retail": "SECTOR:RETAIL",
    "healthcare": "SECTOR:HEALTHCARE",
    "telecom": "SECTOR:TELECOM",
    "telecommunications": "SECTOR:TELECOM",
    "oil and gas": "SECTOR:OIL_GAS",
    "energy": "SECTOR:ENERGY",
    "mining": "SECTOR:MINING",
    "automotive": "SECTOR:AUTO",
    "automaker": "SECTOR:AUTO",
}


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class ExtractedEntities:
    """Entities found in a text passage."""
    tickers: List[str] = field(default_factory=list)
    companies: List[str] = field(default_factory=list)
    commodities: List[str] = field(default_factory=list)
    policy_bodies: List[str] = field(default_factory=list)
    macro_concepts: List[str] = field(default_factory=list)
    countries: List[str] = field(default_factory=list)
    sectors: List[str] = field(default_factory=list)

    def all_entity_ids(self) -> List[str]:
        """Flat list of normalised entity IDs for cluster-matching."""
        out: List[str] = []
        for t in self.tickers:
            out.append(f"TICKER:{t}")
        out.extend(self.commodities)
        out.extend(self.policy_bodies)
        out.extend(self.macro_concepts)
        out.extend(self.countries)
        out.extend(self.sectors)
        return sorted(set(out))

    def to_dict(self) -> dict:
        return {
            "tickers": self.tickers,
            "companies": self.companies,
            "commodities": self.commodities,
            "policy_bodies": self.policy_bodies,
            "macro_concepts": self.macro_concepts,
            "countries": self.countries,
            "sectors": self.sectors,
            "entity_ids": self.all_entity_ids(),
        }


# ---------------------------------------------------------------------------
# EmbeddingModel
# ---------------------------------------------------------------------------

class EmbeddingModel:
    """Lazy-loading wrapper around sentence-transformers."""

    def __init__(self, model_name: str = MODEL_NAME, device: Optional[str] = None):
        self.model_name = model_name
        self.device = device or os.getenv("MI_EMBEDDING_DEVICE", "cpu")
        self._model = None

    def _load(self):
        if self._model is not None:
            return
        from sentence_transformers import SentenceTransformer
        self._model = SentenceTransformer(self.model_name, device=self.device)

    def embed(self, texts: Sequence[str]) -> List[List[float]]:
        self._load()
        embeddings = self._model.encode(
            list(texts),
            show_progress_bar=False,
            convert_to_numpy=True,
        )
        return [row.tolist() for row in embeddings]

    def embed_single(self, text: str) -> List[float]:
        return self.embed([text])[0]


# ---------------------------------------------------------------------------
# EntityExtractor  (dictionary-based, uses universe_clean.json)
# ---------------------------------------------------------------------------

class EntityExtractor:
    """Regex + dictionary entity extractor for financial text.

    Uses the project's own ``universe_clean.json`` for company/ticker
    recognition, plus static lexicons for commodities, policy bodies,
    macro concepts, countries, and sectors.
    """

    def __init__(
        self,
        universe_path: Optional[Path] = None,
        min_ticker_len: int = 2,
    ):
        self.universe_path = universe_path or UNIVERSE_CLEAN_PATH
        self.min_ticker_len = min_ticker_len

        # ticker -> company short name  (loaded lazily)
        self._ticker_to_name: Optional[Dict[str, str]] = None
        # lowercased name fragment -> ticker  (loaded lazily)
        self._name_to_ticker: Optional[Dict[str, str]] = None

        # Pre-compile lexicon regexes (longest-first for greedy matching)
        self._commodity_re = self._build_lexicon_regex(COMMODITY_LEXICON)
        self._policy_re = self._build_lexicon_regex(POLICY_BODY_LEXICON)
        self._macro_re = self._build_lexicon_regex(MACRO_CONCEPT_LEXICON)
        self._country_re = self._build_lexicon_regex(COUNTRY_LEXICON)
        self._sector_re = self._build_lexicon_regex(SECTOR_LEXICON)

    # -- universe loading --------------------------------------------------

    def _load_universe(self) -> None:
        if self._ticker_to_name is not None:
            return
        self._ticker_to_name = {}
        self._name_to_ticker = {}
        if not self.universe_path.exists():
            return
        with open(self.universe_path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        stocks = data.get("stocks", [])
        for s in stocks:
            ticker = s.get("ticker", "").strip().upper()
            if not ticker:
                continue
            raw_name = s.get("name", "")
            short_name = self._clean_company_name(raw_name)
            self._ticker_to_name[ticker] = short_name

            if len(short_name) >= 5:
                self._name_to_ticker[short_name.lower()] = ticker

            sec_name = s.get("sec_name", "")
            if sec_name:
                sec_short = self._clean_company_name(sec_name)
                if len(sec_short) >= 5:
                    self._name_to_ticker[sec_short.lower()] = ticker

    @staticmethod
    def _clean_company_name(raw: str) -> str:
        """Strip common suffixes like ', Inc.', ' Common Stock', etc."""
        s = raw.strip()
        for suffix in (
            " Common Stock", " Class A", " Class B", " Class C",
            " Ordinary Shares", " American Depositary Shares",
            " Global Depositary Shares",
        ):
            idx = s.find(suffix)
            if idx > 0:
                s = s[:idx]
        s = re.sub(
            r",?\s*(?:Inc\.?|Corp\.?|Corporation|Ltd\.?|Limited|LLC|"
            r"L\.P\.?|PLC|plc|N\.V\.?|S\.A\.?|AG|SE|Co\.?|Group|"
            r"Holdings?|Bancorp|Technologies|International)\s*$",
            "",
            s,
            flags=re.IGNORECASE,
        )
        return s.strip().rstrip(",").strip()

    # -- regex helpers -----------------------------------------------------

    @staticmethod
    def _build_lexicon_regex(
        lexicon: Dict[str, str],
    ) -> re.Pattern:
        phrases = sorted(lexicon.keys(), key=len, reverse=True)
        escaped = [re.escape(p) for p in phrases]
        pattern = r"\b(?:" + "|".join(escaped) + r")\b"
        return re.compile(pattern, re.IGNORECASE)

    # -- ticker regex (matches $AAPL or standalone uppercase 2-5 letter) ----

    _TICKER_CASHTAG_RE = re.compile(r"\$([A-Z]{1,5})\b")
    _TICKER_BARE_RE = re.compile(r"\b([A-Z]{2,5})\b")

    # Common English words that look like tickers
    _TICKER_STOPWORDS: Set[str] = {
        "A", "I", "AM", "AN", "AS", "AT", "BE", "BY", "DO", "GO", "HE",
        "IF", "IN", "IS", "IT", "ME", "MY", "NO", "OF", "OK", "ON", "OR",
        "SO", "TO", "UP", "US", "WE", "ALL", "AND", "ANY", "ARE", "BIG",
        "BUT", "CAN", "DID", "FAR", "FEW", "FOR", "GET", "GOT", "HAS",
        "HAD", "HER", "HIM", "HIS", "HOW", "ITS", "LET", "MAY", "NEW",
        "NOT", "NOW", "OLD", "ONE", "OUR", "OUT", "OWN", "RAN", "SAY",
        "SET", "SHE", "THE", "TOO", "TWO", "USE", "WAR", "WAS", "WAY",
        "WHO", "WHY", "WIN", "WON", "YET", "YOU", "ALSO", "BEEN", "COME",
        "EACH", "FROM", "HAVE", "HERE", "HIGH", "INTO", "JUST", "LAST",
        "LONG", "LOOK", "MAKE", "MANY", "MORE", "MOST", "MUCH", "MUST",
        "NEXT", "ONLY", "OVER", "PLAN", "PART", "POST", "SAME", "SAID",
        "SOME", "SUCH", "TAKE", "TELL", "THAN", "THAT", "THEM", "THEN",
        "THEY", "THIS", "TIME", "VERY", "WANT", "WEEK", "WELL", "WERE",
        "WHAT", "WHEN", "WILL", "WITH", "WORK", "YEAR", "YOUR",
        "ABOUT", "AFTER", "BEING", "BELOW", "COULD", "EVERY", "FIRST",
        "FOUND", "GIVEN", "GREAT", "BASED", "LARGE", "LATER", "MAJOR",
        "MONTH", "MOVED", "NAMED", "OTHER", "PARTY", "PRICE", "RIGHT",
        "SHALL", "SHARE", "SINCE", "SMALL", "SOUTH", "NORTH", "STATE",
        "STILL", "THEIR", "THERE", "THESE", "THING", "THINK", "THREE",
        "TOTAL", "UNDER", "UNTIL", "UPPER", "WATER", "WHERE", "WHICH",
        "WHILE", "WORLD", "WOULD", "ABOVE",
        "FED", "SEC", "GDP", "CPI", "IMF",
        "CEO", "CFO", "COO", "IPO",
        "ETF", "NYSE", "API", "CEO", "USA", "LLC",
        "NEWS", "DATA", "SAYS", "ALSO",
        "PER", "DAY", "NET", "LOW", "TOP", "END",
        "OIL", "GAS", "TAX", "PAY", "BUY", "CUT",
        "KEY", "JOB", "JOBS",
        # Ambiguous tickers that are almost always false positives
        # in macro news text (AP = Associated Press, EU = European Union,
        # WTI = West Texas Intermediate crude, III/CIA = common words)
        "AP", "EU", "WTI", "III", "CIA",
    }

    # -- main extraction ---------------------------------------------------

    def extract(self, text: str) -> ExtractedEntities:
        """Extract all entity types from *text*."""
        self._load_universe()
        result = ExtractedEntities()

        # 1) Tickers — cashtags first, then bare uppercase words
        seen_tickers: Set[str] = set()
        for m in self._TICKER_CASHTAG_RE.finditer(text):
            t = m.group(1)
            if t in self._ticker_to_name and t not in seen_tickers:
                seen_tickers.add(t)
                result.tickers.append(t)

        for m in self._TICKER_BARE_RE.finditer(text):
            t = m.group(1)
            if (
                t not in seen_tickers
                and len(t) >= self.min_ticker_len
                and t not in self._TICKER_STOPWORDS
                and t in self._ticker_to_name
            ):
                seen_tickers.add(t)
                result.tickers.append(t)

        # 2) Company names (substring match on cleaned name fragments)
        text_lower = text.lower()
        seen_companies: Set[str] = set()
        for name_frag, ticker in self._name_to_ticker.items():
            if name_frag in text_lower and ticker not in seen_companies:
                seen_companies.add(ticker)
                result.companies.append(
                    f"{ticker}:{self._ticker_to_name.get(ticker, name_frag)}"
                )
                if ticker not in seen_tickers:
                    seen_tickers.add(ticker)
                    result.tickers.append(ticker)

        # 3) Commodities
        seen_comm: Set[str] = set()
        for m in self._commodity_re.finditer(text):
            entity_id = COMMODITY_LEXICON[m.group(0).lower()]
            if entity_id not in seen_comm:
                seen_comm.add(entity_id)
                result.commodities.append(entity_id)

        # 4) Policy bodies
        seen_pol: Set[str] = set()
        for m in self._policy_re.finditer(text):
            entity_id = POLICY_BODY_LEXICON[m.group(0).lower()]
            if entity_id not in seen_pol:
                seen_pol.add(entity_id)
                result.policy_bodies.append(entity_id)

        # 5) Macro concepts
        seen_mac: Set[str] = set()
        for m in self._macro_re.finditer(text):
            entity_id = MACRO_CONCEPT_LEXICON[m.group(0).lower()]
            if entity_id not in seen_mac:
                seen_mac.add(entity_id)
                result.macro_concepts.append(entity_id)

        # 6) Countries
        seen_cty: Set[str] = set()
        for m in self._country_re.finditer(text):
            entity_id = COUNTRY_LEXICON[m.group(0).lower()]
            if entity_id not in seen_cty:
                seen_cty.add(entity_id)
                result.countries.append(entity_id)

        # 7) Sectors
        seen_sec: Set[str] = set()
        for m in self._sector_re.finditer(text):
            entity_id = SECTOR_LEXICON[m.group(0).lower()]
            if entity_id not in seen_sec:
                seen_sec.add(entity_id)
                result.sectors.append(entity_id)

        return result


# ---------------------------------------------------------------------------
# Convenience: embed + extract in one pass
# ---------------------------------------------------------------------------

@dataclass
class EmbeddedHit:
    """Result of embedding + entity extraction for a single hit."""
    hit_id: int
    embedding: List[float]
    entities: ExtractedEntities


def embed_and_extract(
    hits: Sequence[Tuple[int, str]],
    model: Optional[EmbeddingModel] = None,
    extractor: Optional[EntityExtractor] = None,
) -> List[EmbeddedHit]:
    """Process a batch of (hit_id, text) pairs.

    Returns one ``EmbeddedHit`` per input.
    """
    if not hits:
        return []
    if model is None:
        model = EmbeddingModel()
    if extractor is None:
        extractor = EntityExtractor()

    texts = [t for _, t in hits]
    embeddings = model.embed(texts)

    results: List[EmbeddedHit] = []
    for (hit_id, text), emb in zip(hits, embeddings):
        entities = extractor.extract(text)
        results.append(EmbeddedHit(
            hit_id=hit_id,
            embedding=emb,
            entities=entities,
        ))
    return results
