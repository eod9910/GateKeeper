# Agent Relay Router Workflow

This guide explains exactly how Pattern Detector generates:

```text
agent-relay/transcripts/all.md
agent-relay/transcripts/<phase>.md
agent-relay/roles/<Role>/INBOX.md
```

The router does not scrape live chat. It only records role messages that are
explicitly routed through `tools/agent_router.py`.

## 1. Files To Copy Into A New Repo

Required router script:

```text
tools/agent_router.py
```

You can copy it from either:

```text
tools/agent_router.py
agent-memory-bootstrap/IMPLEMENTATION_GUIDE.md   # section: Portable Router Copy
```

Required relay folders:

```text
agent-relay/
  messages/
  router/
  roles/
    Builder/
      reports/
    Editor/
      reports/
    Router/
    User/
    Validator/
      directives/
      reports/
      rulings/
  transcripts/
  exports/
```

Minimum placeholder files are optional, but `.gitkeep` files are useful if the
repo needs empty folders committed.

## 2. What The Router Does

For each routed message, the router:

1. Reads a source role file, such as a Validator directive.
2. Copies that file unchanged into `agent-relay/messages/`.
3. Hashes the copied body with SHA-256.
4. Appends route metadata to `agent-relay/router/routes.jsonl`.
5. Regenerates role inbox files.
6. Regenerates per-phase transcripts.
7. Regenerates `agent-relay/transcripts/all.md`.

`all.md` is built from `routes.jsonl` plus the copied files in
`agent-relay/messages/`. If either is missing or corrupted, `all.md` will be
missing messages.

## 3. Do Not Route In Parallel

Run route commands one at a time.

Do not use parallel tool calls for `python tools\agent_router.py route ...`.
The router appends to one JSONL file and regenerates derived views. Parallel
route commands can lose a log entry.

## 4. Standard Role File Paths

Use these source file locations:

```text
agent-relay/roles/Validator/directives/YYYY-MM-DD-builder-thing.md
agent-relay/roles/Builder/reports/YYYY-MM-DD-thing-builder-report.md
agent-relay/roles/Editor/reports/YYYY-MM-DD-thing-editor-review.md
agent-relay/roles/Validator/rulings/YYYY-MM-DD-thing-validator-ruling.md
```

The source file is the role-owned canonical message. The router-created copy in
`agent-relay/messages/` is the immutable routed body.

## 5. Exact Command Sequence

Example phase:

```text
agent-memory-bootstrap-guide
```

### 5.1 Validator Directs Builder

Create a directive file:

```text
agent-relay/roles/Validator/directives/2026-06-16-builder-create-guide.md
```

Route it:

```powershell
python tools\agent_router.py route --phase "agent-memory-bootstrap-guide" --source Validator --target Builder --type "EXECUTION DIRECTIVE" --title "Create guide" --body-file "agent-relay\roles\Validator\directives\2026-06-16-builder-create-guide.md"
```

### 5.2 Builder Reports To Validator

Create a Builder report:

```text
agent-relay/roles/Builder/reports/2026-06-16-create-guide-builder-report.md
```

Route it:

```powershell
python tools\agent_router.py route --phase "agent-memory-bootstrap-guide" --source Builder --target Validator --type "BUILDER REPORT" --title "Create guide builder report" --body-file "agent-relay\roles\Builder\reports\2026-06-16-create-guide-builder-report.md"
```

### 5.3 Validator Directs Editor

If Editor review is needed, create a Validator directive:

```text
agent-relay/roles/Validator/directives/2026-06-16-editor-review-guide.md
```

Route it:

```powershell
python tools\agent_router.py route --phase "agent-memory-bootstrap-guide" --source Validator --target Editor --type "REVIEW DIRECTIVE" --title "Review guide" --body-file "agent-relay\roles\Validator\directives\2026-06-16-editor-review-guide.md"
```

### 5.4 Editor Reports To Validator

Create an Editor review:

```text
agent-relay/roles/Editor/reports/2026-06-16-guide-editor-review.md
```

Route it:

```powershell
python tools\agent_router.py route --phase "agent-memory-bootstrap-guide" --source Editor --target Validator --type "EDITOR REVIEW" --title "Guide editor review" --body-file "agent-relay\roles\Editor\reports\2026-06-16-guide-editor-review.md"
```

### 5.5 Validator Records A Ruling

If you want acceptance recorded as its own routed message, create:

```text
agent-relay/roles/Validator/rulings/2026-06-16-guide-accepted.md
```

Route it to User:

```powershell
python tools\agent_router.py route --phase "agent-memory-bootstrap-guide" --source Validator --target User --type "VALIDATOR RULING" --title "Guide accepted" --body-file "agent-relay\roles\Validator\rulings\2026-06-16-guide-accepted.md"
```

## 6. Regenerate Views

The router regenerates views after every `route`, but you can force it:

```powershell
python tools\agent_router.py regenerate
```

This writes:

```text
agent-relay/roles/Builder/INBOX.md
agent-relay/roles/Editor/INBOX.md
agent-relay/roles/Router/INBOX.md
agent-relay/roles/User/INBOX.md
agent-relay/roles/Validator/INBOX.md
agent-relay/transcripts/<phase>.md
agent-relay/transcripts/all.md
```

To write only one phase transcript:

```powershell
python tools\agent_router.py transcript --phase "agent-memory-bootstrap-guide"
```

## 7. Verify Integrity

Run:

```powershell
python tools\agent_router.py verify
```

Expected output:

```json
{
  "ok": true,
  "checked": 4
}
```

The number changes with the number of routed messages.

`verify` checks:

- allowed source/target route pairs;
- duplicate routing IDs;
- body file existence;
- SHA-256 hash match between `routes.jsonl` and copied message body.

## 8. How To See Conversations

All routed role conversation:

```text
agent-relay/transcripts/all.md
```

One phase:

```text
agent-relay/transcripts/<phase>.md
```

One role inbox:

```powershell
python tools\agent_router.py inbox --role Validator
python tools\agent_router.py inbox --role Builder
python tools\agent_router.py inbox --role Editor
```

## 9. Debugging all.md

If `all.md` is missing or incomplete:

1. Confirm the router runs:

```powershell
python tools\agent_router.py --help
```

2. Confirm route log exists:

```powershell
Get-Content agent-relay\router\routes.jsonl -Tail 5
```

3. Confirm copied message bodies exist:

```powershell
Get-ChildItem agent-relay\messages
```

4. Verify hashes:

```powershell
python tools\agent_router.py verify
```

5. Regenerate:

```powershell
python tools\agent_router.py regenerate
```

6. Open:

```text
agent-relay/transcripts/all.md
```

## 10. Common Problems

- `tools/agent_router.py` is missing.
- The copied router has a typo on line 1. It must start with:

```python
#!/usr/bin/env python3
```

- Route commands were run in parallel.
- The source body file path is wrong.
- `routes.jsonl` references a body file that was deleted.
- The role pair is not allowed by `ALLOWED_ROUTES`.
- `all.md` is expected to include ordinary chat transcripts. It does not. It
  only includes routed role messages.

For ordinary Codex chat transcripts, use:

```text
memory-bank/transcripts/codex-session-live.md
```

For Agent Relay role conversations, use:

```text
agent-relay/transcripts/all.md
```
