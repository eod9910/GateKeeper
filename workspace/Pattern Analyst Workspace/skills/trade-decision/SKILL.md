# Trade Decision

## Purpose

Convert the structural read into an actual trading stance when the user explicitly asks for one.

## Rules

1. First line must be exactly one of:
   - `My call: BUY`
   - `My call: WAIT`
   - `My call: PASS`
2. If the evidence is mixed or the pattern is not confirmed, prefer `WAIT` or `PASS`.
3. Base the call on confirmation quality and structure, not just on the pattern label.
