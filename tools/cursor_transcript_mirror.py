#!/usr/bin/env python3
"""
Mirror Cursor chat storage into an offline folder.

This preserves the raw SQLite/WAL files Cursor uses and exports the
human-readable JSON fields we can decode locally.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse


DEFAULT_INTERVAL_SECONDS = 5.0

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
        "id": "cursor_continuity",
        "label": "Cursor transcript continuity",
        "summary": "offline mirroring of Cursor chat state and a compact startup memory layer",
        "next_step": "Keep the transcript mirror running and keep CURSOR_CONTINUITY.md compact enough for startup.",
        "keywords": (
            "cursor",
            "transcript",
            "chat log",
            "chat logs",
            "stored",
            "stream",
            "offline",
            "continuous memory",
            "memory",
            "mirror",
        ),
    },
    {
        "id": "execution_bridge",
        "label": "Execution bridge / live trading",
        "summary": "scan scheduling, live order attempts, tradability filters, targets, exits, and restart persistence",
        "next_step": "Verify the next forced or scheduled scan against the tradable universe and managed-position limits.",
        "keywords": (
            "execution",
            "bridge",
            "scan",
            "trade",
            "trades",
            "position",
            "positions",
            "alpaca",
            "take profit",
            "stop",
            "back testing",
            "backtesting",
            "pall",
            "server restart",
        ),
    },
    {
        "id": "scanner_copilot",
        "label": "Scanner copilot / fundamentals UX",
        "summary": "fundamentals-aware chat, composer layout changes, and trader-style AI answers",
        "next_step": "Validate that scanner copilot responses keep making direct trader calls instead of reverting to neutral summaries.",
        "keywords": (
            "scanner",
            "fundamental",
            "fundamentals",
            "chat bot",
            "chatbot",
            "copilot",
            "would you buy",
            "analysis",
            "opinion",
            "arrow inside",
            "follow up",
            "drop down menu",
        ),
    },
    {
        "id": "density_base_detector",
        "label": "Density base detector",
        "summary": "work tied to density_base_detector_v2 and candidate interpretation on the scanner page",
        "next_step": "Continue detector-specific review only if the user returns to density_base_detector_v2 behavior or scoring.",
        "keywords": (
            "density base",
            "density_base_detector",
            "bfly",
            "base",
            "breakout",
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
class StorageFile:
    source: Path
    destination_name: str
    copy_once: bool = False


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Mirror Cursor chat storage into an offline folder."
    )
    parser.add_argument(
        "--workspace",
        default=str(Path.cwd()),
        help="Workspace path to match against Cursor workspace storage.",
    )
    parser.add_argument(
        "--output",
        default=str(Path.cwd() / "offline-cursor-transcripts"),
        help="Destination folder for mirrored files and decoded JSON.",
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
        help="Continuously mirror Cursor storage.",
    )
    return parser


def get_cursor_root() -> Path:
    appdata = os.environ.get("APPDATA")
    if not appdata:
      raise RuntimeError("APPDATA is not set.")
    root = Path(appdata) / "Cursor"
    if not root.exists():
        raise RuntimeError(f"Cursor storage root not found: {root}")
    return root


def normalize_workspace_path(path: str) -> Path:
    return Path(path).resolve()


def load_workspace_storage_dir(cursor_root: Path, workspace_path: Path) -> Path | None:
    workspace_storage = cursor_root / "User" / "workspaceStorage"
    target_path = str(workspace_path).replace("/", "\\").lower()
    for workspace_dir in workspace_storage.iterdir():
        workspace_json = workspace_dir / "workspace.json"
        if not workspace_json.exists():
            continue
        try:
            payload = json.loads(workspace_json.read_text(encoding="utf-8"))
        except Exception:
            continue
        folder_uri = payload.get("folder")
        if not isinstance(folder_uri, str):
            continue
        parsed = urlparse(folder_uri)
        folder_path = unquote(parsed.path or "")
        if folder_path.startswith("/") and len(folder_path) > 2 and folder_path[2] == ":":
            folder_path = folder_path[1:]
        folder_path = folder_path.replace("/", "\\").lower()
        if folder_path == target_path:
            return workspace_dir
    return None


def copy_if_exists(source: Path, destination: Path, copy_once: bool = False) -> None:
    if not source.exists():
        return
    if copy_once and destination.exists():
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copy2(source, destination)
    except PermissionError:
        # Cursor may transiently lock sidecar files while rotating state.
        pass


def read_itemtable_value(db_path: Path, key: str) -> Any:
    if not db_path.exists():
        return None
    uri = f"file:{db_path.as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    try:
        cur = conn.cursor()
        row = cur.execute(
            "SELECT value FROM ItemTable WHERE key = ?",
            (key,),
        ).fetchone()
        if not row:
            return None
        value = row[0]
        if isinstance(value, bytes):
            value = value.decode("utf-8", errors="replace")
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return value
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return value
        return value
    finally:
        conn.close()


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")


def write_metadata(path: Path, payload: dict[str, Any]) -> None:
    write_json(path, payload)


def load_json_file(path: Path) -> Any:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


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
    noisy_markers = (
        "here's what i got",
        "i'm asking your opinion",
    )
    lowered = text.lower()
    for marker in noisy_markers:
        index = lowered.find(marker)
        if index > 0:
            text = text[:index].strip()
            lowered = text.lower()
    return shorten_text(text, max_chars=max_chars)


def format_bullets(
    items: list[str],
    limit: int | None = None,
    max_chars: int | None = None,
) -> list[str]:
    values = items if limit is None else items[-limit:]
    if not values:
        return ["- None captured yet"]
    return [f"- {shorten_text(value, max_chars=max_chars)}" for value in values]


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
    return [f"- {item}" for item in values[-5:]]


def build_open_question_bullets(prompts: list[str]) -> list[str]:
    open_questions: list[str] = []
    recent_prompts = prompts[-8:]
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


def write_memory_bank_views(output_dir: Path, workspace_path: Path) -> None:
    memory_bank_dir = workspace_path / "memory-bank"
    if not memory_bank_dir.exists():
        return

    global_payload = load_json_file(output_dir / "decoded" / "global-chat-state.json") or {}
    workspace_payload = load_json_file(output_dir / "decoded" / "workspace-chat-state.json") or {}
    metadata = load_json_file(output_dir / "mirror-metadata.json") or {}

    openai_chat = global_payload.get("openai.chatgpt") or {}
    atom_state = openai_chat.get("persisted-atom-state") or {}
    prompt_history = dedupe_strings(list(atom_state.get("prompt-history") or []))
    prompt_headlines = dedupe_strings(
        [extract_memory_headline(prompt, max_chars=180) for prompt in prompt_history]
    )

    workspace_prompts_raw = workspace_payload.get("aiService.prompts") or []
    workspace_prompts = dedupe_strings(
        [item.get("text", "") for item in workspace_prompts_raw if isinstance(item, dict)]
    )
    workspace_prompt_headlines = dedupe_strings(
        [extract_memory_headline(prompt, max_chars=150) for prompt in workspace_prompts]
    )

    generations_raw = workspace_payload.get("aiService.generations") or []
    generation_descriptions = dedupe_strings(
        [
            item.get("textDescription", "")
            for item in generations_raw
            if isinstance(item, dict)
        ]
    )
    generation_headlines = dedupe_strings(
        [extract_memory_headline(item, max_chars=150) for item in generation_descriptions]
    )

    composer_data = workspace_payload.get("composer.composerData") or {}
    all_composers = composer_data.get("allComposers") or []
    selected_ids = composer_data.get("selectedComposerIds") or []
    active_composers = [
        composer
        for composer in all_composers
        if isinstance(composer, dict) and composer.get("composerId") in selected_ids
    ] or [composer for composer in all_composers if isinstance(composer, dict)][:1]

    continuity_lines = [
        "# Cursor Continuity",
        "",
        "> Auto-generated from the live Cursor mirror.",
        "> Keep this compact. Use `memory-bank/transcripts/cursor-session-live.md` and the offline mirror for deeper history.",
        "> Treat this as a startup bridge: current focus, user directives, open questions, and likely next steps.",
        "",
        f"- Last mirrored epoch ms: `{metadata.get('mirrored_at_epoch_ms', 'unknown')}`",
        f"- Workspace: `{workspace_path}`",
        f"- Cursor workspace storage: `{metadata.get('workspace_storage_dir', 'unknown')}`",
        f"- Offline mirror: `{output_dir}`",
        "",
        "## Current Focus",
        f"- Latest prompt: `{extract_last_prompt(prompt_history)}`",
        f"- Last substantive prompt: `{extract_last_substantive_prompt(prompt_history)}`",
        f"- Dominant topic window: `{build_topic_matches(prompt_history[-12:])[0][0]['label'] if build_topic_matches(prompt_history[-12:]) else 'No dominant topic detected'}`",
        "",
        "## Active Threads",
        *build_active_thread_bullets(prompt_history[-16:]),
        "",
        "## Recent User Directives",
        *build_recent_directive_bullets(prompt_history[-16:]),
        "",
        "## Open Questions",
        *build_open_question_bullets(prompt_history[-12:]),
        "",
        "## Likely Next Steps",
        *build_likely_next_step_bullets(prompt_history[-16:]),
        "",
        "## Recent Workspace Prompt Log",
        *format_bullets(workspace_prompt_headlines, limit=6, max_chars=150),
        "",
        "## Recent Generation Descriptions",
        *format_bullets(generation_headlines, limit=6, max_chars=150),
        "",
        "## Active Composer",
    ]

    if active_composers:
        for composer in active_composers:
            continuity_lines.extend(
                [
                    f"- Name: `{composer.get('name', 'unnamed')}`",
                    f"- Mode: `{composer.get('unifiedMode', 'unknown')}` / force: `{composer.get('forceMode', 'unknown')}`",
                    f"- Subtitle: `{composer.get('subtitle', '')}`",
                    f"- Last updated: `{composer.get('lastUpdatedAt', 'unknown')}`",
                ]
            )
    else:
        continuity_lines.append("- No active composer found")

    continuity_lines.extend(
        [
            "",
            "## Long-Term Sources",
            f"- `memory-bank/transcripts/cursor-session-live.md`",
            f"- `{output_dir / 'decoded' / 'global-chat-state.json'}`",
            f"- `{output_dir / 'decoded' / 'workspace-chat-state.json'}`",
            "",
        ]
    )

    transcript_lines = [
        "# Cursor Session Live",
        "",
        "> Auto-generated from the live Cursor mirror.",
        "> This is long-term memory for search and recall, not a startup preload file.",
        "",
        f"- Last mirrored epoch ms: `{metadata.get('mirrored_at_epoch_ms', 'unknown')}`",
        f"- Workspace: `{workspace_path}`",
        f"- Offline mirror: `{output_dir}`",
        "",
        "## Global Prompt History",
        *format_bullets(prompt_headlines),
        "",
        "## Workspace Prompt Log",
        *format_bullets(workspace_prompt_headlines),
        "",
        "## Workspace Generation Descriptions",
        *format_bullets(generation_headlines),
        "",
    ]

    continuity_path = memory_bank_dir / "CURSOR_CONTINUITY.md"
    transcript_path = memory_bank_dir / "transcripts" / "cursor-session-live.md"
    continuity_path.write_text("\n".join(continuity_lines), encoding="utf-8")
    transcript_path.parent.mkdir(parents=True, exist_ok=True)
    transcript_path.write_text("\n".join(transcript_lines), encoding="utf-8")


def build_storage_files(cursor_root: Path, workspace_dir: Path | None) -> list[StorageFile]:
    files = [
        StorageFile(
            cursor_root / "User" / "globalStorage" / "state.vscdb",
            "raw/global/state.vscdb",
            copy_once=True,
        ),
        StorageFile(
            cursor_root / "User" / "globalStorage" / "state.vscdb-wal",
            "raw/global/state.vscdb-wal",
        ),
        StorageFile(
            cursor_root / "User" / "globalStorage" / "state.vscdb-shm",
            "raw/global/state.vscdb-shm",
        ),
    ]
    if workspace_dir:
        files.extend(
            [
                StorageFile(workspace_dir / "state.vscdb", "raw/workspace/state.vscdb"),
                StorageFile(
                    workspace_dir / "state.vscdb-wal", "raw/workspace/state.vscdb-wal"
                ),
                StorageFile(
                    workspace_dir / "state.vscdb-shm", "raw/workspace/state.vscdb-shm"
                ),
                StorageFile(workspace_dir / "workspace.json", "raw/workspace/workspace.json"),
            ]
        )
    return files


def export_decoded_views(output_dir: Path, workspace_dir: Path | None) -> None:
    global_db = output_dir / "raw" / "global" / "state.vscdb"
    global_payload = {
        "openai.chatgpt": read_itemtable_value(global_db, "openai.chatgpt"),
        "chat.workspaceTransfer": read_itemtable_value(global_db, "chat.workspaceTransfer"),
    }
    write_json(output_dir / "decoded" / "global-chat-state.json", global_payload)

    if workspace_dir:
        workspace_db = output_dir / "raw" / "workspace" / "state.vscdb"
        workspace_payload = {
            "composer.composerData": read_itemtable_value(workspace_db, "composer.composerData"),
            "aiService.prompts": read_itemtable_value(workspace_db, "aiService.prompts"),
            "aiService.generations": read_itemtable_value(workspace_db, "aiService.generations"),
            "workbench.backgroundComposer.workspacePersistentData": read_itemtable_value(
                workspace_db, "workbench.backgroundComposer.workspacePersistentData"
            ),
        }
        write_json(output_dir / "decoded" / "workspace-chat-state.json", workspace_payload)


def mirror_once(output_dir: Path, cursor_root: Path, workspace_path: Path) -> dict[str, Any]:
    workspace_dir = load_workspace_storage_dir(cursor_root, workspace_path)
    files = build_storage_files(cursor_root, workspace_dir)
    for file in files:
        copy_if_exists(
            file.source,
            output_dir / file.destination_name,
            copy_once=file.copy_once,
        )

    export_decoded_views(output_dir, workspace_dir)
    write_memory_bank_views(output_dir, workspace_path)

    metadata = {
        "mirrored_at_epoch_ms": int(time.time() * 1000),
        "cursor_root": str(cursor_root),
        "workspace_path": str(workspace_path),
        "workspace_storage_dir": str(workspace_dir) if workspace_dir else None,
        "mirrored_files": [
            {
                "source": str(file.source),
                "destination": str(output_dir / file.destination_name),
                "exists": file.source.exists(),
                "copy_once": file.copy_once,
            }
            for file in files
        ],
    }
    write_metadata(output_dir / "mirror-metadata.json", metadata)
    return metadata


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        cursor_root = get_cursor_root()
        workspace_path = normalize_workspace_path(args.workspace)
        output_dir = Path(args.output).resolve()
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if args.interval <= 0:
        print("--interval must be > 0", file=sys.stderr)
        return 1

    def run() -> None:
        metadata = mirror_once(output_dir, cursor_root, workspace_path)
        workspace_dir = metadata.get("workspace_storage_dir") or "<not found>"
        print(
            f"[cursor_transcript_mirror] mirrored to {output_dir} "
            f"(workspace storage: {workspace_dir})",
            flush=True,
        )

    if args.watch:
        try:
            while True:
                run()
                time.sleep(args.interval)
        except KeyboardInterrupt:
            print("[cursor_transcript_mirror] stopped", flush=True)
            return 0

    run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
