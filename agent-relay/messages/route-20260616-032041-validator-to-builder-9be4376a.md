# Validator Directive: Add Transcript Mirror Scripts To Bootstrap Guide

- Date: 2026-06-16
- Phase: agent-memory-bootstrap-guide
- From: Validator
- To: Builder
- Work tier: Tier 1 documentation/governance portability

## Mediator Request

The Mediator wants the bootstrap package to include the scripts necessary to
record transcript memory, not only instructions that such scripts exist.

## Required Work

Update the `agent-memory-bootstrap` package so it includes portable copies of
the Codex transcript mirror scripts:

- `codex_transcript_mirror.py`
- `codex_transcript_memory.py`
- `start_codex_transcript_mirror.ps1`
- `stop_codex_transcript_mirror.ps1`

Update `agent-memory-bootstrap/IMPLEMENTATION_GUIDE.md` to explain:

- where to copy these scripts in a target repo;
- how to run a one-shot transcript recording pass;
- how to start continuous transcript recording;
- how to stop continuous transcript recording;
- which memory files the scripts generate;
- how to verify transcripts are being recorded.

## Constraints

- Do not modify the live mirror implementation in `tools/`.
- Keep copied scripts under the bootstrap folder as templates.
- Keep instructions clear for a new Codex instance implementing this in another
  repo.

## Required Builder Report

Report:

- template files added;
- guide sections updated;
- verification performed;
- any limitations or assumptions.
