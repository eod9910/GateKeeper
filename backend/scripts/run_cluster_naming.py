#!/usr/bin/env python
"""LLM cluster-naming + theme-proposal for Macro Engine scenarios (PRD D4, M3).

Reads multi-evidence ``news_cluster`` scenarios that haven't been named yet,
sends their evidence headlines to a cheap LLM, and updates the scenario's
title, summary, and primary_theme.

Per PRD D4: "LLM is used only to **name** clusters, never to decide membership."

Usage:
    py backend/scripts/run_cluster_naming.py                          # mock
    py backend/scripts/run_cluster_naming.py --llm-provider openai    # real
    py backend/scripts/run_cluster_naming.py --dry-run --verbose
    py backend/scripts/run_cluster_naming.py --min-evidence 2

Flags:
    --llm-provider TEXT    'mock' (default) or 'openai'
    --min-evidence INT     Only name scenarios with >= N evidence items (default 2)
    --max-scenarios INT    Process at most N scenarios per run (default 50)
    --model TEXT           OpenAI model name (default gpt-4o-mini)
    --dry-run              Compute names but do not write to DB
    --verbose              Print naming details
    --db-path PATH         Override default DB location
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import time
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional, Sequence, Tuple

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
PROJECT_ROOT = os.path.abspath(os.path.join(BACKEND_DIR, os.pardir))
DEFAULT_DB_PATH = os.path.join(BACKEND_DIR, "data", "market-intelligence.sqlite")
THEME_TAXONOMY_PATH = os.path.join(
    BACKEND_DIR, "data", "scenarios", "theme-taxonomy.json"
)
AI_SETTINGS_PATH = os.path.join(BACKEND_DIR, "data", "ai-settings.json")
DOTENV_PATH = os.path.join(BACKEND_DIR, ".env")

def _load_dotenv() -> None:
    """Minimal .env loader — sets vars that aren't already in os.environ."""
    if not os.path.isfile(DOTENV_PATH):
        return
    with open(DOTENV_PATH, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip()
            if key and key not in os.environ:
                os.environ[key] = value

_load_dotenv()

EXPECTED_SCHEMA_VERSION = 6
NAMING_NAMESPACE = "cluster_naming"


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def open_db(db_path: str) -> sqlite3.Connection:
    if not os.path.exists(db_path):
        sys.exit(f"[cluster-naming] DB missing at {db_path}.")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def check_schema(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT value FROM schema_meta WHERE key='schema_version'"
    ).fetchone()
    version = int(row["value"]) if row else 0
    if version < EXPECTED_SCHEMA_VERSION:
        sys.exit(
            f"[cluster-naming] schema_version={version}, "
            f"expected >= {EXPECTED_SCHEMA_VERSION}."
        )


def now_unix() -> int:
    return int(time.time())


# ---------------------------------------------------------------------------
# Load theme keys for validation
# ---------------------------------------------------------------------------

def load_valid_themes() -> List[str]:
    if not os.path.exists(THEME_TAXONOMY_PATH):
        return []
    with open(THEME_TAXONOMY_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    return [t["theme_key"] for t in data.get("themes", [])]


# ---------------------------------------------------------------------------
# Fetch unnamed scenarios
# ---------------------------------------------------------------------------

def fetch_unnamed_scenarios(
    conn: sqlite3.Connection,
    min_evidence: int = 2,
    max_scenarios: int = 50,
) -> List[Dict[str, Any]]:
    """Scenarios with detection_path='news_cluster' that haven't been LLM-named."""
    rows = conn.execute(
        """
        SELECT s.id, s.slug, s.title, s.summary, s.primary_theme,
               s.evidence_count, s.metadata_json
        FROM market_situations s
        WHERE s.detection_path = 'news_cluster'
          AND s.evidence_count >= ?
          AND s.status IN ('EARLY', 'DEVELOPING', 'CONFIRMED')
        ORDER BY s.evidence_count DESC, s.last_updated_at DESC
        LIMIT ?
        """,
        (min_evidence, max_scenarios),
    ).fetchall()

    result = []
    for r in rows:
        meta = json.loads(r["metadata_json"] or "{}")
        if meta.get("llm_named"):
            continue
        result.append(dict(r))
    return result


def fetch_evidence_for_scenario(
    conn: sqlite3.Connection,
    situation_id: int,
    limit: int = 20,
) -> List[Dict[str, str]]:
    rows = conn.execute(
        """
        SELECT headline_or_label, summary, source_name
        FROM situation_evidence
        WHERE situation_id = ?
        ORDER BY published_at DESC
        LIMIT ?
        """,
        (situation_id, limit),
    ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Naming result
# ---------------------------------------------------------------------------

class NamingResult:
    def __init__(
        self,
        title: str,
        summary: str,
        primary_theme: Optional[str],
        scenario_type: Optional[str] = None,
    ):
        self.title = title
        self.summary = summary
        self.primary_theme = primary_theme
        self.scenario_type = scenario_type


# ---------------------------------------------------------------------------
# LLM providers
# ---------------------------------------------------------------------------

NAMING_PROMPT_TEMPLATE = """You are a financial analyst naming macro scenarios for a market intelligence system.

Given the following evidence headlines from a news cluster, produce:
1. A concise scenario title (max 80 chars) describing the macro theme
2. A 1-2 sentence summary of what's happening and why it matters for markets
3. The best matching theme_key from this list: {theme_keys}
4. A scenario_type from: macro_regime_shift, sector_rotation, single_company_catalyst, geopolitical_event, policy_shift, commodity_shock

Evidence headlines:
{evidence}

Respond in JSON format:
{{"title": "...", "summary": "...", "primary_theme": "...", "scenario_type": "..."}}"""


class BaseNamer:
    name: str = "base"

    def name_cluster(
        self,
        evidence: List[Dict[str, str]],
        current_title: str,
        theme_keys: List[str],
    ) -> NamingResult:
        raise NotImplementedError


class MockNamer(BaseNamer):
    """Deterministic mock — synthesizes a title from the first evidence headline."""

    name = "mock"

    def name_cluster(
        self,
        evidence: List[Dict[str, str]],
        current_title: str,
        theme_keys: List[str],
    ) -> NamingResult:
        headlines = [e.get("headline_or_label", "") for e in evidence[:5]]
        if not headlines:
            return NamingResult(
                title=current_title[:80],
                summary="Macro cluster with insufficient evidence for naming.",
                primary_theme=None,
                scenario_type=None,
            )

        first = headlines[0][:60]
        title = f"[Macro] {first}" if not first.startswith("[") else first
        title = title[:80]

        summary_parts = [h[:50] for h in headlines[:3]]
        summary = f"Cluster of {len(evidence)} events: " + "; ".join(summary_parts)

        return NamingResult(
            title=title,
            summary=summary[:500],
            primary_theme=None,
            scenario_type=None,
        )


class OpenAINamer(BaseNamer):
    """Real OpenAI caller for cluster naming."""

    name = "openai"

    def __init__(self, model: str = "gpt-4o-mini", api_key: Optional[str] = None):
        self.model = model
        self.api_key = api_key or self._resolve_key()

    def _resolve_key(self) -> str:
        if os.environ.get("OPENAI_API_KEY"):
            return os.environ["OPENAI_API_KEY"]
        if os.path.exists(AI_SETTINGS_PATH):
            try:
                with open(AI_SETTINGS_PATH, "r") as f:
                    settings = json.load(f)
                key = settings.get("openaiApiKey") or settings.get("openai_api_key")
                if key:
                    return key
            except Exception:
                pass
        return ""

    def name_cluster(
        self,
        evidence: List[Dict[str, str]],
        current_title: str,
        theme_keys: List[str],
    ) -> NamingResult:
        if not self.api_key:
            print("[cluster-naming] WARNING: No OpenAI API key found, falling back to mock")
            return MockNamer().name_cluster(evidence, current_title, theme_keys)

        evidence_text = "\n".join(
            f"- [{e.get('source_name', '?')}] {e.get('headline_or_label', '')}"
            for e in evidence[:15]
        )

        prompt = NAMING_PROMPT_TEMPLATE.format(
            theme_keys=", ".join(theme_keys),
            evidence=evidence_text,
        )

        payload = json.dumps({
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
            "max_tokens": 300,
        }).encode("utf-8")

        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
        )

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = json.loads(resp.read())
            content = body["choices"][0]["message"]["content"]

            start = content.find("{")
            end = content.rfind("}") + 1
            if start >= 0 and end > start:
                parsed = json.loads(content[start:end])
            else:
                parsed = json.loads(content)

            theme = parsed.get("primary_theme")
            if theme and theme not in theme_keys:
                theme = None

            return NamingResult(
                title=str(parsed.get("title", current_title))[:80],
                summary=str(parsed.get("summary", ""))[:500],
                primary_theme=theme,
                scenario_type=parsed.get("scenario_type"),
            )
        except Exception as e:
            print(f"[cluster-naming] OpenAI call failed: {e}")
            return MockNamer().name_cluster(evidence, current_title, theme_keys)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run(
    db_path: str = DEFAULT_DB_PATH,
    llm_provider: str = "mock",
    min_evidence: int = 2,
    max_scenarios: int = 50,
    model: str = "gpt-4o-mini",
    dry_run: bool = False,
    verbose: bool = False,
) -> Dict[str, int]:
    conn = open_db(db_path)
    check_schema(conn)

    theme_keys = load_valid_themes()
    scenarios = fetch_unnamed_scenarios(conn, min_evidence, max_scenarios)

    if not scenarios:
        print("[cluster-naming] No unnamed scenarios to process.")
        conn.close()
        return {"named": 0, "skipped": 0}

    print(
        f"[cluster-naming] {len(scenarios)} unnamed scenarios "
        f"(min_evidence={min_evidence}, provider={llm_provider})"
    )

    namer: BaseNamer
    if llm_provider == "openai":
        namer = OpenAINamer(model=model)
    else:
        namer = MockNamer()

    named = 0
    skipped = 0

    for sc in scenarios:
        sit_id = int(sc["id"])
        evidence = fetch_evidence_for_scenario(conn, sit_id)

        if not evidence:
            skipped += 1
            continue

        result = namer.name_cluster(evidence, sc["title"], theme_keys)

        if verbose:
            print(
                f"  situation_id={sit_id} evidence={len(evidence)}\n"
                f"    old_title: {sc['title'][:60]}\n"
                f"    new_title: {result.title[:60]}\n"
                f"    theme: {sc['primary_theme']} -> {result.primary_theme or '(unchanged)'}"
            )

        if not dry_run:
            meta = json.loads(sc["metadata_json"] or "{}")
            meta["llm_named"] = True
            meta["naming_provider"] = namer.name
            meta["original_title"] = sc["title"][:200]

            updates = {
                "title": result.title,
                "summary": result.summary,
                "metadata_json": json.dumps(meta),
                "last_updated_at": now_unix(),
            }

            if result.primary_theme and result.primary_theme in theme_keys:
                updates["primary_theme"] = result.primary_theme

            if result.scenario_type:
                updates["scenario_type"] = result.scenario_type

            set_clause = ", ".join(f"{k} = ?" for k in updates)
            conn.execute(
                f"UPDATE market_situations SET {set_clause} WHERE id = ?",
                list(updates.values()) + [sit_id],
            )

        named += 1

    if not dry_run:
        conn.commit()

    conn.close()

    summary = {
        "named": named,
        "skipped": skipped,
        "provider": namer.name,
    }
    print(f"\n[cluster-naming] Done. {json.dumps(summary)}")
    return summary


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="LLM cluster naming for Macro Engine scenarios (PRD D4, M3)."
    )
    parser.add_argument("--db-path", default=DEFAULT_DB_PATH)
    parser.add_argument(
        "--llm-provider", default="mock", choices=["mock", "openai"],
        help="LLM provider (default: mock)",
    )
    parser.add_argument("--min-evidence", type=int, default=2)
    parser.add_argument("--max-scenarios", type=int, default=50)
    parser.add_argument("--model", default="gpt-4o-mini")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")

    args = parser.parse_args(list(argv) if argv else None)

    run(
        db_path=args.db_path,
        llm_provider=args.llm_provider,
        min_evidence=args.min_evidence,
        max_scenarios=args.max_scenarios,
        model=args.model,
        dry_run=args.dry_run,
        verbose=args.verbose,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
