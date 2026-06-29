#!/usr/bin/env python3
"""
Cursor session transcript mirror for research-mode Consultant work.

This reads Cursor's per-session JSONL files from:

    %USERPROFILE%\\.cursor\\projects\\<project-slug>\\agent-transcripts\\<uuid>\\<uuid>.jsonl

and renders the newest session into readable Markdown under:

    agent-relay/roles/consultant/transcripts/live/decoded/latest-session.md

Tool calls and tool results are not stored in Cursor's JSONL transcript; text
turns are.
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Any

DEFAULT_INTERVAL_SECONDS = 10.0

SECRET_PATTERNS = [
    re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"ghp_[A-Za-z0-9]{20,}"),
    re.compile(r"gho_[A-Za-z0-9]{20,}"),
    re.compile(r"ghs_[A-Za-z0-9]{20,}"),
    re.compile(r"github_pat[A-Za-z0-9_]*"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
]


def redact_secrets(text: str) -> str:
    for pattern in SECRET_PATTERNS:
        text = pattern.sub("[REDACTED_SECRET]", text)
    return text


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Mirror Cursor per-session JSONL transcripts to Markdown.")
    parser.add_argument("--workspace", default=str(Path.cwd()),
                        help="Workspace path used to derive the Cursor project slug.")
    parser.add_argument("--project-dir", default=None,
                        help="Explicit path to the project's agent-transcripts folder.")
    parser.add_argument("--output", default=None,
                        help="Destination folder for mirrored markdown and raw copies.")
    parser.add_argument("--interval", type=float, default=DEFAULT_INTERVAL_SECONDS,
                        help="Polling interval in seconds when --watch is set.")
    parser.add_argument("--watch", action="store_true", help="Continuously mirror.")
    parser.add_argument("--all", action="store_true",
                        help="Mirror every session in the project. Default: newest only.")
    return parser


def project_slug(workspace_path: str) -> str:
    resolved = str(Path(workspace_path).resolve())
    drive, rest = os.path.splitdrive(resolved)
    drive = drive.replace(":", "").lower()
    rest = rest.replace("\\", "-").replace("/", "-")
    return re.sub(r"[^A-Za-z0-9._-]+", "-", f"{drive}{rest}").strip("-")


def candidate_workspace_paths(workspace_path: str) -> list[Path]:
    current = Path(workspace_path).resolve()
    return [current, *current.parents]


def resolve_agent_transcripts_dir(workspace_path: str, project_dir: str | None) -> Path:
    if project_dir:
        return Path(project_dir)
    user_home = Path(os.environ.get("USERPROFILE") or Path.home())
    projects_dir = user_home / ".cursor" / "projects"
    for candidate_workspace in candidate_workspace_paths(workspace_path):
        candidate = projects_dir / project_slug(str(candidate_workspace)) / "agent-transcripts"
        if candidate.exists():
            return candidate
    return projects_dir / project_slug(workspace_path) / "agent-transcripts"


def find_session_files(agent_dir: Path, newest_only: bool) -> list[Path]:
    if not agent_dir.exists():
        return []
    files = sorted(agent_dir.glob("**/*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    if newest_only and files:
        return [files[0]]
    return files


def parse_message_payload(message: Any) -> dict | None:
    if isinstance(message, dict):
        return message
    if not isinstance(message, str):
        return None
    try:
        return json.loads(message)
    except Exception:
        pass
    try:
        value = ast.literal_eval(message)
        return value if isinstance(value, dict) else None
    except Exception:
        return None


def extract_text(payload: dict | None) -> str:
    if not isinstance(payload, dict):
        return ""
    content = payload.get("content")
    parts: list[str] = []
    if isinstance(content, list):
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                parts.append(str(part.get("text", "")))
            elif isinstance(part, str):
                parts.append(part)
    elif isinstance(content, str):
        parts.append(content)
    return "\n".join(parts).strip()


def decode_session(jsonl_path: Path) -> tuple[str, dict[str, Any]]:
    lines = jsonl_path.read_text(encoding="utf-8", errors="replace").splitlines()
    turns: list[tuple[str, str]] = []
    n_user = n_assistant = 0

    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if not isinstance(obj, dict):
            continue
        role = obj.get("role")
        if role not in ("user", "assistant"):
            continue
        text = extract_text(parse_message_payload(obj.get("message")))
        if not text:
            continue
        if role == "user":
            n_user += 1
        else:
            n_assistant += 1
        turns.append((role, text))

    session_id = jsonl_path.stem
    mtime = datetime.fromtimestamp(jsonl_path.stat().st_mtime)
    markdown: list[str] = [
        f"# Cursor Session Transcript: `{session_id}`",
        "",
        "> Verbatim mirror of Cursor's per-session JSONL.",
        "> Tool calls and tool results are not stored in this JSONL by Cursor; text turns are.",
        "",
        f"- Source: `{jsonl_path}`",
        f"- Last updated: `{mtime.isoformat()}`",
        f"- Turns: {len(turns)} (user: {n_user}, assistant: {n_assistant})",
        "",
        "---",
        "",
    ]

    for role, text in turns:
        label = "User" if role == "user" else "Assistant"
        markdown.extend([f"## {label}", "", text, "", "---", ""])

    stats = {
        "session_id": session_id,
        "source": str(jsonl_path),
        "turns": len(turns),
        "user_turns": n_user,
        "assistant_turns": n_assistant,
        "last_updated_epoch": jsonl_path.stat().st_mtime,
    }
    return redact_secrets("\n".join(markdown)), stats


def write_text_if_changed(path: Path, text: str) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        try:
            if path.read_text(encoding="utf-8") == text:
                return False
        except Exception:
            pass
    path.write_text(text, encoding="utf-8")
    return True


def mirror_once(agent_dir: Path, output_dir: Path, newest_only: bool) -> dict[str, Any]:
    decoded_dir = output_dir / "decoded"
    raw_dir = output_dir / "raw"
    files = find_session_files(agent_dir, newest_only)

    sessions: list[dict[str, Any]] = []
    newest_md_name: str | None = None
    for idx, jsonl_path in enumerate(files):
        try:
            markdown, stats = decode_session(jsonl_path)
        except Exception as exc:
            print(f"[cursor-session-mirror] failed decoding {jsonl_path}: {exc}", flush=True)
            continue

        md_name = f"{stats['session_id']}.md"
        write_text_if_changed(decoded_dir / md_name, markdown)
        try:
            raw_dest = raw_dir / f"{stats['session_id']}.jsonl"
            raw_dest.parent.mkdir(parents=True, exist_ok=True)
            raw_text = jsonl_path.read_text(encoding="utf-8", errors="replace")
            raw_dest.write_text(redact_secrets(raw_text), encoding="utf-8")
        except Exception:
            pass

        sessions.append(stats)
        if idx == 0:
            newest_md_name = md_name
            write_text_if_changed(decoded_dir / "latest-session.md", markdown)

    metadata = {
        "mirrored_at": datetime.now().isoformat(),
        "agent_transcripts_dir": str(agent_dir),
        "exists": agent_dir.exists(),
        "newest_only": newest_only,
        "newest_markdown": newest_md_name,
        "session_count": len(sessions),
        "sessions": sessions,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "mirror-metadata.json").write_text(
        json.dumps(metadata, indent=2, ensure_ascii=True), encoding="utf-8"
    )
    return metadata


def main() -> int:
    args = build_parser().parse_args()
    output_dir = Path(args.output).resolve() if args.output else (Path(__file__).resolve().parent / "live")
    agent_dir = resolve_agent_transcripts_dir(args.workspace, args.project_dir)

    if args.interval <= 0:
        print("--interval must be > 0")
        return 1

    def run() -> None:
        meta = mirror_once(agent_dir, output_dir, newest_only=not args.all)
        print(
            f"[cursor_session_mirror] {meta['session_count']} session(s) -> {output_dir} "
            f"(source: {agent_dir}, exists={meta['exists']})",
            flush=True,
        )

    if args.watch:
        try:
            while True:
                try:
                    run()
                except Exception as exc:
                    print(f"[cursor-session-mirror] cycle failed, continuing: {exc}", flush=True)
                time.sleep(args.interval)
        except KeyboardInterrupt:
            print("[cursor_session_mirror] stopped", flush=True)
            return 0

    run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
