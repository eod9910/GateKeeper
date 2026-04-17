from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "backend" / "data"
SYMBOL_CATALOG_DB_PATH = DATA_DIR / "symbol-catalog.sqlite"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _norm_symbol(value: Any) -> str:
    return str(value or "").strip().upper()


def _trim_text(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


def _to_float(value: Any) -> Optional[float]:
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    return num if num == num and num not in (float("inf"), float("-inf")) else None


CONSUMER_CYCLE_BUCKET_BY_CATEGORY = {
    "motor_vehicles_parts": "highly_cyclical",
    "furnishings_household_equipment": "highly_cyclical",
    "recreational_goods_vehicles": "highly_cyclical",
    "transportation_services": "highly_cyclical",
    "other_durable_goods": "highly_cyclical",
    "residential_investment": "highly_cyclical",
    "business_equipment_investment": "highly_cyclical",
    "clothing_footwear": "mildly_cyclical",
    "food_service_accommodations": "mildly_cyclical",
    "gas_energy_goods": "mildly_cyclical",
    "other_services": "mildly_cyclical",
    "recreation_services": "stable",
    "other_nondurable_goods": "stable",
    "food_beverages_home": "stable",
    "housing_utilities": "stable",
    "healthcare": "stable",
    "financial_services_insurance": "stable",
    "mixed_consumer": "mildly_cyclical",
    "non_consumer": "stable",
}


def _consumer_profile(
    *,
    demand_bucket: str,
    spend_class: str,
    category: str,
    cycle_sensitivity: str,
    recession_profile: str,
    macro_regime_preference: str,
    confidence: float,
) -> Dict[str, Any]:
    return {
        "consumer_demand_bucket": demand_bucket,
        "consumer_spend_class": spend_class,
        "consumer_spending_category": category,
        "consumer_cycle_bucket": CONSUMER_CYCLE_BUCKET_BY_CATEGORY.get(category, "stable"),
        "consumer_cycle_sensitivity": cycle_sensitivity,
        "recession_profile": recession_profile,
        "macro_regime_preference": macro_regime_preference,
        "consumer_classification_confidence": confidence,
    }


def classify_theme_memberships(snapshot: Optional[Dict[str, Any]]) -> List[str]:
    if not snapshot or not isinstance(snapshot, dict):
        return []

    sector = _trim_text(snapshot.get("sector"))
    industry = _trim_text(snapshot.get("industry"))
    company_name = (
        _trim_text(snapshot.get("companyName"))
        or _trim_text(snapshot.get("name"))
        or _trim_text(snapshot.get("sec_name"))
    )
    description = _trim_text(snapshot.get("businessDescription"))
    haystack = f"{sector or ''} {industry or ''} {company_name or ''} {description or ''}".lower()
    if not haystack.strip():
        return []

    def has_any(*tokens: str) -> bool:
        return any(token in haystack for token in tokens)

    is_software = (
        has_any(
            "software",
            "saas",
            "cloud",
            "application software",
            "infrastructure software",
            "developer tools",
            "devops",
            "database",
            "observability",
            "monitoring",
            "cybersecurity",
            "workflow software",
            "crm",
            "marketing automation",
            "advertising agencies",
            "digital advertising",
            "programmatic advertising",
            "digital media",
            "e-signature",
            "video conferencing",
            "work management",
            "project management",
            "enterprise software",
        )
        or has_any(
            "atlassian",
            "asana",
            "monday.com",
            "monday com",
            "doximity",
            "figma",
            "duolingo",
            "hubspot",
            "gitlab",
            "workday",
            "trade desk",
            "intuit",
            "klaviyo",
            "mongodb",
            "servicenow",
            "snowflake",
            "elastic",
            "braze",
            "commvault",
            "guidewire",
            "salesforce",
            "adobe",
            "docusign",
            "sap",
            "veeva",
            "zeta",
            "samsara",
            "autodesk",
            "datadog",
            "twilio",
            "cloudflare",
            "zoom",
        )
        or "software - application" in haystack
        or "software - infrastructure" in haystack
    )
    if not is_software:
        return []

    themes: List[str] = ["software"]
    if has_any("saas", "cloud", "cloud platform", "cloud-based", "cloud software", "iaas", "paas"):
        themes.append("cloud")
    if has_any(
        "application software",
        "software - application",
        "crm",
        "erp",
        "e-signature",
        "workflow",
        "marketing automation",
        "hr software",
        "project management",
        "work management",
        "video conferencing",
        "productivity software",
        "design software",
        "digital media",
    ):
        themes.append("software_application")
    if has_any(
        "infrastructure software",
        "software - infrastructure",
        "database",
        "data warehouse",
        "data platform",
        "observability",
        "monitoring",
        "logging",
        "edge network",
        "developer tools",
        "devops",
        "source code",
        "version control",
        "application lifecycle",
        "cybersecurity",
    ):
        themes.append("software_infrastructure")
    if has_any("developer tools", "devops", "source code", "version control", "ci/cd", "application lifecycle", "gitlab", "github"):
        themes.append("devtools")
    if has_any("database", "data warehouse", "data platform", "observability", "monitoring", "logging", "search analytics", "telemetry", "analytics cloud"):
        themes.append("data_infrastructure")
    if has_any("advertising", "adtech", "programmatic", "mobile advertising"):
        themes.append("adtech")
    if has_any("marketing automation", "customer engagement", "email marketing", "marketing cloud", "martech"):
        themes.append("marketing_software")
    if has_any("digital media", "creative software", "design software", "document cloud", "e-signature", "document management"):
        themes.append("design_creative_software")
    if has_any("video conferencing", "communications software", "collaboration", "productivity software", "work management", "project management", "messaging"):
        themes.append("collaboration_software")
    if has_any("payments processing", "financial technology", "fintech", "banking software", "insurance software", "capital markets software"):
        themes.append("fintech_software")
    if has_any("life sciences software", "healthcare software", "property and casualty software", "construction software", "vertical software", "industry cloud"):
        themes.append("vertical_software")
    return sorted(set(themes))


def classify_consumer_cycle_exposure(snapshot: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not snapshot or not isinstance(snapshot, dict):
        return None

    sector = _trim_text(snapshot.get("sector"))
    industry = _trim_text(snapshot.get("industry"))
    company_name = (
        _trim_text(snapshot.get("companyName"))
        or _trim_text(snapshot.get("name"))
        or _trim_text(snapshot.get("sec_name"))
    )
    description = _trim_text(snapshot.get("businessDescription"))
    haystack = f"{sector or ''} {industry or ''} {company_name or ''} {description or ''}".lower()

    if not haystack.strip():
        return None

    def has_any(*tokens: str) -> bool:
        return any(token in haystack for token in tokens)

    if has_any(
        "healthcare",
        "health care",
        "pharma",
        "pharmaceutical",
        "biotech",
        "medical",
        "hospital",
        "diagnostic",
        "dental",
        "surgical",
        "therapeutic",
        "life sciences",
    ):
        return _consumer_profile(
            demand_bucket="healthcare",
            spend_class="services",
            category="healthcare",
            cycle_sensitivity="defensive",
            recession_profile="resilient",
            macro_regime_preference="prefer_in_slowdown",
            confidence=0.93,
        )

    if has_any(
        "homebuilder",
        "homebuilders",
        "home building",
        "homebuilding",
        "residential construction",
        "single-family homes",
        "multifamily homes",
    ):
        return _consumer_profile(
            demand_bucket="residential_investment",
            spend_class="durable_goods",
            category="residential_investment",
            cycle_sensitivity="highly_cyclical",
            recession_profile="vulnerable",
            macro_regime_preference="avoid_in_slowdown",
            confidence=0.9,
        )

    if has_any(
        "industrial machinery",
        "industrial equipment",
        "machinery",
        "construction equipment",
        "farm equipment",
        "agricultural equipment",
        "semiconductor equipment",
        "semiconductor",
        "semiconductors",
        "chip",
        "chips",
        "network equipment",
        "networking",
        "server",
        "servers",
        "storage systems",
        "communications equipment",
        "data center",
        "datacenter",
        "factory automation",
        "capital equipment",
        "machine tools",
    ):
        return _consumer_profile(
            demand_bucket="business_equipment_investment",
            spend_class="durable_goods",
            category="business_equipment_investment",
            cycle_sensitivity="highly_cyclical",
            recession_profile="vulnerable",
            macro_regime_preference="avoid_in_slowdown",
            confidence=0.88,
        )

    if has_any(
        "utility",
        "utilities",
        "electric",
        "water",
        "gas distribution",
        "multi-utilities",
        "residential reit",
        "apartment",
        "single-family rental",
        "telecom",
        "wireless",
        "broadband",
    ):
        return _consumer_profile(
            demand_bucket="housing_utilities",
            spend_class="services",
            category="housing_utilities",
            cycle_sensitivity="defensive",
            recession_profile="resilient",
            macro_regime_preference="prefer_in_slowdown",
            confidence=0.88,
        )

    if has_any(
        "grocery",
        "food retail",
        "consumer staples",
        "packaged foods",
        "beverage",
        "beverages",
        "household products",
        "personal products",
        "discount stores",
        "supermarket",
        "tobacco",
    ):
        return _consumer_profile(
            demand_bucket="groceries_staples",
            spend_class="nondurable_goods",
            category="food_beverages_home",
            cycle_sensitivity="defensive",
            recession_profile="resilient",
            macro_regime_preference="prefer_in_slowdown",
            confidence=0.9,
        )

    if has_any(
        "insurance",
        "asset management",
        "capital markets",
        "consumer finance",
        "bank",
        "banks",
        "financial",
        "mortgage finance",
        "brokerage",
        "wealth management",
    ):
        return _consumer_profile(
            demand_bucket="financial_services_insurance",
            spend_class="services",
            category="financial_services_insurance",
            cycle_sensitivity="defensive",
            recession_profile="resilient",
            macro_regime_preference="prefer_in_slowdown",
            confidence=0.84,
        )

    if has_any("auto", "automotive", "motor vehicle", "vehicle", "dealership", "truck", "tire", "auto parts", "automotive parts"):
        return _consumer_profile(
            demand_bucket="autos_transport",
            spend_class="durable_goods",
            category="motor_vehicles_parts",
            cycle_sensitivity="highly_cyclical",
            recession_profile="vulnerable",
            macro_regime_preference="avoid_in_slowdown",
            confidence=0.91,
        )

    if has_any("airline", "airlines", "car rental", "transportation services", "travel services", "passenger rail", "airport services"):
        return _consumer_profile(
            demand_bucket="autos_transport",
            spend_class="services",
            category="transportation_services",
            cycle_sensitivity="highly_cyclical",
            recession_profile="vulnerable",
            macro_regime_preference="avoid_in_slowdown",
            confidence=0.87,
        )

    if has_any("furniture", "appliance", "home improvement", "building products", "flooring", "mattress", "home furnishings", "housing products"):
        return _consumer_profile(
            demand_bucket="home_furnishings_appliances",
            spend_class="durable_goods",
            category="furnishings_household_equipment",
            cycle_sensitivity="highly_cyclical",
            recession_profile="vulnerable",
            macro_regime_preference="avoid_in_slowdown",
            confidence=0.9,
        )

    if has_any(
        "aerospace",
        "defense",
        "industrial products",
        "engineered products",
        "electrical equipment",
        "heavy equipment",
        "trailers",
        "power tools",
        "consumer electronics",
        "electronic components",
        "instruments",
        "test equipment",
        "manufacturing equipment",
        "durable goods",
    ):
        return _consumer_profile(
            demand_bucket="recreation_discretionary",
            spend_class="durable_goods",
            category="other_durable_goods",
            cycle_sensitivity="highly_cyclical",
            recession_profile="vulnerable",
            macro_regime_preference="avoid_in_slowdown",
            confidence=0.82,
        )

    if has_any("restaurant", "restaurants", "hotel", "hotels", "lodging", "food service", "accommodation", "cruise", "theme park"):
        return _consumer_profile(
            demand_bucket="recreation_discretionary",
            spend_class="services",
            category="food_service_accommodations",
            cycle_sensitivity="mildly_cyclical",
            recession_profile="mixed",
            macro_regime_preference="selective_in_slowdown",
            confidence=0.88,
        )

    if has_any("apparel", "footwear", "shoe", "shoes", "clothing"):
        return _consumer_profile(
            demand_bucket="recreation_discretionary",
            spend_class="nondurable_goods",
            category="clothing_footwear",
            cycle_sensitivity="mildly_cyclical",
            recession_profile="mixed",
            macro_regime_preference="selective_in_slowdown",
            confidence=0.84,
        )

    if has_any("oil", "gasoline", "gas station", "fuel", "energy marketing", "refining", "refiner", "convenience store fuel", "petroleum"):
        return _consumer_profile(
            demand_bucket="consumer_mixed",
            spend_class="nondurable_goods",
            category="gas_energy_goods",
            cycle_sensitivity="mildly_cyclical",
            recession_profile="mixed",
            macro_regime_preference="selective_in_slowdown",
            confidence=0.8,
        )

    if has_any("chemical", "chemicals", "paper", "packaging", "containers", "sanitary products", "consumer products", "household chemicals", "specialty chemicals"):
        return _consumer_profile(
            demand_bucket="consumer_mixed",
            spend_class="nondurable_goods",
            category="other_nondurable_goods",
            cycle_sensitivity="defensive",
            recession_profile="resilient",
            macro_regime_preference="neutral_in_slowdown",
            confidence=0.76,
        )

    if has_any("gaming", "casino", "entertainment", "recreation", "leisure", "streaming", "media", "communication services", "internet content", "interactive media"):
        return _consumer_profile(
            demand_bucket="recreation_discretionary",
            spend_class="services",
            category="recreation_services",
            cycle_sensitivity="defensive",
            recession_profile="resilient",
            macro_regime_preference="neutral_in_slowdown",
            confidence=0.78,
        )

    if has_any("software", "saas", "cloud", "cybersecurity", "consulting", "staffing", "education services", "data processing", "advertising", "payments processing", "it services", "professional services"):
        return _consumer_profile(
            demand_bucket="consumer_mixed",
            spend_class="services",
            category="other_services",
            cycle_sensitivity="mildly_cyclical",
            recession_profile="mixed",
            macro_regime_preference="selective_in_slowdown",
            confidence=0.74,
        )

    if has_any("retail", "e-commerce", "consumer discretionary", "specialty consumer", "internet retail"):
        return _consumer_profile(
            demand_bucket="consumer_mixed",
            spend_class="services",
            category="other_services",
            cycle_sensitivity="mildly_cyclical",
            recession_profile="mixed",
            macro_regime_preference="selective_in_slowdown",
            confidence=0.62,
        )

    return _consumer_profile(
        demand_bucket="consumer_mixed",
        spend_class="services",
        category="other_services",
        cycle_sensitivity="mildly_cyclical",
        recession_profile="mixed",
        macro_regime_preference="selective_in_slowdown",
        confidence=0.45,
    )


def classify_company_from_snapshot(snapshot: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not snapshot or not isinstance(snapshot, dict):
        return None

    sector = _trim_text(snapshot.get("sector"))
    industry = _trim_text(snapshot.get("industry"))
    company_name = _trim_text(snapshot.get("companyName")) or _trim_text(snapshot.get("name")) or _trim_text(snapshot.get("sec_name"))
    description = _trim_text(snapshot.get("businessDescription"))
    haystack = f"{sector or ''} {industry or ''} {company_name or ''} {description or ''}".lower()
    free_cash_flow = _to_float(snapshot.get("freeCashFlowTTM"))
    operating_cash_flow = _to_float(snapshot.get("operatingCashFlowTTM"))
    revenue_growth_pct = _to_float(snapshot.get("revenueGrowthPct"))
    if revenue_growth_pct is None:
        revenue_growth_pct = _to_float(snapshot.get("revenueYoYGrowthPct"))

    if not sector and not industry and not company_name and not description:
        return None

    consumer_profile = classify_consumer_cycle_exposure(snapshot) or {}
    theme_memberships = classify_theme_memberships(snapshot)

    if any(
        token in haystack
        for token in (
            "financial",
            "bank",
            "banks",
            "insurance",
            "credit",
            "lender",
            "lending",
            "mortgage",
            "asset management",
            "capital markets",
            "consumer finance",
        )
    ):
        return {
            "sector": sector,
            "industry": industry,
            "company_type": "financial_company",
            "valuation_engine_class": "roe_book_value",
            "classification_source": "snapshot_rule",
            "classification_confidence": 0.92,
            "theme_memberships": theme_memberships,
            **consumer_profile,
        }

    if "reit" in haystack or "real estate investment trust" in haystack:
        return {
            "sector": sector,
            "industry": industry,
            "company_type": "reit",
            "valuation_engine_class": "reit_affo",
            "classification_source": "snapshot_rule",
            "classification_confidence": 0.9,
            "theme_memberships": theme_memberships,
            **consumer_profile,
        }

    if (free_cash_flow is not None and free_cash_flow < 0) or (
        operating_cash_flow is not None and operating_cash_flow < 0
    ):
        return {
            "sector": sector,
            "industry": industry,
            "company_type": "preprofit_growth",
            "valuation_engine_class": "sales_scenario",
            "classification_source": "snapshot_rule",
            "classification_confidence": 0.82 if revenue_growth_pct is not None else 0.72,
            "theme_memberships": theme_memberships,
            **consumer_profile,
        }

    return {
        "sector": sector,
        "industry": industry,
        "company_type": "operating_company",
        "valuation_engine_class": "dcf_operating",
        "classification_source": "snapshot_rule",
        "classification_confidence": 0.8,
        "theme_memberships": theme_memberships,
        **consumer_profile,
    }


class SymbolCatalogDb:
    def __init__(self, root: Optional[Path] = None) -> None:
        self.root = Path(root).resolve() if root is not None else ROOT
        self.db_path = self.root / "backend" / "data" / "symbol-catalog.sqlite"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA busy_timeout = 5000")
        return conn

    def _initialize(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS symbols (
                  symbol TEXT PRIMARY KEY,
                  asset_class TEXT NOT NULL,
                  name TEXT,
                  exchange TEXT,
                  sector TEXT,
                  industry TEXT,
                  active INTEGER NOT NULL DEFAULT 1,
                  optionable INTEGER,
                  underlying_symbol TEXT,
                  currency TEXT,
                  cik TEXT,
                  sec_name TEXT,
                  sec_exchange TEXT,
                  has_sec_mapping INTEGER,
                  company_type TEXT,
                  valuation_engine_class TEXT,
                  classification_source TEXT,
                  classification_confidence REAL,
                  last_classified_at TEXT,
                  source_json TEXT,
                  updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_symbols_asset_class
                  ON symbols(asset_class, symbol);

                CREATE INDEX IF NOT EXISTS idx_symbols_optionable
                  ON symbols(optionable, asset_class, symbol);

                CREATE TABLE IF NOT EXISTS symbol_memberships (
                  symbol TEXT NOT NULL,
                  membership_type TEXT NOT NULL,
                  membership_value TEXT NOT NULL,
                  source TEXT,
                  as_of TEXT,
                  payload_json TEXT,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY (symbol, membership_type, membership_value)
                );

                CREATE INDEX IF NOT EXISTS idx_symbol_memberships_lookup
                  ON symbol_memberships(membership_type, membership_value, symbol);

                CREATE TABLE IF NOT EXISTS symbol_metrics (
                  symbol TEXT NOT NULL,
                  metric_name TEXT NOT NULL,
                  metric_value_num REAL,
                  metric_value_text TEXT,
                  source TEXT,
                  as_of TEXT,
                  payload_json TEXT,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY (symbol, metric_name)
                );

                CREATE INDEX IF NOT EXISTS idx_symbol_metrics_lookup
                  ON symbol_metrics(metric_name, symbol);

                CREATE TABLE IF NOT EXISTS symbol_classification_overrides (
                  symbol TEXT NOT NULL,
                  domain TEXT NOT NULL,
                  cycle_bucket TEXT,
                  demand_bucket TEXT,
                  spend_class TEXT,
                  category TEXT,
                  cycle_sensitivity TEXT,
                  recession_profile TEXT,
                  macro_regime_preference TEXT,
                  note TEXT,
                  source TEXT,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY (symbol, domain)
                );

                CREATE INDEX IF NOT EXISTS idx_symbol_classification_overrides_domain
                  ON symbol_classification_overrides(domain, symbol);
                """
            )
            for ddl in (
                "ALTER TABLE symbols ADD COLUMN sector TEXT",
                "ALTER TABLE symbols ADD COLUMN industry TEXT",
                "ALTER TABLE symbols ADD COLUMN company_type TEXT",
                "ALTER TABLE symbols ADD COLUMN valuation_engine_class TEXT",
                "ALTER TABLE symbols ADD COLUMN classification_source TEXT",
                "ALTER TABLE symbols ADD COLUMN classification_confidence REAL",
                "ALTER TABLE symbols ADD COLUMN last_classified_at TEXT",
            ):
                try:
                    conn.execute(ddl)
                except sqlite3.OperationalError:
                    pass
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_symbols_company_type
                  ON symbols(company_type, valuation_engine_class, symbol)
                """
            )

    def reset(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                DELETE FROM symbol_metrics;
                DELETE FROM symbol_memberships;
                DELETE FROM symbols;
                """
            )

    def upsert_symbol(
        self,
        symbol: str,
        *,
        asset_class: str = "stocks",
        name: Optional[str] = None,
        exchange: Optional[str] = None,
        sector: Optional[str] = None,
        industry: Optional[str] = None,
        active: bool = True,
        optionable: Optional[bool] = None,
        underlying_symbol: Optional[str] = None,
        currency: Optional[str] = None,
        cik: Optional[str] = None,
        sec_name: Optional[str] = None,
        sec_exchange: Optional[str] = None,
        has_sec_mapping: Optional[bool] = None,
        company_type: Optional[str] = None,
        valuation_engine_class: Optional[str] = None,
        classification_source: Optional[str] = None,
        classification_confidence: Optional[float] = None,
        last_classified_at: Optional[str] = None,
        source: Optional[Dict[str, Any]] = None,
    ) -> None:
        sym = _norm_symbol(symbol)
        if not sym:
            return
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO symbols (
                  symbol, asset_class, name, exchange, sector, industry, active, optionable,
                  underlying_symbol, currency, cik, sec_name, sec_exchange,
                  has_sec_mapping, company_type, valuation_engine_class, classification_source,
                  classification_confidence, last_classified_at, source_json, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol) DO UPDATE SET
                  asset_class = COALESCE(excluded.asset_class, symbols.asset_class),
                  name = COALESCE(excluded.name, symbols.name),
                  exchange = COALESCE(excluded.exchange, symbols.exchange),
                  sector = COALESCE(excluded.sector, symbols.sector),
                  industry = COALESCE(excluded.industry, symbols.industry),
                  active = excluded.active,
                  optionable = COALESCE(excluded.optionable, symbols.optionable),
                  underlying_symbol = COALESCE(excluded.underlying_symbol, symbols.underlying_symbol),
                  currency = COALESCE(excluded.currency, symbols.currency),
                  cik = COALESCE(excluded.cik, symbols.cik),
                  sec_name = COALESCE(excluded.sec_name, symbols.sec_name),
                  sec_exchange = COALESCE(excluded.sec_exchange, symbols.sec_exchange),
                  has_sec_mapping = COALESCE(excluded.has_sec_mapping, symbols.has_sec_mapping),
                  company_type = COALESCE(excluded.company_type, symbols.company_type),
                  valuation_engine_class = COALESCE(excluded.valuation_engine_class, symbols.valuation_engine_class),
                  classification_source = COALESCE(excluded.classification_source, symbols.classification_source),
                  classification_confidence = COALESCE(excluded.classification_confidence, symbols.classification_confidence),
                  last_classified_at = COALESCE(excluded.last_classified_at, symbols.last_classified_at),
                  source_json = COALESCE(excluded.source_json, symbols.source_json),
                  updated_at = excluded.updated_at
                """,
                (
                    sym,
                    str(asset_class or "stocks"),
                    name,
                    exchange,
                    sector,
                    industry,
                    1 if active else 0,
                    None if optionable is None else (1 if optionable else 0),
                    _norm_symbol(underlying_symbol) or None,
                    currency,
                    str(cik) if cik not in (None, "") else None,
                    sec_name,
                    sec_exchange,
                    None if has_sec_mapping is None else (1 if has_sec_mapping else 0),
                    company_type,
                    valuation_engine_class,
                    classification_source,
                    classification_confidence,
                    last_classified_at,
                    json.dumps(source) if source is not None else None,
                    _utc_now_iso(),
                ),
            )

    def bulk_upsert_symbols(self, rows: Sequence[Dict[str, Any]]) -> None:
        prepared = []
        for row in rows:
            sym = _norm_symbol(row.get("symbol"))
            if not sym:
                continue
            prepared.append(
                (
                    sym,
                    str(row.get("asset_class") or "stocks"),
                    row.get("name"),
                    row.get("exchange"),
                    row.get("sector"),
                    row.get("industry"),
                    1 if row.get("active", True) else 0,
                    None if row.get("optionable") is None else (1 if row.get("optionable") else 0),
                    _norm_symbol(row.get("underlying_symbol")) or None,
                    row.get("currency"),
                    str(row.get("cik")) if row.get("cik") not in (None, "") else None,
                    row.get("sec_name"),
                    row.get("sec_exchange"),
                    None if row.get("has_sec_mapping") is None else (1 if row.get("has_sec_mapping") else 0),
                    row.get("company_type"),
                    row.get("valuation_engine_class"),
                    row.get("classification_source"),
                    row.get("classification_confidence"),
                    row.get("last_classified_at"),
                    json.dumps(row.get("source")) if row.get("source") is not None else None,
                    _utc_now_iso(),
                )
            )
        if not prepared:
            return
        with self._connect() as conn:
            conn.executemany(
                """
                INSERT INTO symbols (
                  symbol, asset_class, name, exchange, sector, industry, active, optionable,
                  underlying_symbol, currency, cik, sec_name, sec_exchange,
                  has_sec_mapping, company_type, valuation_engine_class, classification_source,
                  classification_confidence, last_classified_at, source_json, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol) DO UPDATE SET
                  asset_class = COALESCE(excluded.asset_class, symbols.asset_class),
                  name = COALESCE(excluded.name, symbols.name),
                  exchange = COALESCE(excluded.exchange, symbols.exchange),
                  sector = COALESCE(excluded.sector, symbols.sector),
                  industry = COALESCE(excluded.industry, symbols.industry),
                  active = excluded.active,
                  optionable = COALESCE(excluded.optionable, symbols.optionable),
                  underlying_symbol = COALESCE(excluded.underlying_symbol, symbols.underlying_symbol),
                  currency = COALESCE(excluded.currency, symbols.currency),
                  cik = COALESCE(excluded.cik, symbols.cik),
                  sec_name = COALESCE(excluded.sec_name, symbols.sec_name),
                  sec_exchange = COALESCE(excluded.sec_exchange, symbols.sec_exchange),
                  has_sec_mapping = COALESCE(excluded.has_sec_mapping, symbols.has_sec_mapping),
                  company_type = COALESCE(excluded.company_type, symbols.company_type),
                  valuation_engine_class = COALESCE(excluded.valuation_engine_class, symbols.valuation_engine_class),
                  classification_source = COALESCE(excluded.classification_source, symbols.classification_source),
                  classification_confidence = COALESCE(excluded.classification_confidence, symbols.classification_confidence),
                  last_classified_at = COALESCE(excluded.last_classified_at, symbols.last_classified_at),
                  source_json = COALESCE(excluded.source_json, symbols.source_json),
                  updated_at = excluded.updated_at
                """,
                prepared,
            )

    def get_symbol(self, symbol: str) -> Optional[Dict[str, Any]]:
        sym = _norm_symbol(symbol)
        if not sym:
            return None
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM symbols WHERE symbol = ?", (sym,)).fetchone()
        return dict(row) if row is not None else None

    def get_memberships(self, symbol: str, membership_type: Optional[str] = None) -> List[Dict[str, Any]]:
        sym = _norm_symbol(symbol)
        if not sym:
            return []
        params: List[Any] = [sym]
        sql = "SELECT * FROM symbol_memberships WHERE symbol = ?"
        if membership_type:
            sql += " AND membership_type = ?"
            params.append(str(membership_type))
        sql += " ORDER BY membership_type ASC, membership_value ASC"
        with self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [dict(row) for row in rows]

    def upsert_membership(
        self,
        symbol: str,
        membership_type: str,
        membership_value: str,
        *,
        source: Optional[str] = None,
        as_of: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
    ) -> None:
        sym = _norm_symbol(symbol)
        if not sym or not membership_type or not membership_value:
            return
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO symbol_memberships (
                  symbol, membership_type, membership_value, source, as_of, payload_json, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol, membership_type, membership_value) DO UPDATE SET
                  source = excluded.source,
                  as_of = excluded.as_of,
                  payload_json = excluded.payload_json,
                  updated_at = excluded.updated_at
                """,
                (
                    sym,
                    str(membership_type),
                    str(membership_value),
                    source,
                    as_of,
                    json.dumps(payload) if payload is not None else None,
                    _utc_now_iso(),
                ),
            )

    def delete_memberships(self, symbol: str, membership_type: str) -> None:
        sym = _norm_symbol(symbol)
        if not sym or not membership_type:
            return
        with self._connect() as conn:
            conn.execute(
                "DELETE FROM symbol_memberships WHERE symbol = ? AND membership_type = ?",
                (sym, str(membership_type)),
            )

    def bulk_upsert_memberships(self, rows: Sequence[Dict[str, Any]]) -> None:
        prepared = []
        for row in rows:
            sym = _norm_symbol(row.get("symbol"))
            membership_type = str(row.get("membership_type") or "").strip()
            membership_value = str(row.get("membership_value") or "").strip()
            if not sym or not membership_type or not membership_value:
                continue
            prepared.append(
                (
                    sym,
                    membership_type,
                    membership_value,
                    row.get("source"),
                    row.get("as_of"),
                    json.dumps(row.get("payload")) if row.get("payload") is not None else None,
                    _utc_now_iso(),
                )
            )
        if not prepared:
            return
        with self._connect() as conn:
            conn.executemany(
                """
                INSERT INTO symbol_memberships (
                  symbol, membership_type, membership_value, source, as_of, payload_json, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol, membership_type, membership_value) DO UPDATE SET
                  source = excluded.source,
                  as_of = excluded.as_of,
                  payload_json = excluded.payload_json,
                  updated_at = excluded.updated_at
                """,
                prepared,
            )

    def upsert_metric(
        self,
        symbol: str,
        metric_name: str,
        *,
        metric_value_num: Optional[float] = None,
        metric_value_text: Optional[str] = None,
        source: Optional[str] = None,
        as_of: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
    ) -> None:
        sym = _norm_symbol(symbol)
        if not sym or not metric_name:
            return
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO symbol_metrics (
                  symbol, metric_name, metric_value_num, metric_value_text, source, as_of, payload_json, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol, metric_name) DO UPDATE SET
                  metric_value_num = excluded.metric_value_num,
                  metric_value_text = excluded.metric_value_text,
                  source = excluded.source,
                  as_of = excluded.as_of,
                  payload_json = excluded.payload_json,
                  updated_at = excluded.updated_at
                """,
                (
                    sym,
                    str(metric_name),
                    metric_value_num,
                    metric_value_text,
                    source,
                    as_of,
                    json.dumps(payload) if payload is not None else None,
                    _utc_now_iso(),
                ),
            )

    def bulk_upsert_metrics(self, rows: Sequence[Dict[str, Any]]) -> None:
        prepared = []
        for row in rows:
            sym = _norm_symbol(row.get("symbol"))
            metric_name = str(row.get("metric_name") or "").strip()
            if not sym or not metric_name:
                continue
            prepared.append(
                (
                    sym,
                    metric_name,
                    row.get("metric_value_num"),
                    row.get("metric_value_text"),
                    row.get("source"),
                    row.get("as_of"),
                    json.dumps(row.get("payload")) if row.get("payload") is not None else None,
                    _utc_now_iso(),
                )
            )
        if not prepared:
            return
        with self._connect() as conn:
            conn.executemany(
                """
                INSERT INTO symbol_metrics (
                  symbol, metric_name, metric_value_num, metric_value_text, source, as_of, payload_json, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol, metric_name) DO UPDATE SET
                  metric_value_num = excluded.metric_value_num,
                  metric_value_text = excluded.metric_value_text,
                  source = excluded.source,
                  as_of = excluded.as_of,
                  payload_json = excluded.payload_json,
                  updated_at = excluded.updated_at
                """,
                prepared,
            )

    def query_symbols(
        self,
        *,
        asset_class: Optional[str] = None,
        optionable: Optional[bool] = None,
        memberships: Optional[Sequence[Tuple[str, str]]] = None,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        join_params: List[Any] = []
        where_params: List[Any] = []
        joins: List[str] = []
        wheres: List[str] = []

        if asset_class:
            wheres.append("s.asset_class = ?")
            where_params.append(asset_class)
        if optionable is not None:
            wheres.append("s.optionable = ?")
            where_params.append(1 if optionable else 0)

        for idx, (membership_type, membership_value) in enumerate(memberships or []):
            alias = f"m{idx}"
            joins.append(
                f"JOIN symbol_memberships {alias} "
                f"ON {alias}.symbol = s.symbol "
                f"AND {alias}.membership_type = ? "
                f"AND {alias}.membership_value = ?"
            )
            join_params.extend([membership_type, membership_value])

        sql = """
            SELECT s.symbol, s.asset_class, s.name, s.exchange, s.optionable
            FROM symbols s
        """
        if joins:
            sql += "\n" + "\n".join(joins)
        if wheres:
            sql += "\nWHERE " + " AND ".join(wheres)
        sql += "\nORDER BY s.symbol ASC"
        params = join_params + where_params
        if limit and limit > 0:
            sql += "\nLIMIT ?"
            params.append(int(limit))

        with self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [dict(row) for row in rows]

    def query_symbol_rows(
        self,
        *,
        asset_class: Optional[str] = None,
        optionable: Optional[bool] = None,
        memberships: Optional[Sequence[Tuple[str, str]]] = None,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        join_params: List[Any] = []
        where_params: List[Any] = []
        joins: List[str] = []
        wheres: List[str] = []

        if asset_class:
            wheres.append("s.asset_class = ?")
            where_params.append(asset_class)
        if optionable is not None:
            wheres.append("s.optionable = ?")
            where_params.append(1 if optionable else 0)

        for idx, (membership_type, membership_value) in enumerate(memberships or []):
            alias = f"m{idx}"
            joins.append(
                f"JOIN symbol_memberships {alias} "
                f"ON {alias}.symbol = s.symbol "
                f"AND {alias}.membership_type = ? "
                f"AND {alias}.membership_value = ?"
            )
            join_params.extend([membership_type, membership_value])

        sql = "SELECT s.* FROM symbols s"
        if joins:
            sql += "\n" + "\n".join(joins)
        if wheres:
            sql += "\nWHERE " + " AND ".join(wheres)
        sql += "\nORDER BY s.symbol ASC"
        params = join_params + where_params
        if limit and limit > 0:
            sql += "\nLIMIT ?"
            params.append(int(limit))

        with self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [dict(row) for row in rows]

    def get_classification_override(self, symbol: str, domain: str = "consumer_cycle") -> Optional[Dict[str, Any]]:
        sym = _norm_symbol(symbol)
        if not sym or not domain:
            return None
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM symbol_classification_overrides WHERE symbol = ? AND domain = ?",
                (sym, str(domain)),
            ).fetchone()
        return dict(row) if row is not None else None

    def list_classification_overrides(self, domain: str = "consumer_cycle") -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM symbol_classification_overrides WHERE domain = ? ORDER BY symbol ASC",
                (str(domain),),
            ).fetchall()
        return [dict(row) for row in rows]

    def upsert_classification_override(
        self,
        symbol: str,
        *,
        domain: str = "consumer_cycle",
        cycle_bucket: Optional[str] = None,
        demand_bucket: Optional[str] = None,
        spend_class: Optional[str] = None,
        category: Optional[str] = None,
        cycle_sensitivity: Optional[str] = None,
        recession_profile: Optional[str] = None,
        macro_regime_preference: Optional[str] = None,
        note: Optional[str] = None,
        source: Optional[str] = "manual_override",
    ) -> None:
        sym = _norm_symbol(symbol)
        if not sym or not domain:
            return
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO symbol_classification_overrides (
                  symbol, domain, cycle_bucket, demand_bucket, spend_class, category,
                  cycle_sensitivity, recession_profile, macro_regime_preference, note, source, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol, domain) DO UPDATE SET
                  cycle_bucket = excluded.cycle_bucket,
                  demand_bucket = excluded.demand_bucket,
                  spend_class = excluded.spend_class,
                  category = excluded.category,
                  cycle_sensitivity = excluded.cycle_sensitivity,
                  recession_profile = excluded.recession_profile,
                  macro_regime_preference = excluded.macro_regime_preference,
                  note = excluded.note,
                  source = excluded.source,
                  updated_at = excluded.updated_at
                """,
                (
                    sym,
                    str(domain),
                    cycle_bucket,
                    demand_bucket,
                    spend_class,
                    category,
                    cycle_sensitivity,
                    recession_profile,
                    macro_regime_preference,
                    note,
                    source,
                    _utc_now_iso(),
                ),
            )

    def count_rows(self) -> Dict[str, int]:
        with self._connect() as conn:
            symbols = conn.execute("SELECT COUNT(*) FROM symbols").fetchone()[0]
            memberships = conn.execute("SELECT COUNT(*) FROM symbol_memberships").fetchone()[0]
            metrics = conn.execute("SELECT COUNT(*) FROM symbol_metrics").fetchone()[0]
        return {
            "symbols": int(symbols),
            "memberships": int(memberships),
            "metrics": int(metrics),
        }


__all__ = [
    "SYMBOL_CATALOG_DB_PATH",
    "SymbolCatalogDb",
    "classify_company_from_snapshot",
    "classify_consumer_cycle_exposure",
]
