# Agent Memory Bootstrap Implementation Guide

This guide tells Codex how to implement the Pattern Detector-style agent memory
bootstrap in another repository.

The goal is simple: every new agent instance should immediately recover the
repo's operating rules, compact continuity memory, and recent transcript window,
while a background mirror keeps those memory files current.

For the exact Agent Relay workflow that generates
`agent-relay/transcripts/all.md`, also read:

```text
agent-memory-bootstrap/ROUTER_WORKFLOW.md
```

## 1. Target Behavior

When a new agent starts in the repo, it should:

1. Read the repo's governing agent contract first.
2. Read `AGENTS.md` as the startup router.
3. Ensure the transcript mirror process is running.
4. Read the memory policy.
5. Read the compact continuity file.
6. Read the recent transcript window.
7. Read only the task-specific contract needed for the user's request.

The agent should not preload large historical transcript archives. Historical
transcripts should be searched or opened only for targeted recall.

## 2. Required Files And Folders

Create or adapt these files in the target repo:

```text
AGENTS.md
memory-bank/
  CODEX_MEMORY_POLICY.md
  CODEX_CONTINUITY.md
  transcripts/
    codex-session-live.md
    codex/
      YYYY-MM-DD/
        latest.md
tools/
  codex_transcript_mirror.py
  start_codex_transcript_mirror.ps1
  stop_codex_transcript_mirror.ps1
offline-codex-transcripts-live/      # generated, local-only, gitignored
```

If the repo uses a role contract, also include it near the top of startup:

```text
TRI_AGENT_CODING_CONTRACT.md
ROUTER_ONLY_PROTOCOL.md              # optional, only if using relay routing
agent-relay/                         # optional, only if using relay routing
```

## 3. Tracking Policy

Add this gitignore rule in the target repo:

```gitignore
offline-codex-transcripts-*/
```

Recommended tracking split:

- Track `memory-bank/CODEX_MEMORY_POLICY.md`.
- Track `memory-bank/CODEX_CONTINUITY.md` if the repo wants catastrophic
  recovery of recent agent context.
- Track `memory-bank/transcripts/codex-session-live.md` and dated `latest.md`
  files only if the repo accepts that they contain sensitive conversation
  memory.
- Never track `offline-codex-transcripts-live/`; it is raw local mirror output.

Treat tracked memory files as sensitive repo memory. Do not publish them outside
trusted repo channels unless the repo owner explicitly approves that.

## 4. Mirror Scripts

This bootstrap package includes portable copies of the transcript recording
scripts under:

```text
agent-memory-bootstrap/templates/tools/
```

Copy these files into the target repo's `tools/` folder:

```text
tools/codex_transcript_memory.py
tools/codex_transcript_mirror.py
tools/start_codex_transcript_mirror.ps1
tools/stop_codex_transcript_mirror.ps1
```

Source files in this package:

```text
agent-memory-bootstrap/templates/tools/codex_transcript_memory.py
agent-memory-bootstrap/templates/tools/codex_transcript_mirror.py
agent-memory-bootstrap/templates/tools/start_codex_transcript_mirror.ps1
agent-memory-bootstrap/templates/tools/stop_codex_transcript_mirror.ps1
```

The start script must be idempotent. It should:

1. Resolve the repo root.
2. Use `offline-codex-transcripts-live/mirror.pid`.
3. Check whether that PID is already running.
4. Exit cleanly if the mirror is already running.
5. Start the Python mirror in watch mode if it is not running.
6. Redirect logs to:

```text
offline-codex-transcripts-live/mirror.out.log
offline-codex-transcripts-live/mirror.err.log
```

Pattern Detector's startup command is:

```powershell
.\tools\start_codex_transcript_mirror.ps1
```

The underlying watcher command should be equivalent to:

```powershell
python tools\codex_transcript_mirror.py --watch --workspace <repo-root> --output offline-codex-transcripts-live --interval 30
```

## 5. Recording Transcript Memory

After copying the scripts into the target repo, run one one-shot recording pass
from the repo root:

```powershell
python tools\codex_transcript_mirror.py --workspace . --output offline-codex-transcripts-live
```

That command reads matching Codex session rollout files from `~/.codex/sessions`
and writes the repo-local transcript memory outputs once.

To continuously record transcript memory, start the watcher:

```powershell
.\tools\start_codex_transcript_mirror.ps1
```

To stop continuous recording:

```powershell
.\tools\stop_codex_transcript_mirror.ps1
```

The scripts generate and refresh:

```text
offline-codex-transcripts-live/decoded/latest-session.md
offline-codex-transcripts-live/decoded/sessions-summary.json
memory-bank/CODEX_CONTINUITY.md
memory-bank/transcripts/codex-session-live.md
memory-bank/transcripts/codex/YYYY-MM-DD/latest.md
memory-bank/transcripts/codex/YYYY-MM-DD/YYYY-MM-DD-HHMMSS-<thread-or-session>.md
```

Use the one-shot command when installing or debugging. Use the PowerShell start
script for normal agent startup because it checks whether the watcher is already
running before starting a new process.

## 6. AGENTS.md Startup Block

Add a startup read order near the top of `AGENTS.md`.

Template:

```markdown
## Startup Read Order

When a new agent instance starts work in this repo, read in this order:

1. `TRI_AGENT_CODING_CONTRACT.md` - if this repo uses tri-agent governance.
2. `AGENTS.md` - routes the agent to the correct repo contracts, policies, and folders for the task.
3. `memory-bank/CODEX_MEMORY_POLICY.md` - explains which memory files are active, trackable, local-only, or read-on-demand.
4. `memory-bank/CODEX_CONTINUITY.md` - compact current-state bridge for recent goals, directives, open questions, and likely next steps.
5. Recent transcript window - use `memory-bank/transcripts/codex-session-live.md`, then `memory-bank/transcripts/codex/YYYY-MM-DD/latest.md` for today and the prior one or two days when present.
6. Task-specific contract - read the relevant file based on the user request.

Do not preload large historical transcript archives by default. Search or open them only for targeted recall.
```

Then add the mirror startup block immediately after the read order:

````markdown
## Codex Transcript Mirror Startup

Immediately after reading this file, ensure the Codex transcript mirror is
running. Use the idempotent launcher below; it checks for an existing PID and
starts the watcher only when it is not already running:

```powershell
.\tools\start_codex_transcript_mirror.ps1
```

The mirror keeps `memory-bank/CODEX_CONTINUITY.md`,
`memory-bank/transcripts/codex-session-live.md`, and the dated latest transcript
window current for future agent startup continuity.
````

If the target repo does not use `TRI_AGENT_CODING_CONTRACT.md`, replace item 1
with the repo's actual operating contract, or remove that item and make
`AGENTS.md` the first required read.

## 7. Memory Policy File

Create `memory-bank/CODEX_MEMORY_POLICY.md` with these decisions:

- Which generated memory files are trackable.
- Which raw mirror folders are local-only.
- Where live and dated transcript windows live.
- That tracked memory is sensitive.
- That raw offline mirrors must not be committed.
- That historical transcript archives are read-on-demand, not startup-loaded.

Keep this policy short. `AGENTS.md` should route to it; it should not duplicate
all retention details.

## 8. Continuity File

The mirror should write `memory-bank/CODEX_CONTINUITY.md` as a compact startup
bridge. It should include:

- current workspace path;
- latest mirrored session;
- current focus;
- active threads;
- recent user directives;
- open questions;
- likely next steps;
- links to live transcript sources.

This file is the agent's first memory read after policy. It should be compact
enough to load at startup.

## 9. Recent Transcript Window

The mirror should maintain:

```text
memory-bank/transcripts/codex-session-live.md
memory-bank/transcripts/codex/YYYY-MM-DD/latest.md
```

Agents should read the live file first, then today's `latest.md`, then the
prior one or two days if present and relevant. Do not load all dated snapshots.

## 10. Verification Steps

After installing the system in a target repo, run:

```powershell
python tools\codex_transcript_mirror.py --workspace . --output offline-codex-transcripts-live
```

Expected one-shot result:

- `offline-codex-transcripts-live/decoded/latest-session.md` exists when a
  matching session is found.
- `memory-bank/CODEX_CONTINUITY.md` exists.
- `memory-bank/transcripts/codex-session-live.md` exists.

Then run:

```powershell
.\tools\start_codex_transcript_mirror.ps1
```

Expected results:

- If not running, it starts the mirror and prints a PID.
- If already running, it prints that the mirror is already running.
- `offline-codex-transcripts-live/mirror.pid` exists.
- `offline-codex-transcripts-live/mirror.out.log` shows successful mirror runs.
- `memory-bank/CODEX_CONTINUITY.md` updates.
- `memory-bank/transcripts/codex-session-live.md` updates.
- `memory-bank/transcripts/codex/YYYY-MM-DD/latest.md` exists for the current date.

Check git status:

```powershell
git status --short
```

Confirm raw mirror output is ignored:

```powershell
git status --short -- offline-codex-transcripts-live
```

That command should show no tracked raw mirror files.

## 11. Tri-Agent Integration

If the target repo uses Validator/Builder/Editor governance:

1. Validator owns the decision to change startup policy.
2. Validator writes a directive.
3. Builder edits `AGENTS.md` and reports what changed.
4. Editor reviews clarity, placement, duplication, and maintainability.
5. Validator accepts or rejects.

Ownership rule:

- Validator owns the meaning and obligations in `AGENTS.md`.
- Builder performs authorized document edits.
- Editor reviews structure and clarity.
- User/Mediator has final authority.

For repos without tri-agent governance, use the same practical split informally:
decide policy first, implement second, review third.

## 12. Portable Router Copy

If the target repo uses Tri-Agent governance, place this router at:

```text
tools/agent_router.py
```

It expects and creates this relay structure:

```text
agent-relay/
  messages/
  router/
    routes.jsonl
  roles/
    Builder/
    Validator/
    Editor/
    User/
    Router/
  exports/
  transcripts/
```

Core commands:

```powershell
python tools\agent_router.py routes
python tools\agent_router.py route --phase "phase-name" --source Validator --target Builder --type "EXECUTION DIRECTIVE" --title "Title" --body-file "path\to\body.md"
python tools\agent_router.py inbox --role Builder
python tools\agent_router.py verify
python tools\agent_router.py regenerate
python tools\agent_router.py transcript --phase "phase-name"
```

Run route commands one at a time. Do not route messages in parallel; the router
appends to a JSONL log and regenerates derived inbox/transcript views after each
route.

Copy this source into `tools/agent_router.py`:

```python
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
from typing import Dict, Iterable, List, Optional, Tuple


ROOT = Path(__file__).resolve().parents[1]
RELAY_DIR = ROOT / "agent-relay"
MESSAGES_DIR = RELAY_DIR / "messages"
ROLES_DIR = RELAY_DIR / "roles"
ROUTER_DIR = RELAY_DIR / "router"
EXPORTS_DIR = RELAY_DIR / "exports"
TRANSCRIPTS_DIR = RELAY_DIR / "transcripts"
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
    TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
    for role in ROLES:
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
    for role in ROLES:
        inbox_path = ROLES_DIR / role / "INBOX.md"
        inbox_path.write_text(render_inbox(role), encoding="utf-8")


def read_body(row: Dict[str, object]) -> str:
    body_path = ROOT / str(row["body_path"])
    return body_path.read_text(encoding="utf-8")


def render_transcript(rows: List[Dict[str, object]], title: str) -> str:
    lines = [f"# Agent Relay Transcript: {title}", "", f"Generated: {utc_now()}", ""]
    if not rows:
        lines.append("_No routed messages._")
        lines.append("")
        return "\n".join(lines)
    for index, row in enumerate(rows, start=1):
        lines.extend(
            [
                f"## {index}. {row['source']} -> {row['target']}: {row['title']}",
                "",
                f"- Routing ID: `{row['routing_id']}`",
                f"- Type: `{row['message_type']}`",
                f"- Phase: `{row['phase']}`",
                f"- Timestamp: `{row['timestamp']}`",
                f"- Original: `{row['original_body_path']}`",
                f"- Body: `{row['body_path']}`",
                f"- SHA-256: `{row['sha256']}`",
                "",
                read_body(row).rstrip(),
                "",
                "---",
                "",
            ]
        )
    return "\n".join(lines)


def write_phase_transcript(phase: str) -> Path:
    ensure_dirs()
    rows = [row for row in read_log() if row.get("phase") == phase]
    out = TRANSCRIPTS_DIR / f"{safe_slug(phase, 'phase')}.md"
    out.write_text(render_transcript(rows, phase), encoding="utf-8")
    return out


def regenerate_transcripts() -> None:
    ensure_dirs()
    rows = read_log()
    phases = sorted({str(row.get("phase", "unclassified")) for row in rows})
    for phase in phases:
        write_phase_transcript(phase)
    all_path = TRANSCRIPTS_DIR / "all.md"
    all_path.write_text(render_transcript(rows, "all"), encoding="utf-8")


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
    if args.role not in ROLES:
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
    route.add_argument("--source", required=True, choices=ROLES)
    route.add_argument("--target", required=True, choices=ROLES)
    route.add_argument("--type", required=True)
    route.add_argument("--title", required=True)
    route.add_argument("--body-file", required=True)
    route.set_defaults(func=route_message)

    inbox = sub.add_parser("inbox", help="Print a role inbox.")
    inbox.add_argument("--role", required=True, choices=ROLES)
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
```

## 13. Common Failure Modes

- The start script is not idempotent and creates duplicate watchers.
- The mirror script is copied without `codex_transcript_memory.py`, so imports
  fail.
- `offline-codex-transcripts-live/` is accidentally tracked.
- `AGENTS.md` says to read transcripts but does not start the mirror.
- The relay router is mentioned but not included, so the target repo cannot
  record role handoffs.
- Route commands are run in parallel and one route log append is lost.
- The continuity file becomes too large and stops being useful as startup
  memory.
- Historical snapshots are loaded wholesale instead of searched on demand.
- The target repo copies Pattern Detector-specific contracts without adapting
  them to its own governance.

## 14. Minimum Portable Checklist

Use this checklist for each new repo:

- [ ] Add or update `AGENTS.md` startup read order.
- [ ] Add the Codex mirror startup block to `AGENTS.md`.
- [ ] If using Tri-Agent governance, add `tools/agent_router.py` from the
  portable router copy in this guide.
- [ ] Add `tools/codex_transcript_memory.py`.
- [ ] Add `tools/codex_transcript_mirror.py`.
- [ ] Add `tools/start_codex_transcript_mirror.ps1`.
- [ ] Add `tools/stop_codex_transcript_mirror.ps1`.
- [ ] Add `memory-bank/CODEX_MEMORY_POLICY.md`.
- [ ] Generate `memory-bank/CODEX_CONTINUITY.md`.
- [ ] Generate `memory-bank/transcripts/codex-session-live.md`.
- [ ] Add `offline-codex-transcripts-*/` to `.gitignore`.
- [ ] Run the one-shot mirror command and confirm continuity/transcript files
  are generated.
- [ ] Run the start script twice and confirm the second run does not start a
  duplicate process.
- [ ] Confirm raw mirror files are ignored.
- [ ] Confirm a new agent can recover the latest task from continuity and the
  recent transcript window.
