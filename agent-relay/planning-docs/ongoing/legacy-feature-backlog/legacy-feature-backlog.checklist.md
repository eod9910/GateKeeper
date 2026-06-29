# Checklist: Legacy Feature Backlog

## Work Package

- Slug: `legacy-feature-backlog`
- PRD: `legacy-feature-backlog.prd.md`
- Phase: `legacy-feature-backlog`
- Executor: `Builder`
- Source: `.planning/plans/BACKLOG/legacy-feature-backlog.md`

## Preconditions

- [ ] Required decisions are frozen or preserved from the migrated source.
- [ ] Required PRD exists and matches this checklist slug.
- [ ] Validator refreshes current repo state before new implementation work begins.

## Tasks

- [ ] Migrate the legacy standalone plan into the bootstrap planning-doc structure.
- [ ] Review the migrated source for stale paths, stale statuses, and already-completed tasks.
- [ ] Convert remaining actionable work into explicit Builder tasks before implementation.

## Verification

- [ ] PRD/checklist pair exists in the same work-package folder.
- [ ] Current implementation status is checked against the repo before execution.
- [ ] Builder reports changed files and verification evidence for any future implementation slice.

## Builder Report Requirements

Builder must report the migrated source path, the tasks executed, the files changed, verification commands, and any stale or superseded requirements found during execution.
