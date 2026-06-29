#!/usr/bin/env python3
"""
Mirror Codex session rollouts into a repo-local offline folder.

Codex stores conversations as JSONL rollout files under ~/.codex/sessions.
This helper copies the relevant rollouts for the current workspace and writes
compact Markdown/JSON views that are useful for continuity without loading the
entire transcript into startup context.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from codex_transcript_memory import (
    build_active_thread_bullets,
    build_likely_next_step_bullets,
    build_open_question_bullets,
    build_recent_directive_bullets,
    build_topic_matches,
    dedupe_strings,
    extract_last_prompt,
    extract_last_substantive_prompt,
    extract_memory_headline,
    format_bullets,
)


DEFAULT_INTERVAL_SECONDS = 30.0
MAX_TRANSCRIPT_CHARS = 240_000
SESSION_CACHE_VERSION = 1
USER_TO_VALIDATOR_TRANSCRIPT_NAME = "user-to-validator.md"


@dataclass
class SessionRecord:
    id: str
    path: Path
    updated_at: str = ""
    thread_name: str = ""
    cwd: str = ""
    originator: str = ""
    source: str = ""
    messages: list[dict[str, str]] = field(default_factory=list)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Mirror Codex session rollouts into an offline folder."
    )
    parser.add_argument(
        "--workspace",
        default=str(Path.cwd()),
        help="Workspace path used to select matching Codex sessions.",
    )
    parser.add_argument(
        "--output",
        default=str(Path.cwd() / "agent-relay" / "transcripts" / "codex-live"),
        help="Destination folder for mirrored files and decoded views.",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=DEFAULT_INTERVAL_SECONDS,
        help="Polling interval in seconds when --watch is enabled.",
    )
    parser.add_argument(
        "--watch",
        action="store_true",
        help="Continuously mirror Codex sessions.",
    )
    return parser


def get_codex_root() -> Path:
    codex_home = os.environ.get("CODEX_HOME")
    root = Path(codex_home).expanduser() if codex_home else Path.home() / ".codex"
    if not root.exists():
        raise RuntimeError(f"Codex home not found: {root}")
    return root


def normalize_path_text(path: str | Path) -> str:
    return str(Path(path).resolve()).replace("/", "\\").rstrip("\\").lower()


def path_matches_workspace(session_cwd: str, workspace_path: Path) -> bool:
    if not session_cwd:
        return True
    session_path = normalize_path_text(session_cwd)
    workspace = normalize_path_text(workspace_path)
    if session_path == workspace:
        return True
    return workspace.startswith(session_path + "\\") or session_path.startswith(workspace + "\\")


def parse_timestamp(value: str) -> datetime | None:
    if not value:
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def session_datetime(record: SessionRecord) -> datetime:
    parsed = parse_timestamp(record.updated_at)
    if parsed:
        return parsed
    return datetime.fromtimestamp(record.path.stat().st_mtime)


def calendar_archive_path(base_dir: Path, period: str, timestamp: datetime) -> Path:
    archive_dir = base_dir / "archive" / "user-to-validator"
    if period == "daily":
        return (
            archive_dir
            / "daily"
            / timestamp.strftime("%Y")
            / timestamp.strftime("%Y-%m")
            / f"{timestamp.strftime('%Y-%m-%d')}.md"
        )
    if period == "weekly":
        iso_year, iso_week, _ = timestamp.isocalendar()
        return archive_dir / "weekly" / str(iso_year) / f"{iso_year}-W{iso_week:02d}.md"
    if period == "monthly":
        return (
            archive_dir
            / "monthly"
            / timestamp.strftime("%Y")
            / f"{timestamp.strftime('%Y-%m')}.md"
        )
    raise ValueError(f"Unknown calendar period: {period}")


def render_user_validator_archive(title: str, sessions: list[SessionRecord]) -> str:
    lines = [
        f"# User To Validator Transcript: {title}",
        "",
        "> Auto-generated from the Codex transcript mirror.",
        "> Treat this as sensitive repo transcript context.",
        "",
        f"- Generated epoch ms: `{int(time.time() * 1000)}`",
        f"- Sessions: `{len(sessions)}`",
        "",
    ]
    for session in sessions:
        lines.extend([render_session_markdown(session), "", "---", ""])
    return "\n".join(lines)


def write_user_validator_calendar_archives(output_dir: Path, sessions: list[SessionRecord]) -> None:
    buckets: dict[Path, list[SessionRecord]] = {}
    for session in sessions:
        timestamp = session_datetime(session)
        for period in ("daily", "weekly", "monthly"):
            path = calendar_archive_path(output_dir, period, timestamp)
            buckets.setdefault(path, []).append(session)

    for path, bucket_sessions in buckets.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            render_user_validator_archive(path.stem, bucket_sessions),
            encoding="utf-8",
        )


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    if not path.exists():
        return records
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(item, dict):
                records.append(item)
    return records


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")


def write_text_if_changed(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        try:
            if path.read_text(encoding="utf-8") == text:
                return
        except Exception:
            pass
    path.write_text(text, encoding="utf-8")


def load_json_file(path: Path) -> Any:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def copy_if_exists(source: Path, destination: Path) -> None:
    if not source.exists():
        return
    if destination.exists():
        try:
            source_stat = source.stat()
            destination_stat = destination.stat()
            if (
                source_stat.st_size == destination_stat.st_size
                and int(source_stat.st_mtime) == int(destination_stat.st_mtime)
            ):
                return
        except OSError:
            pass
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copy2(source, destination)
    except PermissionError:
        pass


def read_session_index(codex_root: Path) -> dict[str, dict[str, str]]:
    index_path = codex_root / "session_index.jsonl"
    entries: dict[str, dict[str, str]] = {}
    for row in load_jsonl(index_path):
        session_id = str(row.get("id") or "").strip()
        if not session_id:
            continue
        entries[session_id] = {
            "thread_name": str(row.get("thread_name") or ""),
            "updated_at": str(row.get("updated_at") or ""),
        }
    return entries


def text_from_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n\n".join(parts)
    return ""


def extract_message(row: dict[str, Any]) -> dict[str, str] | None:
    payload = row.get("payload")
    timestamp = str(row.get("timestamp") or "")
    if not isinstance(payload, dict):
        return None

    if row.get("type") == "response_item" and payload.get("type") == "message":
        role = str(payload.get("role") or "")
        text = text_from_content(payload.get("content"))
        if role in {"user", "assistant"} and text:
            return {"timestamp": timestamp, "role": role, "text": text}

    if row.get("type") == "event_msg" and payload.get("type") == "user_message":
        text = str(payload.get("message") or "")
        if text:
            return {"timestamp": timestamp, "role": "user", "text": text}

    return None


def parse_session(path: Path, index: dict[str, dict[str, str]]) -> SessionRecord | None:
    rows = load_jsonl(path)
    if not rows:
        return None

    session_id = path.stem
    if session_id.startswith("rollout-"):
        parts = session_id.split("-")
        if len(parts) >= 7:
            session_id = "-".join(parts[-5:])

    record = SessionRecord(id=session_id, path=path)
    if session_id in index:
        record.thread_name = index[session_id].get("thread_name", "")
        record.updated_at = index[session_id].get("updated_at", "")

    for row in rows:
        payload = row.get("payload")
        if row.get("type") == "session_meta" and isinstance(payload, dict):
            record.id = str(payload.get("id") or record.id)
            record.cwd = str(payload.get("cwd") or "")
            record.originator = str(payload.get("originator") or "")
            record.source = str(payload.get("source") or "")
            if not record.updated_at:
                record.updated_at = str(row.get("timestamp") or "")
        message = extract_message(row)
        if message:
            duplicate = (
                record.messages
                and record.messages[-1]["role"] == message["role"]
                and record.messages[-1]["text"] == message["text"]
            )
            if not duplicate:
                record.messages.append(message)

    return record


def file_signature(path: Path) -> dict[str, int]:
    stat = path.stat()
    return {"mtime_ns": stat.st_mtime_ns, "size": stat.st_size}


def record_to_cache_payload(record: SessionRecord, signature: dict[str, int]) -> dict[str, Any]:
    return {
        "version": SESSION_CACHE_VERSION,
        "signature": signature,
        "record": {
            "id": record.id,
            "path": str(record.path),
            "updated_at": record.updated_at,
            "thread_name": record.thread_name,
            "cwd": record.cwd,
            "originator": record.originator,
            "source": record.source,
            "messages": record.messages,
        },
    }


def record_from_cache_payload(path: Path, payload: dict[str, Any]) -> SessionRecord | None:
    if payload.get("version") != SESSION_CACHE_VERSION:
        return None
    record_payload = payload.get("record")
    if not isinstance(record_payload, dict):
        return None
    messages = record_payload.get("messages")
    if not isinstance(messages, list):
        return None
    return SessionRecord(
        id=str(record_payload.get("id") or path.stem),
        path=path,
        updated_at=str(record_payload.get("updated_at") or ""),
        thread_name=str(record_payload.get("thread_name") or ""),
        cwd=str(record_payload.get("cwd") or ""),
        originator=str(record_payload.get("originator") or ""),
        source=str(record_payload.get("source") or ""),
        messages=[
            {
                "timestamp": str(item.get("timestamp") or ""),
                "role": str(item.get("role") or ""),
                "text": str(item.get("text") or ""),
            }
            for item in messages
            if isinstance(item, dict)
        ],
    )


def cached_record_for_path(
    path: Path,
    cache_entries: dict[str, Any],
    signature: dict[str, int],
) -> SessionRecord | None:
    payload = cache_entries.get(str(path))
    if not isinstance(payload, dict):
        return None
    if payload.get("signature") != signature:
        return None
    return record_from_cache_payload(path, payload)


def apply_session_index(record: SessionRecord, index: dict[str, dict[str, str]]) -> None:
    if record.id not in index:
        return
    record.thread_name = index[record.id].get("thread_name", record.thread_name)
    record.updated_at = index[record.id].get("updated_at", record.updated_at)


def find_workspace_sessions(
    codex_root: Path,
    workspace_path: Path,
    cache_path: Path | None = None,
) -> tuple[list[SessionRecord], dict[str, int]]:
    index = read_session_index(codex_root)
    sessions_dir = codex_root / "sessions"
    if not sessions_dir.exists():
        return [], {"parsed": 0, "cache_hits": 0, "skipped": 0}

    cache_payload = load_json_file(cache_path) if cache_path else None
    cache_entries = {}
    if isinstance(cache_payload, dict) and cache_payload.get("version") == SESSION_CACHE_VERSION:
        raw_entries = cache_payload.get("sessions")
        if isinstance(raw_entries, dict):
            cache_entries = raw_entries

    next_cache_entries: dict[str, Any] = {}
    cache_stats = {"parsed": 0, "cache_hits": 0, "skipped": 0}
    sessions: list[SessionRecord] = []
    for path in sessions_dir.rglob("*.jsonl"):
        signature = file_signature(path)
        record = cached_record_for_path(path, cache_entries, signature)
        if record:
            cache_stats["cache_hits"] += 1
            apply_session_index(record, index)
        else:
            record = parse_session(path, index)
            cache_stats["parsed"] += 1
        if not record:
            cache_stats["skipped"] += 1
            continue
        next_cache_entries[str(path)] = record_to_cache_payload(record, signature)
        if not path_matches_workspace(record.cwd, workspace_path):
            continue
        sessions.append(record)

    sessions.sort(key=lambda item: item.updated_at or item.path.stat().st_mtime_ns.__str__())
    if cache_path:
        write_json(
            cache_path,
            {
                "version": SESSION_CACHE_VERSION,
                "updated_at_epoch_ms": int(time.time() * 1000),
                "sessions": next_cache_entries,
            },
        )
    return sessions, cache_stats


def render_session_markdown(record: SessionRecord, max_chars: int | None = None) -> str:
    lines = [
        f"# Codex Session: {record.thread_name or record.id}",
        "",
        f"- Session ID: `{record.id}`",
        f"- Updated: `{record.updated_at or 'unknown'}`",
        f"- Source file: `{record.path}`",
        f"- CWD: `{record.cwd or 'unknown'}`",
        f"- Originator: `{record.originator or 'unknown'}`",
        f"- Source: `{record.source or 'unknown'}`",
        "",
        "## Conversation",
        "",
    ]
    for message in record.messages:
        role = message["role"].title()
        timestamp = message.get("timestamp") or "unknown"
        text = str(message.get("text") or "").strip()
        lines.extend([f"### {role} - {timestamp}", "", text, ""])

    rendered = "\n".join(lines)
    if max_chars and len(rendered) > max_chars:
        head = rendered[: max_chars // 2]
        tail = rendered[-(max_chars // 2) :]
        return head.rstrip() + "\n\n[... transcript truncated in compact view ...]\n\n" + tail.lstrip()
    return rendered


def session_summary(record: SessionRecord) -> dict[str, Any]:
    user_messages = [m["text"] for m in record.messages if m["role"] == "user"]
    assistant_messages = [m["text"] for m in record.messages if m["role"] == "assistant"]
    return {
        "id": record.id,
        "thread_name": record.thread_name,
        "updated_at": record.updated_at,
        "cwd": record.cwd,
        "originator": record.originator,
        "source": record.source,
        "path": str(record.path),
        "message_count": len(record.messages),
        "user_message_count": len(user_messages),
        "assistant_message_count": len(assistant_messages),
        "latest_user_prompt": extract_last_prompt(user_messages),
        "last_substantive_user_prompt": extract_last_substantive_prompt(user_messages),
    }


def write_relay_transcript_views(output_dir: Path, workspace_path: Path, sessions: list[SessionRecord]) -> None:
    all_user_prompts = [
        message["text"]
        for session in sessions
        for message in session.messages
        if message["role"] == "user"
    ]
    prompt_headlines = dedupe_strings(
        [extract_memory_headline(prompt, max_chars=180) for prompt in all_user_prompts]
    )
    latest_session = sessions[-1] if sessions else None
    topic_matches = build_topic_matches(all_user_prompts[-16:])
    dominant_topic = topic_matches[0][0]["label"] if topic_matches else "No dominant topic detected"

    continuity_lines = [
        "# Codex Relay Continuity",
        "",
        "> Auto-generated from the live Codex mirror.",
        "> Treat it as sensitive repo transcript context; do not publish outside trusted repo channels.",
        "> Keep this compact. Use the relay transcript folder for deeper history.",
        "> Treat this as a startup bridge: current focus, user directives, open questions, and likely next steps.",
        "",
        f"- Last mirrored epoch ms: `{int(time.time() * 1000)}`",
        f"- Workspace: `{workspace_path}`",
        f"- Relay mirror: `{output_dir}`",
        f"- Mirrored sessions: `{len(sessions)}`",
        "",
        "## Current Focus",
        f"- Latest session: `{latest_session.thread_name or latest_session.id if latest_session else 'none'}`",
        f"- Latest prompt: `{extract_last_prompt(all_user_prompts)}`",
        f"- Last substantive prompt: `{extract_last_substantive_prompt(all_user_prompts)}`",
        f"- Dominant topic window: `{dominant_topic}`",
        "",
        "## Active Threads",
        *build_active_thread_bullets(all_user_prompts[-16:]),
        "",
        "## Recent User Directives",
        *build_recent_directive_bullets(all_user_prompts[-20:]),
        "",
        "## Open Questions",
        *build_open_question_bullets(all_user_prompts[-12:]),
        "",
        "## Likely Next Steps",
        *build_likely_next_step_bullets(all_user_prompts[-16:]),
        "",
        "## Recent Prompt Log",
        *format_bullets(prompt_headlines, limit=10, max_chars=180),
        "",
        "## Long-Term Sources",
        f"- `{output_dir / 'codex-continuity.md'}`",
        f"- `{output_dir / 'codex-session-live.md'}`",
        f"- `{output_dir / USER_TO_VALIDATOR_TRANSCRIPT_NAME}`",
        "",
    ]

    transcript_lines = [
        "# Codex Session Live",
        "",
        "> Auto-generated from the live Codex mirror.",
        "> Treat it as sensitive repo transcript context; do not publish outside trusted repo channels.",
        "> This is long-term transcript context for search and recall, not a startup preload file.",
        "",
        f"- Last mirrored epoch ms: `{int(time.time() * 1000)}`",
        f"- Workspace: `{workspace_path}`",
        f"- Relay mirror: `{output_dir}`",
        "",
        "## Global Prompt History",
        *format_bullets(prompt_headlines, max_chars=220),
        "",
    ]

    if latest_session:
        transcript_lines.extend(
            [
                "## Latest Session Transcript",
                "",
                render_session_markdown(latest_session, max_chars=MAX_TRANSCRIPT_CHARS),
                "",
            ]
        )

    continuity_path = output_dir / "codex-continuity.md"
    transcript_path = output_dir / "codex-session-live.md"
    write_text_if_changed(continuity_path, "\n".join(continuity_lines))
    snapshot_text = "\n".join(transcript_lines)
    write_text_if_changed(transcript_path, snapshot_text)


def mirror_once(output_dir: Path, codex_root: Path, workspace_path: Path) -> dict[str, Any]:
    sessions, cache_stats = find_workspace_sessions(
        codex_root,
        workspace_path,
        output_dir / "state" / "session-cache.json",
    )
    copy_if_exists(codex_root / "session_index.jsonl", output_dir / "raw" / "session_index.jsonl")

    raw_session_dir = output_dir / "raw" / "sessions"
    for session in sessions:
        relative = session.path.relative_to(codex_root / "sessions")
        copy_if_exists(session.path, raw_session_dir / relative)

    if sessions:
        latest = sessions[-1]
        legacy_latest_path = output_dir / "decoded" / "latest-session.md"
        if legacy_latest_path.exists():
            legacy_latest_path.unlink()
        legacy_decoded_user_to_validator_path = output_dir / "decoded" / USER_TO_VALIDATOR_TRANSCRIPT_NAME
        if legacy_decoded_user_to_validator_path.exists():
            legacy_decoded_user_to_validator_path.unlink()
        write_text_if_changed(
            output_dir / USER_TO_VALIDATOR_TRANSCRIPT_NAME,
            render_session_markdown(latest, max_chars=MAX_TRANSCRIPT_CHARS),
        )
    write_user_validator_calendar_archives(output_dir, sessions)

    write_relay_transcript_views(output_dir, workspace_path, sessions)

    metadata = {
        "mirrored_at_epoch_ms": int(time.time() * 1000),
        "codex_root": str(codex_root),
        "workspace_path": str(workspace_path),
        "output_dir": str(output_dir),
        "session_count": len(sessions),
        "cache_stats": cache_stats,
        "latest_session": session_summary(sessions[-1]) if sessions else None,
        "mirrored_files": [
            {
                "source": str(session.path),
                "destination": str(raw_session_dir / session.path.relative_to(codex_root / "sessions")),
                "exists": session.path.exists(),
            }
            for session in sessions
        ],
    }
    write_json(output_dir / "mirror-metadata.json", metadata)
    return metadata


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        codex_root = get_codex_root()
        workspace_path = Path(args.workspace).resolve()
        output_dir = Path(args.output).resolve()
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if args.interval <= 0:
        print("--interval must be > 0", file=sys.stderr)
        return 1

    def run() -> None:
        metadata = mirror_once(output_dir, codex_root, workspace_path)
        print(
            f"[codex_transcript_mirror] mirrored {metadata['session_count']} sessions "
            f"to {output_dir}",
            flush=True,
        )

    if args.watch:
        try:
            while True:
                run()
                time.sleep(args.interval)
        except KeyboardInterrupt:
            print("[codex_transcript_mirror] stopped", flush=True)
            return 0

    run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
