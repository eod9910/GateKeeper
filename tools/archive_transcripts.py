#!/usr/bin/env python3
"""
Manual, on-demand transcript archival mover for the 30-day hot window policy.

This script performs BOTH rollovers described in
`memory-bank/MEMORY_ARCHIVE_POLICY.md` in a single command:

1. Snapshot day-folders: it finds
   `memory-bank/transcripts/<agent>/YYYY-MM-DD/` folders (`<agent>` in
   `codex`, `cursor`) older than the 30-day hot window (relative to today's
   date) and MOVES them into
   `memory-bank/transcripts/<agent>/archive/YYYY-MM/YYYY-MM-DD/`.
2. Relay timeline: it drives the Phase 2 relay rollover by calling
   `agent_router.regenerate_relay_timeline()`, which rebuilds the windowed hot
   `agent-relay/transcripts/all.md` plus the tracked monthly archive files
   `agent-relay/transcripts/archive/all-YYYY-MM.md` deterministically from the
   immutable `agent-relay/router/routes.jsonl`.

Safety contract (intentionally conservative):

- Defaults to `--dry-run`: nothing on disk is mutated except the affected-path
  report. Pass `--apply` to actually move folders and regenerate the relay
  timeline.
- It is a MOVE, never a delete. The only files removed are exact duplicates that
  are already present, byte-for-byte identical, at the destination (which only
  happens when reconciling a previously interrupted run); the data always
  survives at the destination.
- It is idempotent and safe to re-run on Windows/OneDrive paths: pre-existing
  destination folders are handled by merging file-by-file, and conflicting files
  are left in place and reported rather than clobbered.
- It is NOT run automatically at mirror or router startup. Any real `--apply`
  run is a destructive-ish path change and must go through the Destructive
  Cleanup Gate in `memory-bank/MEMORY_ARCHIVE_POLICY.md`.
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import List, Optional, Tuple


TOOLS_DIR = Path(__file__).resolve().parent
ROOT = TOOLS_DIR.parent
TRANSCRIPTS_DIR = ROOT / "memory-bank" / "transcripts"
AGENTS = ("codex", "cursor")
HOT_WINDOW_DAYS = 30
REPORT_PATH = (
    ROOT
    / "agent-relay"
    / "roles"
    / "Builder"
    / "reports"
    / "2026-06-17-transcript-archival-dryrun-report.md"
)

# Import the router so one command also performs the relay timeline rollover.
# The import has no side effects (it only defines constants and functions).
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))
import agent_router  # noqa: E402

DATE_FOLDER_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")

# Reuse the router's identical helpers so there is a single source of truth for
# UTC timestamps and repo-relative path rendering (both files share the same
# repo ROOT, so output is unchanged).
utc_now = agent_router.utc_now
rel = agent_router.rel


def parse_day_folder(name: str) -> Optional[date]:
    """Return the date for a `YYYY-MM-DD` folder name, or None if it is not one.

    This deliberately rejects the `archive` subfolder and any other non-date
    directory so the mover never recurses into already-archived content.
    """
    match = DATE_FOLDER_RE.match(name)
    if not match:
        return None
    try:
        return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return None


@dataclass
class FileAction:
    source: Path
    dest: Path
    status: str  # move-folder | merge-move | dup-skip | conflict-keep-source


@dataclass
class PlannedMove:
    agent: str
    folder_date: date
    age_days: int
    source: Path
    dest: Path
    dest_preexisting: bool = False
    file_actions: List[FileAction] = field(default_factory=list)
    conflicts: List[Tuple[Path, Path]] = field(default_factory=list)
    source_emptied: bool = False
    note: str = ""


def plan_moves(today: date) -> List[PlannedMove]:
    """Find day-folders older than the hot window, grouped per agent.

    Eligibility is computed relative to today's date (per the snapshot-archival
    rule in MEMORY_ARCHIVE_POLICY.md): a `YYYY-MM-DD` folder is eligible when it
    is strictly older than HOT_WINDOW_DAYS days.
    """
    moves: List[PlannedMove] = []
    for agent in AGENTS:
        agent_dir = TRANSCRIPTS_DIR / agent
        if not agent_dir.is_dir():
            continue
        for child in sorted(agent_dir.iterdir()):
            if not child.is_dir() or child.name == "archive":
                continue
            folder_date = parse_day_folder(child.name)
            if folder_date is None:
                continue
            age_days = (today - folder_date).days
            if age_days <= HOT_WINDOW_DAYS:
                continue
            month_key = folder_date.strftime("%Y-%m")
            dest = agent_dir / "archive" / month_key / child.name
            moves.append(
                PlannedMove(
                    agent=agent,
                    folder_date=folder_date,
                    age_days=age_days,
                    source=child,
                    dest=dest,
                    dest_preexisting=dest.exists(),
                )
            )
    return moves


def files_identical(a: Path, b: Path) -> bool:
    try:
        return a.read_bytes() == b.read_bytes()
    except OSError:
        return False


def remove_empty_dirs(root: Path) -> bool:
    """Remove empty directories bottom-up. Returns True if `root` was removed.

    Only empty container directories are removed; no files are ever deleted by
    this function, so it does not violate the move-only contract.
    """
    if not root.is_dir():
        return False
    for child in sorted(root.iterdir()):
        if child.is_dir():
            remove_empty_dirs(child)
    try:
        next(root.iterdir())
        return False  # not empty
    except StopIteration:
        try:
            root.rmdir()
            return True
        except OSError:
            return False


def reconcile_move(move: PlannedMove, apply: bool) -> None:
    """Plan (and optionally apply) a single day-folder move.

    Three cases, all idempotent and lossless:
      * source missing  -> already archived, no-op.
      * dest missing     -> move the whole folder.
      * dest present     -> merge file-by-file (a previously interrupted run);
                            identical files are de-duplicated, differing files
                            are kept in source and reported as conflicts.
    """
    src = move.source
    dest = move.dest

    if not src.exists():
        move.note = "source already archived (no-op)"
        return

    if not dest.exists():
        move.file_actions.append(FileAction(src, dest, "move-folder"))
        if apply:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dest))
            move.source_emptied = True
        return

    # Destination already exists: reconcile file-by-file without clobbering.
    move.note = "destination already exists; merging file-by-file"
    for item in sorted(src.rglob("*")):
        if item.is_dir():
            continue
        relpath = item.relative_to(src)
        target = dest / relpath
        if target.exists():
            if files_identical(item, target):
                move.file_actions.append(FileAction(item, target, "dup-skip"))
                if apply:
                    # Exact duplicate already present at destination; removing the
                    # redundant source copy completes the move without data loss.
                    item.unlink()
            else:
                move.file_actions.append(FileAction(item, target, "conflict-keep-source"))
                move.conflicts.append((item, target))
        else:
            move.file_actions.append(FileAction(item, target, "merge-move"))
            if apply:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(item), str(target))

    if apply and not move.conflicts:
        move.source_emptied = remove_empty_dirs(src)


def run_relay_rollover(apply: bool) -> str:
    """Drive the Phase 2 relay timeline rollover via agent_router.

    Regeneration is a non-destructive, idempotent rebuild of derived views from
    the immutable routes.jsonl, so it only runs under --apply to keep dry-run
    side-effect free (aside from this report).
    """
    if apply:
        path = agent_router.regenerate_relay_timeline()
        return f"regenerated {rel(path)} + monthly archive files"
    return (
        "would regenerate agent-relay/transcripts/all.md + "
        "agent-relay/transcripts/archive/all-YYYY-MM.md "
        "(derived from routes.jsonl, non-destructive)"
    )


def build_report(
    moves: List[PlannedMove],
    relay_note: str,
    today: date,
    apply: bool,
) -> str:
    mode = "APPLY" if apply else "DRY-RUN"
    lines = [
        "# Transcript Archival Report",
        "",
        f"- Generated: {utc_now()}",
        f"- Mode: {mode}",
        f"- Today: {today.isoformat()}",
        f"- Hot window: {HOT_WINDOW_DAYS} days "
        f"(folders older than this are archived)",
        "",
        "## Relay timeline rollover",
        "",
        f"- {relay_note}",
        "",
        "## Snapshot day-folder moves",
        "",
    ]

    if not moves:
        lines.append("No day-folders are older than the hot window. Nothing to move.")
        lines.append("")
    for move in moves:
        lines.append(
            f"### {move.agent}/{move.source.name} "
            f"(age {move.age_days}d) -> {move.agent}/archive/"
            f"{move.folder_date.strftime('%Y-%m')}/{move.source.name}"
        )
        lines.append("")
        lines.append(f"- Source: `{rel(move.source)}`")
        lines.append(f"- Destination: `{rel(move.dest)}`")
        lines.append(f"- Destination pre-existing: `{move.dest_preexisting}`")
        if move.note:
            lines.append(f"- Note: {move.note}")
        if move.file_actions:
            lines.append("- File actions:")
            for action in move.file_actions:
                lines.append(
                    f"    - `{rel(action.source)}` -> `{rel(action.dest)}` "
                    f"[{action.status}]"
                )
        if move.conflicts:
            lines.append("- Conflicts (left in source, NOT overwritten):")
            for src_file, dest_file in move.conflicts:
                lines.append(
                    f"    - `{rel(src_file)}` differs from `{rel(dest_file)}`"
                )
        lines.append(f"- Source emptied/removed: `{move.source_emptied}`")
        lines.append("")

    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Archive transcript day-folders older than the 30-day hot window and "
            "roll over the relay timeline. Defaults to a safe dry-run."
        )
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply changes (move folders, regenerate relay timeline). "
        "Without this flag the script is a dry-run.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Explicit dry-run (default behavior). Overridden by nothing; if "
        "both --apply and --dry-run are given, --dry-run wins for safety.",
    )
    parser.add_argument(
        "--report",
        default=None,
        help="Override the report output path (default: the Builder report).",
    )
    parser.add_argument(
        "--today",
        default=None,
        help="Override 'today' as YYYY-MM-DD (testing only).",
    )
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    # Dry-run is the default and wins any ambiguity, so an accidental --apply is
    # never destructive when --dry-run is also present.
    apply = bool(args.apply) and not args.dry_run

    if args.today:
        try:
            today = datetime.strptime(args.today, "%Y-%m-%d").date()
        except ValueError:
            print(f"invalid --today value: {args.today}", file=sys.stderr)
            return 2
    else:
        today = date.today()

    moves = plan_moves(today)
    for move in moves:
        reconcile_move(move, apply)

    relay_note = run_relay_rollover(apply)
    report = build_report(moves, relay_note, today, apply)

    report_path = Path(args.report).resolve() if args.report else REPORT_PATH
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(report, encoding="utf-8")

    print(report)
    print(f"\n[archive_transcripts] mode={'APPLY' if apply else 'DRY-RUN'} "
          f"report written to {rel(report_path)}")
    if not apply:
        print("[archive_transcripts] no files moved (dry-run). Re-run with --apply "
              "under the Destructive Cleanup Gate to perform the archival.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
