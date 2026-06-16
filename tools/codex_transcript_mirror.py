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
import re
import shutil
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


DEFAULT_INTERVAL_SECONDS = 30.0
MAX_TRANSCRIPT_CHARS = 240_000

QUESTION_PREFIXES = (
    "what",
    "why",
    "how",
    "when",
    "where",
    "which",
    "who",
    "can we",
    "could we",
    "do we",
    "does",
    "did",
    "is",
    "are",
    "will",
    "would",
    "should",
)

APPROVAL_PHRASES = {
    "yes",
    "yes please",
    "ok",
    "okay",
    "ok do that",
    "okay do that",
    "do that",
    "sounds good",
    "lets do that",
    "let's do that",
    "please do that",
    "nice",
    "update",
}

DIRECTIVE_PREFIXES = (
    "add ",
    "build ",
    "change ",
    "close ",
    "create ",
    "default ",
    "download ",
    "filter ",
    "fix ",
    "force ",
    "give ",
    "go ",
    "make ",
    "move ",
    "put ",
    "restart ",
    "run ",
    "set ",
    "show ",
    "stream ",
    "switch ",
    "take ",
    "update ",
    "use ",
)

TOPIC_DEFINITIONS = [
    {
        "id": "tri_agent_relay",
        "label": "Tri-agent relay and governance",
        "summary": "Validator, Builder, Editor roles, router records, contracts, and repo-local agent memory",
        "next_step": "Keep role handoffs in agent-relay and keep AGENTS.md pointing at the governing contracts.",
        "keywords": (
            "tri agent",
            "tri-agent",
            "validator",
            "builder",
            "editor",
            "agent relay",
            "router",
            "contract",
            "governance",
        ),
    },
    {
        "id": "codex_continuity",
        "label": "Codex transcript continuity",
        "summary": "offline mirroring of Codex session rollouts and compact startup memory",
        "next_step": "Keep the Codex transcript mirror running and use CODEX_CONTINUITY.md as the compact startup bridge.",
        "keywords": (
            "codex",
            "transcript",
            "conversation",
            "chat log",
            "memory",
            "mirror",
            "continuity",
            "session",
        ),
    },
    {
        "id": "backtest_contract",
        "label": "Backtest and research contract",
        "summary": "backtest engine routing, research study storage, and avoiding ad hoc backtest code",
        "next_step": "For future backtests, classify the request and store artifacts in the approved contract locations.",
        "keywords": (
            "backtest",
            "back test",
            "research study",
            "study framework",
            "engine",
            "sweep",
            "valuation",
        ),
    },
    {
        "id": "market_ai_trade",
        "label": "AI trade and market risk",
        "summary": "AI valuation, model progress risk, Nvidia/Marvell valuation, and market-cycle concerns",
        "next_step": "When market claims need numbers, verify live prices, earnings, and valuation ratios before analysis.",
        "keywords": (
            "ai revolution",
            "mythos",
            "fable",
            "anthropic",
            "nvidia",
            "marvell",
            "market",
            "valuation",
            "standard deviation",
        ),
    },
]

CUT_MARKERS = (
    "Based on the current analysis",
    "### Technical Analysis",
    "### Fundamental Analysis",
    "### Trade Considerations",
    "### Conclusion",
)


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
        default=str(Path.cwd() / "offline-codex-transcripts"),
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
    return str(Path(path).resolve()).replace("/", "\\").lower()


def normalize_text(value: str) -> str:
    return " ".join(str(value or "").replace("\r", "\n").split())


def shorten_text(value: str, max_chars: int | None = None) -> str:
    text = normalize_text(value)
    if max_chars is None or len(text) <= max_chars:
        return text
    return text[: max_chars - 3].rstrip() + "..."


def extract_memory_headline(value: str, max_chars: int = 180) -> str:
    raw_text = str(value or "")
    lines = [line.strip() for line in raw_text.replace("\r", "\n").split("\n") if line.strip()]
    text = lines[0] if lines else ""
    if len(text) < 24 and len(lines) > 1:
        text = " ".join(lines[:2])
    text = normalize_text(text)
    lower_text = text.lower()
    for marker in CUT_MARKERS:
        index = lower_text.find(marker.lower())
        if index > 0:
            text = text[:index].strip()
            break
    return shorten_text(text, max_chars=max_chars)


def sanitize_filename(value: str, fallback: str) -> str:
    text = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip("-")
    return text[:120] or fallback


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


def copy_if_exists(source: Path, destination: Path) -> None:
    if not source.exists():
        return
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


def find_workspace_sessions(codex_root: Path, workspace_path: Path) -> list[SessionRecord]:
    index = read_session_index(codex_root)
    sessions_dir = codex_root / "sessions"
    if not sessions_dir.exists():
        return []

    target = normalize_path_text(workspace_path)
    sessions: list[SessionRecord] = []
    for path in sessions_dir.rglob("*.jsonl"):
        record = parse_session(path, index)
        if not record:
            continue
        if record.cwd and normalize_path_text(record.cwd) != target:
            continue
        sessions.append(record)

    sessions.sort(key=lambda item: item.updated_at or item.path.stat().st_mtime_ns.__str__())
    return sessions


def is_question_prompt(text: str) -> bool:
    normalized = normalize_text(text).lower()
    if not normalized:
        return False
    if "?" in str(text):
        return True
    return any(normalized.startswith(prefix) for prefix in QUESTION_PREFIXES)


def is_approval_prompt(text: str) -> bool:
    normalized = normalize_text(text).lower()
    return normalized in APPROVAL_PHRASES


def is_directive_prompt(text: str) -> bool:
    normalized = normalize_text(text).lower()
    if not normalized or is_question_prompt(normalized) or is_approval_prompt(normalized):
        return False
    if "i want" in normalized or "we need to" in normalized or "let's " in normalized:
        return True
    return any(normalized.startswith(prefix) for prefix in DIRECTIVE_PREFIXES)


def score_topic(prompt: str, topic: dict[str, Any]) -> int:
    normalized = normalize_text(prompt).lower()
    return sum(1 for keyword in topic["keywords"] if keyword in normalized)


def classify_prompt_topic(prompt: str) -> dict[str, Any] | None:
    best_topic: dict[str, Any] | None = None
    best_score = 0
    for topic in TOPIC_DEFINITIONS:
        score = score_topic(prompt, topic)
        if score > best_score:
            best_score = score
            best_topic = topic
    return best_topic


def dedupe_strings(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        value = str(item or "").strip()
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def build_topic_matches(prompts: list[str]) -> list[tuple[dict[str, Any], list[str]]]:
    topic_matches: dict[str, list[str]] = {topic["id"]: [] for topic in TOPIC_DEFINITIONS}
    for prompt in prompts:
        topic = classify_prompt_topic(prompt)
        if not topic:
            continue
        topic_matches[topic["id"]].append(extract_memory_headline(prompt, max_chars=120))

    ordered: list[tuple[dict[str, Any], list[str]]] = []
    for topic in TOPIC_DEFINITIONS:
        matches = dedupe_strings(topic_matches[topic["id"]])
        if matches:
            ordered.append((topic, matches))
    ordered.sort(key=lambda item: len(item[1]), reverse=True)
    return ordered


def format_bullets(items: list[str], limit: int | None = None, max_chars: int | None = None) -> list[str]:
    values = items if limit is None else items[-limit:]
    if not values:
        return ["- None captured yet"]
    return [f"- {shorten_text(value, max_chars=max_chars)}" for value in values]


def build_active_thread_bullets(prompts: list[str]) -> list[str]:
    threads = build_topic_matches(prompts)
    if not threads:
        return ["- No dominant thread detected yet"]
    bullets: list[str] = []
    for topic, matches in threads[:3]:
        recent_examples = "; ".join(f"`{item}`" for item in matches[-2:])
        bullets.append(
            f"- {topic['label']}: {topic['summary']}. Recent prompts: {recent_examples}"
        )
    return bullets


def build_recent_directive_bullets(prompts: list[str]) -> list[str]:
    directives = [
        extract_memory_headline(prompt, max_chars=150)
        for prompt in prompts
        if is_directive_prompt(prompt)
    ]
    values = dedupe_strings(directives)
    if not values:
        return ["- No strong user directives captured yet"]
    return [f"- {item}" for item in values[-6:]]


def build_open_question_bullets(prompts: list[str]) -> list[str]:
    open_questions: list[str] = []
    recent_prompts = prompts[-10:]
    for index, prompt in enumerate(recent_prompts):
        if not is_question_prompt(prompt):
            continue
        trailing_prompts = recent_prompts[index + 1 :]
        if any(is_approval_prompt(item) or is_directive_prompt(item) for item in trailing_prompts):
            continue
        open_questions.append(extract_memory_headline(prompt, max_chars=150))
    values = dedupe_strings(open_questions)
    if not values:
        return ["- No unresolved question detected in the latest prompt window"]
    return [f"- {item}" for item in values[-3:]]


def build_likely_next_step_bullets(prompts: list[str]) -> list[str]:
    threads = build_topic_matches(prompts)
    next_steps = dedupe_strings([topic["next_step"] for topic, _matches in threads[:3]])
    next_steps.append(
        "Use the long-term transcript files only for targeted recall; do not preload them into startup context."
    )
    return [f"- {item}" for item in next_steps[:4]]


def extract_last_substantive_prompt(prompts: list[str]) -> str:
    for prompt in reversed(prompts):
        if is_approval_prompt(prompt):
            continue
        headline = extract_memory_headline(prompt, max_chars=160)
        if headline:
            return headline
    return "No recent substantive prompt captured"


def extract_last_prompt(prompts: list[str]) -> str:
    if not prompts:
        return "No recent prompt captured"
    return extract_memory_headline(prompts[-1], max_chars=120)


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


def write_memory_bank_views(output_dir: Path, workspace_path: Path, sessions: list[SessionRecord]) -> None:
    memory_bank_dir = workspace_path / "memory-bank"
    if not memory_bank_dir.exists():
        return

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
        "# Codex Continuity",
        "",
        "> Auto-generated from the live Codex mirror.",
        "> Tracking policy: this compact continuity file is intentionally git-trackable for catastrophic recovery.",
        "> Treat it as sensitive repo memory; do not publish outside trusted repo channels.",
        "> Keep this compact. Use `memory-bank/transcripts/codex-session-live.md` and the offline mirror for deeper history.",
        "> Treat this as a startup bridge: current focus, user directives, open questions, and likely next steps.",
        "",
        f"- Last mirrored epoch ms: `{int(time.time() * 1000)}`",
        f"- Workspace: `{workspace_path}`",
        f"- Offline mirror: `{output_dir}`",
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
        "- `memory-bank/transcripts/codex-session-live.md`",
        f"- `{output_dir / 'decoded' / 'sessions-summary.json'}`",
        f"- `{output_dir / 'decoded' / 'latest-session.md'}`",
        "",
    ]

    transcript_lines = [
        "# Codex Session Live",
        "",
        "> Auto-generated from the live Codex mirror.",
        "> Tracking policy: this compact transcript view is intentionally git-trackable for catastrophic recovery.",
        "> Treat it as sensitive repo memory; do not publish outside trusted repo channels.",
        "> This is long-term memory for search and recall, not a startup preload file.",
        "",
        f"- Last mirrored epoch ms: `{int(time.time() * 1000)}`",
        f"- Workspace: `{workspace_path}`",
        f"- Offline mirror: `{output_dir}`",
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

    continuity_path = memory_bank_dir / "CODEX_CONTINUITY.md"
    transcript_path = memory_bank_dir / "transcripts" / "codex-session-live.md"
    continuity_path.write_text("\n".join(continuity_lines), encoding="utf-8")
    transcript_path.parent.mkdir(parents=True, exist_ok=True)
    transcript_path.write_text("\n".join(transcript_lines), encoding="utf-8")


def mirror_once(output_dir: Path, codex_root: Path, workspace_path: Path) -> dict[str, Any]:
    sessions = find_workspace_sessions(codex_root, workspace_path)
    copy_if_exists(codex_root / "session_index.jsonl", output_dir / "raw" / "session_index.jsonl")

    raw_session_dir = output_dir / "raw" / "sessions"
    decoded_session_dir = output_dir / "decoded" / "sessions"
    decoded_session_dir.mkdir(parents=True, exist_ok=True)
    for session in sessions:
        relative = session.path.relative_to(codex_root / "sessions")
        copy_if_exists(session.path, raw_session_dir / relative)
        name = sanitize_filename(f"{session.updated_at}-{session.thread_name or session.id}", session.id)
        (decoded_session_dir / f"{name}.md").write_text(
            render_session_markdown(session),
            encoding="utf-8",
        )

    summaries = [session_summary(session) for session in sessions]
    write_json(output_dir / "decoded" / "sessions-summary.json", summaries)
    if sessions:
        latest = sessions[-1]
        (output_dir / "decoded" / "latest-session.md").write_text(
            render_session_markdown(latest, max_chars=MAX_TRANSCRIPT_CHARS),
            encoding="utf-8",
        )

    write_memory_bank_views(output_dir, workspace_path, sessions)

    metadata = {
        "mirrored_at_epoch_ms": int(time.time() * 1000),
        "codex_root": str(codex_root),
        "workspace_path": str(workspace_path),
        "output_dir": str(output_dir),
        "session_count": len(sessions),
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
