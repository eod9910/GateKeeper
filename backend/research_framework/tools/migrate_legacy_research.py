#!/usr/bin/env python3
"""
Create normalized Research Study Framework records for existing legacy research
artifacts.

This migration is intentionally non-destructive. It does not move or delete
legacy artifacts because app services may still read those fixed paths. Instead
it creates central study folders under backend/data/research/studies/ with
manifest/config/summary/artifacts/notes files that point back to the legacy
files.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


ROOT = Path(__file__).resolve().parents[3]
RESEARCH_DIR = ROOT / "backend" / "data" / "research"
PLANNING_RESEARCH_DIR = ROOT / ".planning" / "Research Studies"
STUDIES_DIR = RESEARCH_DIR / "studies"
SCHEMA_VERSION = "research-study-manifest/v1"
FRAMEWORK_VERSION = "1"


@dataclass
class Artifact:
    path: Path
    role: str
    kind: str


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def rel(path: Path) -> str:
    try:
        return path.resolve().relative_to(ROOT).as_posix()
    except Exception:
        return path.as_posix()


def slugify(value: str, fallback: str = "study") -> str:
    value = re.sub(r"[^A-Za-z0-9]+", "-", value.strip().lower())
    value = re.sub(r"-+", "-", value).strip("-")
    return value[:150] or fallback


def git_commit() -> Optional[str]:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(ROOT),
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except Exception:
        return None


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return None


def artifact_kind(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".json":
        return "json"
    if suffix == ".csv":
        return "csv"
    if suffix == ".md":
        return "markdown"
    if suffix in {".png", ".jpg", ".jpeg", ".svg", ".html"}:
        return suffix.lstrip(".")
    if suffix == ".jsonl":
        return "jsonl"
    if suffix == ".log":
        return "log"
    if suffix == ".txt":
        return "text"
    return suffix.lstrip(".") or "file"


def artifact_role(path: Path) -> str:
    name = path.name.lower()
    if "config" in name:
        return "config"
    if "summary" in name or "report" in name:
        return "summary"
    if "trade" in name:
        return "trades"
    if "observation" in name or name.endswith("_obs.csv") or "_obs." in name:
        return "observations"
    if "chart" in name or path.suffix.lower() in {".png", ".svg", ".html"}:
        return "visual"
    if "progress" in name:
        return "progress"
    if "cache" in name:
        return "cache"
    if path.suffix.lower() == ".md":
        return "notes"
    return "artifact"


def canonical_group_key(path: Path) -> str:
    stem = path.stem.lower()
    stem = re.sub(r"\.latest$", "", stem)
    stem = re.sub(r"\.20\d{2}_20\d{2}(_no_eigen)?$", "", stem)
    stem = re.sub(r"_[0-9]{8}_[0-9]{6}$", "", stem)
    stem = re.sub(r"_20\d{6}t\d{6}z$", "", stem)
    stem = re.sub(r"_\d{13,}_[a-z0-9]{4,8}", "", stem)
    stem = re.sub(r"_(summary|observations|observation|trades|trade|config|progress|cache|latest|full|smoke|app)$", "", stem)
    stem = re.sub(r"_(summary|observations|trades|config)\.progress$", "", stem)
    stem = re.sub(r"_+", "_", stem).strip("_")
    return stem or path.stem.lower()


def classify(group: str, artifacts: List[Artifact]) -> str:
    text = " ".join([group] + [a.path.name.lower() for a in artifacts])
    if text.startswith("_tmp") or "_tmp" in text:
        return "scratch_legacy"
    if "coverage" in text or "audit" in text or "classification" in text or "snapshot" in text:
        return "data_audit"
    if "fundamental" in text or "dcf" in text or "pit" in text:
        return "fundamental_pit"
    if "valuation" in text or "valgap" in text or "gap_accuracy" in text:
        return "valuation_study"
    if "sweep" in text:
        return "parameter_sweep"
    return "exploratory_research"


def infer_engine(group: str, classification: str, artifacts: List[Artifact]) -> str:
    text = " ".join([group] + [a.path.name.lower() for a in artifacts])
    if "valuation_gap_accuracy" in text or "valgap" in text:
        return "valuation_gap_accuracy_study"
    if "valuation_signal_strategy" in text:
        return "valuation_signal_strategy"
    if "fundamental_backtest" in text:
        return "fundamental_backtester"
    if "reacceleration" in text:
        return "reacceleration_dcf_research"
    if "speculative_spike" in text:
        return "speculative_spike_research"
    if "eigen" in text:
        return "eigen_research"
    if "consumer_cycle" in text:
        return "consumer_cycle_research"
    if classification == "scratch_legacy":
        return "legacy_scratch"
    return classification


def infer_entrypoint(engine: str) -> Optional[str]:
    mapping = {
        "valuation_gap_accuracy_study": "backend/scripts/run_valuation_gap_accuracy_study.py",
        "valuation_signal_strategy": "backend/scripts/run_valuation_signal_strategy.py",
        "fundamental_backtester": "backend/scripts/run_fundamental_backtester.py",
        "reacceleration_dcf_research": "backend/scripts/run_reacceleration_dcf_backtest.py",
        "speculative_spike_research": "backend/scripts/run_speculative_spike_backtest.py",
        "eigen_research": "backend/scripts/run_eigen_perturbation_lab.py",
        "consumer_cycle_research": "backend/scripts/run_consumer_cycle_category_study.py",
    }
    return mapping.get(engine)


def title_from_group(group: str) -> str:
    return re.sub(r"[-_]+", " ", group).strip().title()


def modified_iso(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def summarize_json(path: Path) -> Dict[str, Any]:
    data = read_json(path)
    if not isinstance(data, dict):
        return {}
    summary: Dict[str, Any] = {}
    for key in [
        "generated_at",
        "created_at",
        "summary",
        "metrics",
        "result",
        "config",
        "files",
        "notes",
        "candidate_count",
        "trade_count",
        "observation_count",
        "symbol_count",
    ]:
        if key in data:
            summary[key] = data[key]
    return summary


def collect_research_artifacts() -> Dict[str, List[Artifact]]:
    groups: Dict[str, List[Artifact]] = {}
    if RESEARCH_DIR.exists():
        for path in RESEARCH_DIR.rglob("*"):
            if not path.is_file():
                continue
            if STUDIES_DIR in path.parents:
                continue
            key = canonical_group_key(path)
            groups.setdefault(key, []).append(Artifact(path=path, role=artifact_role(path), kind=artifact_kind(path)))
    if PLANNING_RESEARCH_DIR.exists():
        for path in PLANNING_RESEARCH_DIR.glob("*.md"):
            key = canonical_group_key(path)
            groups.setdefault(key, []).append(Artifact(path=path, role="notes", kind="markdown"))
    return groups


def artifact_payload(artifact: Artifact) -> Dict[str, Any]:
    return {
        "path": rel(artifact.path),
        "role": artifact.role,
        "kind": artifact.kind,
        "size_bytes": artifact.path.stat().st_size,
        "modified_at": modified_iso(artifact.path),
    }


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def study_id_for(group: str, artifacts: List[Artifact]) -> str:
    digest_src = "|".join(sorted(rel(a.path) for a in artifacts))
    digest = hashlib.sha1(digest_src.encode("utf-8")).hexdigest()[:8]
    return f"{slugify(group)}-{digest}"


def select_config(artifacts: List[Artifact]) -> Dict[str, Any]:
    for artifact in artifacts:
        if artifact.role == "config" and artifact.kind == "json":
            data = read_json(artifact.path)
            if isinstance(data, dict):
                return data
    for artifact in artifacts:
        if artifact.role == "summary" and artifact.kind == "json":
            data = read_json(artifact.path)
            if isinstance(data, dict) and isinstance(data.get("config"), dict):
                return data["config"]
    return {}


def select_summary(group: str, classification: str, engine: str, artifacts: List[Artifact]) -> Dict[str, Any]:
    summary: Dict[str, Any] = {
        "study_group": group,
        "classification": classification,
        "engine": engine,
        "artifact_count": len(artifacts),
        "artifact_roles": sorted(set(a.role for a in artifacts)),
    }
    for artifact in artifacts:
        if artifact.role == "summary" and artifact.kind == "json":
            extracted = summarize_json(artifact.path)
            if extracted:
                summary["legacy_summary_path"] = rel(artifact.path)
                summary["legacy_summary"] = extracted
                break
    return summary


def write_notes(path: Path, manifest: Dict[str, Any]) -> None:
    lines = [
        f"# {manifest['title']}",
        "",
        f"- Study ID: `{manifest['study_id']}`",
        f"- Classification: `{manifest['classification']}`",
        f"- Status: `{manifest['status']}`",
        f"- Engine/source: `{manifest['source']['engine']}`",
        f"- Legacy group: `{manifest['source']['legacy_group']}`",
        "",
        "## Provenance",
        "",
        "This record was created by the Research Study Framework legacy migration.",
        "Legacy artifacts were not moved; see `artifacts.json` for source paths.",
        "",
        "## Promotion",
        "",
        f"- State: `{manifest['promotion']['state']}`",
        f"- Required next engine: `{manifest['promotion']['required_next_engine']}`",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def promotion_for(classification: str) -> Dict[str, Any]:
    if classification == "valuation_study":
        return {
            "state": "research_only",
            "required_next_engine": "valuation service or Validator promotion path",
            "notes": ["Valuation evidence is not a live strategy until promoted and validated."],
        }
    if classification == "fundamental_pit":
        return {
            "state": "research_only",
            "required_next_engine": "Fundamental Backtester promotion path, then Validator",
            "notes": ["PIT research can suggest candidates but does not itself approve them."],
        }
    if classification == "scratch_legacy":
        return {
            "state": "not_promotable",
            "required_next_engine": "promote scratch into a named framework study first",
            "notes": ["Scratch artifacts are preserved for audit only."],
        }
    return {
        "state": "research_only",
        "required_next_engine": "Research Study Framework review, then appropriate app engine",
        "notes": ["Exploratory evidence must be promoted before it can become canonical strategy evidence."],
    }


def migrate(limit: Optional[int] = None) -> Dict[str, Any]:
    generated_at = now_iso()
    commit = git_commit()
    groups = collect_research_artifacts()
    registry: List[Dict[str, Any]] = []
    count = 0

    for group in sorted(groups):
        artifacts = sorted(groups[group], key=lambda item: rel(item.path))
        if limit is not None and count >= limit:
            break
        classification = classify(group, artifacts)
        engine = infer_engine(group, classification, artifacts)
        study_id = study_id_for(group, artifacts)
        study_dir = STUDIES_DIR / study_id
        created_at = min(modified_iso(a.path) for a in artifacts)
        updated_at = max(modified_iso(a.path) for a in artifacts)
        artifact_list = [artifact_payload(a) for a in artifacts]
        manifest = {
            "schema_version": SCHEMA_VERSION,
            "study_id": study_id,
            "title": title_from_group(group),
            "classification": classification,
            "status": "scratch_legacy" if classification == "scratch_legacy" else "legacy_imported",
            "created_at": created_at,
            "updated_at": updated_at,
            "framework": {
                "name": "research_study_framework",
                "version": FRAMEWORK_VERSION,
            },
            "source": {
                "engine": engine,
                "entrypoint": infer_entrypoint(engine),
                "legacy_group": group,
                "original_paths": [item["path"] for item in artifact_list],
            },
            "artifacts": artifact_list,
            "provenance": {
                "migration": "migrate_legacy_research.py",
                "git_commit": commit,
                "generated_at": generated_at,
                "notes": [
                    "Non-destructive import. Legacy artifacts were not moved.",
                    "Generated records provide central discovery and provenance.",
                ],
            },
            "promotion": promotion_for(classification),
        }
        write_json(study_dir / "manifest.json", manifest)
        write_json(study_dir / "config.json", select_config(artifacts))
        write_json(study_dir / "summary.json", select_summary(group, classification, engine, artifacts))
        write_json(study_dir / "artifacts.json", artifact_list)
        write_notes(study_dir / "notes.md", manifest)
        registry.append(
            {
                "study_id": study_id,
                "title": manifest["title"],
                "classification": classification,
                "status": manifest["status"],
                "engine": engine,
                "artifact_count": len(artifacts),
                "manifest": rel(study_dir / "manifest.json"),
            }
        )
        count += 1

    registry_payload = {
        "schema_version": "research-study-registry/v1",
        "generated_at": generated_at,
        "study_count": len(registry),
        "studies": registry,
    }
    write_json(STUDIES_DIR / "_registry.json", registry_payload)
    return registry_payload


def main(argv: Optional[Iterable[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Migrate legacy research artifacts into central study records.")
    parser.add_argument("--limit", type=int, default=None, help="Only migrate the first N groups, for smoke tests.")
    args = parser.parse_args(list(argv) if argv is not None else None)
    registry = migrate(limit=args.limit)
    print(json.dumps({"studies_dir": rel(STUDIES_DIR), "study_count": registry["study_count"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
