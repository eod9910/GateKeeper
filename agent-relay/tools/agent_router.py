#!/usr/bin/env python3
"""
Strict role-message router for a tri-agent coding workflow.

The router is intentionally boring: it copies message bodies unchanged, hashes
the copied bytes, checks routes against an allowlist, appends JSONL metadata,
and regenerates role inbox and transcript files.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List


ROOT = Path(__file__).resolve().parents[2]
RELAY_DIR = ROOT / "agent-relay"
MESSAGES_DIR = RELAY_DIR / "messages"
ROLES_DIR = RELAY_DIR / "roles"
ROUTER_DIR = RELAY_DIR / "router"
TRANSCRIPTS_DIR = RELAY_DIR / "transcripts"
TRANSCRIPT_ARCHIVE_DIR = TRANSCRIPTS_DIR / "archive" / "agent-relay"
PLANNING_DOCS_DIR = RELAY_DIR / "planning-docs"
PLANNING_ONGOING_DIR = PLANNING_DOCS_DIR / "ongoing"
PLANNING_FINISHED_DIR = PLANNING_DOCS_DIR / "finished"
ROUTE_LOG = ROUTER_DIR / "routes.jsonl"

AGENT_ROLES = ("Builder", "Validator", "Editor", "Experience", "Router")
ROUTE_PARTICIPANTS = (*AGENT_ROLES, "User")
ALLOWED_ROUTES = {
    ("Builder", "Validator"),
    ("Validator", "Builder"),
    ("Validator", "Editor"),
    ("Validator", "Experience"),
    ("Editor", "Validator"),
    ("Experience", "Validator"),
    ("User", "Builder"),
    ("User", "Validator"),
    ("User", "Editor"),
    ("User", "Experience"),
    ("User", "Router"),
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_route_timestamp(value: object) -> datetime:
    text = str(value or "")
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return datetime.now(timezone.utc)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def safe_slug(value: str, fallback: str = "message") -> str:
    out = []
    for ch in value.lower().strip():
        if ch.isalnum():
            out.append(ch)
        elif ch in (" ", "-", "_", ".", "/"):
            out.append("-")
    slug = "".join(out).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug[:100] or fallback


def rel(path: Path) -> str:
    try:
        return path.resolve().relative_to(ROOT).as_posix()
    except Exception:
        return path.as_posix()


def ensure_dirs() -> None:
    MESSAGES_DIR.mkdir(parents=True, exist_ok=True)
    ROUTER_DIR.mkdir(parents=True, exist_ok=True)
    TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
    PLANNING_ONGOING_DIR.mkdir(parents=True, exist_ok=True)
    PLANNING_FINISHED_DIR.mkdir(parents=True, exist_ok=True)
    for role in AGENT_ROLES:
        (ROLES_DIR / role).mkdir(parents=True, exist_ok=True)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_log() -> List[Dict[str, object]]:
    if not ROUTE_LOG.exists():
        return []
    rows: List[Dict[str, object]] = []
    for line in ROUTE_LOG.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def write_log(rows: Iterable[Dict[str, object]]) -> None:
    ensure_dirs()
    ROUTE_LOG.write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )


def append_log(row: Dict[str, object]) -> None:
    rows = read_log()
    rows.append(row)
    write_log(rows)


def route_message(args: argparse.Namespace) -> None:
    source = args.source
    target = args.target
    if (source, target) not in ALLOWED_ROUTES:
        raise SystemExit(f"Route not allowed: {source} -> {target}")

    body_file = Path(args.body_file)
    if not body_file.exists():
        raise SystemExit(f"Body file not found: {body_file}")

    ensure_dirs()
    body_bytes = body_file.read_bytes()
    digest = sha256_bytes(body_bytes)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    routing_id = f"route-{stamp}-{safe_slug(source)}-to-{safe_slug(target)}-{digest[:8]}"
    message_path = MESSAGES_DIR / f"{routing_id}.md"
    shutil.copyfile(body_file, message_path)

    row = {
        "routing_id": routing_id,
        "source": source,
        "target": target,
        "phase": args.phase,
        "message_type": args.type,
        "title": args.title,
        "timestamp": utc_now(),
        "body_path": rel(message_path),
        "original_body_path": rel(body_file),
        "sha256": digest,
    }
    append_log(row)
    regenerate_all()
    print(json.dumps(row, indent=2))


def rows_for_role(role: str) -> List[Dict[str, object]]:
    return [row for row in read_log() if row.get("target") == role]


def render_inbox(role: str) -> str:
    rows = rows_for_role(role)
    lines = [f"# {role} Inbox", ""]
    if not rows:
        lines.append("_No routed messages._")
        lines.append("")
        return "\n".join(lines)
    for row in rows:
        lines.extend(
            [
                f"## {row['timestamp']} - {row['title']}",
                "",
                f"- Routing ID: `{row['routing_id']}`",
                f"- From: `{row['source']}`",
                f"- Type: `{row['message_type']}`",
                f"- Phase: `{row['phase']}`",
                f"- Body: `{row['body_path']}`",
                f"- SHA-256: `{row['sha256']}`",
                "",
            ]
        )
    return "\n".join(lines)


def regenerate_inboxes() -> None:
    ensure_dirs()
    for role in AGENT_ROLES:
        inbox_path = ROLES_DIR / role / "INBOX.md"
        inbox_path.write_text(render_inbox(role), encoding="utf-8")


def read_body(row: Dict[str, object]) -> str:
    body_path = ROOT / str(row["body_path"])
    return body_path.read_text(encoding="utf-8")


def render_routed_body(body: str) -> str:
    """Nest routed message headings under the transcript envelope."""
    rendered: List[str] = []
    in_fenced_block = False
    for line in body.rstrip().splitlines():
        stripped = line.lstrip()
        if stripped.startswith("```"):
            in_fenced_block = not in_fenced_block
            rendered.append(line)
            continue
        if not in_fenced_block and stripped.startswith("#"):
            leading_space_count = len(line) - len(stripped)
            hash_count = len(stripped) - len(stripped.lstrip("#"))
            if hash_count > 0 and len(stripped) > hash_count and stripped[hash_count] == " ":
                nested_hashes = "#" * min(hash_count + 3, 6)
                rendered.append(f"{line[:leading_space_count]}{nested_hashes}{stripped[hash_count:]}")
                continue
        rendered.append(line)
    return "\n".join(rendered)


def render_transcript(rows: List[Dict[str, object]], title: str) -> str:
    lines = [f"# Agent Relay Ledger: {title}", "", f"Generated: {utc_now()}", ""]
    if not rows:
        lines.append("_No routed messages._")
        lines.append("")
        return "\n".join(lines)
    for index, row in enumerate(rows, start=1):
        label = f"{index}. {row['source']} -> {row['target']}: {row['title']}"
        lines.extend(
            [
                '<details markdown="1">',
                f"<summary>{label} | {row['message_type']} | {row['timestamp']} | {row['routing_id']}</summary>",
                "",
                f"## {label}",
                "",
                f"- Routing ID: `{row['routing_id']}`",
                f"- Type: `{row['message_type']}`",
                f"- Phase: `{row['phase']}`",
                f"- Timestamp: `{row['timestamp']}`",
                f"- Original: `{row['original_body_path']}`",
                f"- Body: `{row['body_path']}`",
                f"- SHA-256: `{row['sha256']}`",
                "",
                "### Routed Body",
                "",
                render_routed_body(read_body(row)),
                "",
                "</details>",
                "",
                "---",
                "",
            ]
        )
    return "\n".join(lines)


def write_phase_transcript(phase: str) -> Path:
    ensure_dirs()
    rows = [row for row in read_log() if row.get("phase") == phase]
    slug = safe_slug(phase, "phase")
    out = PLANNING_ONGOING_DIR / slug / f"{slug}.relay-transcript.md"
    out.write_text(render_transcript(rows, phase), encoding="utf-8")
    return out


def regenerate_transcripts() -> None:
    ensure_dirs()
    rows = read_log()
    legacy_all_path = TRANSCRIPTS_DIR / "all.md"
    if legacy_all_path.exists():
        legacy_all_path.unlink()
    all_path = TRANSCRIPTS_DIR / "agent-relay-ledger.md"
    all_path.write_text(render_transcript(rows, "all routes"), encoding="utf-8")
    write_calendar_archives(rows)


def calendar_archive_path(period: str, timestamp: datetime) -> Path:
    if period == "daily":
        return (
            TRANSCRIPT_ARCHIVE_DIR
            / "daily"
            / timestamp.strftime("%Y")
            / timestamp.strftime("%Y-%m")
            / f"{timestamp.strftime('%Y-%m-%d')}.md"
        )
    if period == "weekly":
        iso_year, iso_week, _ = timestamp.isocalendar()
        return TRANSCRIPT_ARCHIVE_DIR / "weekly" / str(iso_year) / f"{iso_year}-W{iso_week:02d}.md"
    if period == "monthly":
        return (
            TRANSCRIPT_ARCHIVE_DIR
            / "monthly"
            / timestamp.strftime("%Y")
            / f"{timestamp.strftime('%Y-%m')}.md"
        )
    raise ValueError(f"Unknown calendar period: {period}")


def write_calendar_archives(rows: List[Dict[str, object]]) -> None:
    buckets: Dict[Path, List[Dict[str, object]]] = {}
    for row in rows:
        timestamp = parse_route_timestamp(row.get("timestamp"))
        for period in ("daily", "weekly", "monthly"):
            path = calendar_archive_path(period, timestamp)
            buckets.setdefault(path, []).append(row)

    for path, bucket_rows in buckets.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(render_transcript(bucket_rows, path.stem), encoding="utf-8")


def regenerate_all() -> None:
    regenerate_inboxes()
    regenerate_transcripts()


def verify() -> None:
    rows = read_log()
    problems: List[str] = []
    seen = set()
    for row in rows:
        route = (row.get("source"), row.get("target"))
        if route not in ALLOWED_ROUTES:
            problems.append(f"Disallowed route in log: {route}")
        routing_id = row.get("routing_id")
        if routing_id in seen:
            problems.append(f"Duplicate routing id: {routing_id}")
        seen.add(routing_id)
        body_path = ROOT / str(row.get("body_path"))
        if not body_path.exists():
            problems.append(f"Missing body: {body_path}")
            continue
        actual = sha256_bytes(body_path.read_bytes())
        if actual != row.get("sha256"):
            problems.append(f"Hash mismatch for {body_path}")
    if problems:
        raise SystemExit(json.dumps({"ok": False, "problems": problems}, indent=2))
    print(json.dumps({"ok": True, "checked": len(rows)}, indent=2))


def print_routes() -> None:
    for source, target in sorted(ALLOWED_ROUTES):
        print(f"{source} -> {target}")


def print_inbox(args: argparse.Namespace) -> None:
    if args.role not in AGENT_ROLES:
        raise SystemExit(f"Unknown role: {args.role}")
    print(render_inbox(args.role))


def export_phase(args: argparse.Namespace) -> None:
    rows = [row for row in read_log() if row.get("phase") == args.phase]
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(render_transcript(rows, args.phase), encoding="utf-8")
    print(rel(output))


def transcript(args: argparse.Namespace) -> None:
    print(rel(write_phase_transcript(args.phase)))


def main() -> None:
    parser = argparse.ArgumentParser(description="Route tri-agent role messages without rewriting them.")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("routes", help="List allowed routes").set_defaults(func=lambda _args: print_routes())

    route = sub.add_parser("route", help="Route a message body between roles.")
    route.add_argument("--phase", required=True)
    route.add_argument("--source", required=True, choices=ROUTE_PARTICIPANTS)
    route.add_argument("--target", required=True, choices=ROUTE_PARTICIPANTS)
    route.add_argument("--type", required=True)
    route.add_argument("--title", required=True)
    route.add_argument("--body-file", required=True)
    route.set_defaults(func=route_message)

    inbox = sub.add_parser("inbox", help="Print a role inbox.")
    inbox.add_argument("--role", required=True, choices=AGENT_ROLES)
    inbox.set_defaults(func=print_inbox)

    sub.add_parser("verify", help="Verify route log hashes and route allowlist.").set_defaults(func=lambda _args: verify())

    export = sub.add_parser("export", help="Export routed message bodies to markdown.")
    export.add_argument("--phase", required=True)
    export.add_argument("--output", required=True)
    export.set_defaults(func=export_phase)

    trans = sub.add_parser("transcript", help="Write a readable phase transcript.")
    trans.add_argument("--phase", required=True)
    trans.set_defaults(func=transcript)

    sub.add_parser("regenerate", help="Regenerate inboxes and phase transcripts.").set_defaults(
        func=lambda _args: (regenerate_all(), print(rel(TRANSCRIPTS_DIR)))
    )

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
