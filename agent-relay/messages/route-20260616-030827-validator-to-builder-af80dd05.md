# Validator Directive: Create Agent Memory Bootstrap Guide

- Date: 2026-06-16
- Phase: agent-memory-bootstrap-guide
- From: Validator
- To: Builder
- Work tier: Tier 1 documentation/governance portability

## Mediator Request

The Mediator wants a report that tells Codex how to implement this transcript
memory/startup pattern in other repositories.

## Required Work

Create a new self-contained folder with an implementation guide for other repos.
The guide must explain, step by step:

- the purpose of the system;
- what files/folders are necessary;
- how to add transcript mirror startup to `AGENTS.md`;
- how to start/check the mirror process;
- what memory files should be read at startup;
- what should be tracked versus ignored;
- how to verify the setup;
- how to adapt the pattern for repos that do or do not use the Tri-Agent
  contract.

## Constraints

- Do not modify mirror implementation scripts for this task.
- Do not move existing memory files.
- Keep the report portable and direct enough for another Codex instance to
  follow.
- Avoid assuming every repo has this repo's exact governance structure.

## Required Builder Report

Report:

- file(s) created;
- key implementation instructions included;
- verification performed;
- any limitations or follow-up recommendations.
