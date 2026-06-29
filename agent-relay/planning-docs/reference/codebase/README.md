# Codebase Reference Index

Last orientation audit: 2026-06-02
Status: Current orientation bundle

## Required Use

Read this folder together with the memory bank when getting oriented to the app.

These files are useful for understanding the current shape, vocabulary, and concerns of the codebase. They were refreshed against the repo on 2026-06-02. Treat them as orientation material, then verify implementation-sensitive facts against the filesystem, GitNexus, and source code before making decisions.

## Current Trust Level

| File | Trust level | Notes |
| --- | --- | --- |
| `ARCHITECTURE.md` | Current orientation | Describes the current layered app and major feature areas. |
| `STRUCTURE.md` | Current orientation | Maps the current repo folders, backend, frontend, data, and planning structure. |
| `TESTING.md` | Current orientation | Documents current backend test scripts and remaining coverage gaps. |
| `CONCERNS.md` | Current orientation | Summarizes current high-risk areas and practical mitigations. |
| `STACK.md` | Current orientation | Summarizes current languages, runtimes, dependencies, storage, and AI/external services. |
| `INTEGRATIONS.md` | Current orientation | Summarizes current AI, market data, fundamentals, social, broker, and scheduler integrations. |
| `CONVENTIONS.md` | Current orientation | Summarizes current naming, backend, frontend, Python, planning, and testing conventions. |

## Refresh Rule

Before relying on a claim in these files:

1. Check the file's analysis date and orientation audit note.
2. Verify the claim against current repo files.
3. If the claim is wrong, update the document or mark the stale section clearly.

## Desired Future State

Keep these documents current when major subsystems, routes, data stores, or test conventions change. Archive older versions instead of leaving stale claims in the live reference set.
