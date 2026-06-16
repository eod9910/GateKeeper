#!/usr/bin/env python3
"""
Strict role-message router for the tri-agent coding workflow.

The router is intentionally boring: it copies message bodies unchanged, hashes
the copied bytes, checks routes against an allowlist, appends JSONL metadata,
and regenerates role inbox files.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


ROOT = Path(__file__).resolve().parents[1]
RELAY_DIR = ROOT / "agent-relay"
MESSAGES_DIR = RELAY_DIR / "messages"
ROLES_DIR = RELAY_DIR / "roles"
ROUTER_DIR = RELAY_DIR / "router"
EXPORTS_DIR = RELAY_DIR / "exports"
ROUTE_LOG = ROUTER_DIR / "routes.jsonl"

ROLES = ("Builder", "Validator", "Editor", "User", "Router")
ALLOWED_ROUTES = {
    ("Builder", "Validator"),
    ("Validator", "Builder"),
    ("Validator", "Editor"),
    ("Editor", "Validator"),
    ("User", "Builder"),
    ("User", "Validator"),
    ("User", "Editor"),
    ("User", "Router"),
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


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
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    for role in ROLES:
        (ROLES_DIR / role).mkdir(parents=True, exist_ok=True)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_log() -> List[Dict[str, object]]:
    if not ROUTE_LOG.exists():
        return []
    records: List[Dict[str, object]] = []
    with ROUTE_LOG.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            records.append(json.loads(line))
    return records


def append_log(record: Dict[str, object]) -> None:
    ROUTER_DIR.mkdir(parents=True, exist_ok=True)
    with ROUTE_LOG.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, sort_keys=True) + "\n")


def route_id(timestamp: str, source: str, target: str, title: str) -> str:
    base = f"{timestamp}-{source}-{target}-{title}"
    digest = hashlib.sha1(base.encode("utf-8")).hexdigest()[:8]
    stamp = timestamp.replace("-", "").replace(":", "").replace("Z", "").replace("T", "-")
    return f"route-{stamp}-{safe_slug(source)}-to-{safe_slug(target)}-{digest}"


def copy_body(body_file: Path, routing_id: str) -> Tuple[Path, str]:
    if not body_file.exists() or not body_file.is_file():
        raise SystemExit(f"body file not found: {body_file}")
    data = body_file.read_bytes()
    digest = sha256_bytes(data)
    dest = MESSAGES_DIR / f"{routing_id}.md"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    copied_digest = sha256_bytes(dest.read_bytes())
    if copied_digest != digest:
        raise SystemExit("copied body hash mismatch")
    return dest, digest


def check_route(source: str, target: str) -> None:
    if source not in ROLES:
        raise SystemExit(f"unknown source role: {source}")
    if target not in ROLES:
        raise SystemExit(f"unknown target role: {target}")
    if (source, target) not in ALLOWED_ROUTES:
        raise SystemExit(f"route denied: {source} -> {target}")


def render_inbox(role: str, records: List[Dict[str, object]]) -> str:
    incoming = [r for r in records if r.get("target") == role]
    incoming.sort(key=lambda r: str(r.get("timestamp", "")))
    lines = [
        f"# {role} Inbox",
        "",
        f"Generated: {utc_now()}",
        "",
    ]
    if not incoming:
        lines.append("No routed messages.")
        lines.append("")
        return "\n".join(lines)
    for record in incoming:
        lines.extend(
            [
                f"## {record.get('title')}",
                "",
                f"- Routing ID: `{record.get('routing_id')}`",
                f"- From: `{record.get('source')}`",
                f"- Type: `{record.get('message_type')}`",
                f"- Phase: `{record.get('phase')}`",
                f"- Timestamp: `{record.get('timestamp')}`",
                f"- Body: `{record.get('body_path')}`",
                f"- SHA-256: `{record.get('sha256')}`",
                "",
            ]
        )
    return "\n".join(lines)


def regenerate_inboxes() -> None:
    ensure_dirs()
    records = read_log()
    for role in ROLES:
        inbox_path = ROLES_DIR / role / "INBOX.md"
        inbox_path.write_text(render_inbox(role, records), encoding="utf-8")


def cmd_routes(_args: argparse.Namespace) -> int:
    for source, target in sorted(ALLOWED_ROUTES):
        print(f"{source} -> {target}")
    return 0


def cmd_route(args: argparse.Namespace) -> int:
    ensure_dirs()
    check_route(args.source, args.target)
    timestamp = utc_now()
    routing_id = route_id(timestamp, args.source, args.target, args.title)
    body_path, digest = copy_body(Path(args.body_file), routing_id)
    record = {
        "routing_id": routing_id,
        "source": args.source,
        "target": args.target,
        "phase": args.phase,
        "message_type": args.message_type,
        "title": args.title,
        "timestamp": timestamp,
        "body_path": rel(body_path),
        "original_body_path": rel(Path(args.body_file)),
        "sha256": digest,
    }
    append_log(record)
    regenerate_inboxes()
    print(json.dumps(record, indent=2))
    return 0


def cmd_inbox(args: argparse.Namespace) -> int:
    ensure_dirs()
    if args.role not in ROLES:
        raise SystemExit(f"unknown role: {args.role}")
    regenerate_inboxes()
    print((ROLES_DIR / args.role / "INBOX.md").read_text(encoding="utf-8"))
    return 0


def cmd_verify(_args: argparse.Namespace) -> int:
    records = read_log()
    failures: List[str] = []
    for record in records:
        body = ROOT / str(record.get("body_path", ""))
        expected = str(record.get("sha256", ""))
        if not body.exists():
            failures.append(f"missing body: {record.get('routing_id')} {body}")
            continue
        actual = sha256_bytes(body.read_bytes())
        if actual != expected:
            failures.append(f"hash mismatch: {record.get('routing_id')}")
        try:
            check_route(str(record.get("source")), str(record.get("target")))
        except SystemExit as exc:
            failures.append(f"invalid route in log: {record.get('routing_id')} {exc}")
    if failures:
        print(json.dumps({"ok": False, "failures": failures}, indent=2))
        return 1
    print(json.dumps({"ok": True, "checked": len(records)}, indent=2))
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    records = [r for r in read_log() if not args.phase or r.get("phase") == args.phase]
    records.sort(key=lambda r: str(r.get("timestamp", "")))
    output = Path(args.output) if args.output else EXPORTS_DIR / f"{safe_slug(args.phase or 'all')}.md"
    if not output.is_absolute():
        output = ROOT / output
    output.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# Agent Relay Export: {args.phase or 'All Phases'}",
        "",
        f"Generated: {utc_now()}",
        "",
    ]
    for record in records:
        body_path = ROOT / str(record.get("body_path", ""))
        body = body_path.read_text(encoding="utf-8", errors="replace") if body_path.exists() else "[missing body]"
        lines.extend(
            [
                f"## {record.get('routing_id')}: {record.get('title')}",
                "",
                f"- From: `{record.get('source')}`",
                f"- To: `{record.get('target')}`",
                f"- Type: `{record.get('message_type')}`",
                f"- Phase: `{record.get('phase')}`",
                f"- Timestamp: `{record.get('timestamp')}`",
                f"- SHA-256: `{record.get('sha256')}`",
                "",
                "```text",
                body,
                "```",
                "",
            ]
        )
    output.write_text("\n".join(lines), encoding="utf-8")
    print(rel(output))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Route tri-agent role messages without rewriting them.")
    sub = parser.add_subparsers(dest="command", required=True)

    routes = sub.add_parser("routes", help="List allowed routes.")
    routes.set_defaults(func=cmd_routes)

    route = sub.add_parser("route", help="Route a message body between roles.")
    route.add_argument("--phase", required=True)
    route.add_argument("--source", required=True, choices=ROLES)
    route.add_argument("--target", required=True, choices=ROLES)
    route.add_argument("--type", required=True, dest="message_type")
    route.add_argument("--title", required=True)
    route.add_argument("--body-file", required=True)
    route.set_defaults(func=cmd_route)

    inbox = sub.add_parser("inbox", help="Print a role inbox.")
    inbox.add_argument("--role", required=True, choices=ROLES)
    inbox.set_defaults(func=cmd_inbox)

    verify = sub.add_parser("verify", help="Verify route log hashes and route allowlist.")
    verify.set_defaults(func=cmd_verify)

    export = sub.add_parser("export", help="Export routed message bodies to a markdown transcript.")
    export.add_argument("--phase")
    export.add_argument("--output")
    export.set_defaults(func=cmd_export)

    return parser


def main(argv: Optional[Iterable[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
