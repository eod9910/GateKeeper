# Editor Review — Mirror Unification + AGENTS.md Startup

- Date: 2026-06-17
- Phase: agent-memory-mirror-unification
- From: Editor
- To: Validator
- Directive: `agent-relay/roles/Validator/directives/2026-06-17-mirror-unification.md`
- Builder report: `agent-relay/roles/Builder/reports/2026-06-17-mirror-unification-builder-report.md`
- Tier: 2 (governance + tooling, multi-step)

> I am the Editor. I review for readability/modularity/maintainability and
> behavior drift, and may perform structure-only, behavior-preserving refactors.
> I do NOT add product behavior and I do NOT certify that any refactor preserved
> behavior — that is the Validator's call.

## What I Reviewed

- `tools/cursor_transcript_mirror.py` — the main change (new dated-snapshot logic + ported helpers).
- `tools/codex_transcript_mirror.py` — read as the reference implementation only; not modified.
- `AGENTS.md` — startup read order, new "Agent Transcript Mirror Startup" section, "Agent Continuity Memory" rename.
- `memory-bank/CODEX_MEMORY_POLICY.md` — cursor snapshot coverage.
- `CLAUDE.md` — router compliance (R1).
- `git diff` and `git status --porcelain` for the five files to confirm scope.

## Refactor Decision: LEFT AS-IS (no code change)

I performed **no** refactor. The one structural improvement on the table —
extracting the duplicated cadence helpers into a shared module
(`tools/_transcript_mirror_common.py`) imported by BOTH mirrors — is **not**
available without violating the directive:

- To actually remove the duplication, `tools/codex_transcript_mirror.py` would
  have to stop defining `write_text_if_changed`, `sanitize_filename`,
  `should_write_dated_snapshot`, `update_snapshot_manifest`, and the
  `SNAPSHOT_*` constants locally and import them from the shared module instead.
  That edits the codex file, which the directive (R6 and the explicit
  "codex path must stay untouched" constraint) prohibits.
- Extracting a shared module and importing it from cursor **only** would not
  reduce duplication — codex would still keep its own copies — it would just add
  a third home for the same code. That is strictly worse.

Therefore the only behavior-preserving, codex-safe option is to leave the
duplication and record it as a non-blocking tech-debt note (below). This is also
consistent with the file's pre-existing pattern: `cursor_transcript_mirror.py`
already carried its own private copies of `write_json` / `load_json_file` /
`copy_if_exists` before this change.

Independent compile check (mine, not a behavior certification):

```
python -c "import py_compile; py_compile.compile('tools/cursor_transcript_mirror.py', doraise=True)"
→ OK cursor (exit 0)
```

## Behavior-Drift Review

- **Existing cursor continuity / live writes preserved.** The only change to
  existing logic in `write_memory_bank_views` is hoisting
  `"\n".join(transcript_lines)` into a local `snapshot_text` variable and writing
  that same string. `CURSOR_CONTINUITY.md` and `cursor-session-live.md` are still
  written with direct `write_text` to the same paths with identical content. No
  observable drift in those two files.
- **New work is additive and runs last.** The dated-snapshot block executes
  *after* the continuity and live files are already written, so the critical
  startup files are produced even if the new block were to fail. Good ordering.
- **Codex path untouched.** `tools/codex_transcript_mirror.py` and
  `codex_transcript_memory.py` do not appear in `git diff`/`git status`. Scope is
  exactly `AGENTS.md`, `memory-bank/CODEX_MEMORY_POLICY.md`,
  `tools/cursor_transcript_mirror.py`. Codex behavior/output is unchanged.
- **Docs match intent.** AGENTS.md startup now reads both continuity files and
  both transcript windows (R4); the mirror-startup section launches both
  PID-guarded launchers first (R2); `CLAUDE.md` is already a thin router (R1);
  the memory policy now covers the cursor dated snapshots under the same
  trackable/naming/sensitive rules (R5).

I confirm I found no behavior drift I introduced (I introduced none), and no
sign that the Builder change altered the two existing cursor output files'
content. I do not certify Builder's new snapshot behavior is correct — that is
the Validator's call.

## Correctness Smells in the New Snapshot Code (reviewed, none blocking)

- **Date-folder derivation.** `snapshot_dt = epoch_ms_to_datetime(metadata.get("mirrored_at_epoch_ms")) or datetime.now()`.
  Note `write_memory_bank_views` runs *before* `write_metadata` in `mirror_once`,
  so `mirrored_at_epoch_ms` is the *previous* run's timestamp (or absent on the
  first run, falling back to `datetime.now()`). In practice this is ~one interval
  stale and rarely crosses a day boundary, so the `YYYY-MM-DD` folder and
  `HHMMSS` stamp are effectively "now-ish". This differs from codex, which dates
  by the conversation's `updated_at`; for old/idle composers the cursor folder
  date can land on the mirror day rather than the conversation day. Acceptable
  given Cursor exposes no reliable per-conversation timestamp. Non-blocking;
  already flagged by Builder.
- **Slug / manifest-key choice.** `cursor_snapshot_identity` returns a filename
  slug from the composer `name` and a manifest key base from `composerId`
  (falling back to name, then workspace path). `snapshot_key = f"{date_part}:{base}"`
  parallels codex's `f"{date_part}:{record.id}"`. `composerId` is the closest
  stable per-conversation analog to a codex session id; the key is stable across
  runs. Reasonable. The slug, even if derived from a UUID, is capped at 120 chars
  by `sanitize_filename`, so no oversized/binary filenames. Non-blocking.
- **Cadence gating.** `should_write_dated_snapshot` / `update_snapshot_manifest`
  and the `SNAPSHOT_MIN_SECONDS` (6h) / `SNAPSHOT_MIN_CHAR_DELTA` (100k) constants
  are byte-identical to codex, and `latest.md` is written every run via
  `write_text_if_changed` while the timestamped checkpoint is gated by the
  manifest. Matches the reference. No smell.

## Clarity Review

- Naming is clear and intent-revealing (`cursor_snapshot_identity`,
  `epoch_ms_to_datetime`, `snapshot_text`, `snapshot_key_base`).
- Comments explain intent, not mechanics (e.g. "Durable, source-tagged dated
  snapshots in the same tracked layout Codex uses ... mirroring
  codex_transcript_mirror.py"). No narration-style noise.
- No dead code introduced. The `datetime` import is now used.
- AGENTS.md reads cleanly. Minor, acceptable redundancy: the new "Agent
  Transcript Mirror Startup" section restates which files each mirror keeps
  current, which overlaps slightly with the memory policy; this is appropriate
  for a routing doc and not worth a change.

## Non-Blocking Concerns (tech debt)

1. **Helper duplication (tracked).** `write_text_if_changed`,
   `sanitize_filename`, `should_write_dated_snapshot`,
   `update_snapshot_manifest`, and the `SNAPSHOT_*` constants are duplicated
   between `cursor_transcript_mirror.py` and `codex_transcript_mirror.py`.
   Intentionally left as-is because de-duplicating requires editing the codex
   file, which is out of scope for this directive. Recommend a *separate,
   codex-inclusive* refactor ticket: extract a `tools/_transcript_mirror_common.py`
   and migrate both mirrors together, validated end-to-end. Do not attempt it
   piecemeal.
2. **Snapshot date can lag the conversation day** for idle composers (see "Date-
   folder derivation"). If exact conversation-day bucketing ever matters, source
   a per-composer `lastUpdatedAt` for the date instead of mirror time.
3. **Behavior parity is compile/lint-verified only.** Neither Builder nor Editor
   ran the mirror, so the composer-derived slug/key and the produced snapshot
   files are unverified against live Cursor storage shape. Flagging for the
   Validator's verification plan, not as a defect.

## Editor Blocker

**Editor found no blocker.**

## Certification

I am the Editor. I made no code changes, so there is nothing of mine to
certify. I do not certify that Builder's new snapshot behavior preserves prior
behavior or is functionally correct — that determination belongs to the
Validator.
