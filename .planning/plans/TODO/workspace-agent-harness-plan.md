# Workspace Agent Harness Plan

Date: 2026-03-31  
Status: Parked follow-up

## Purpose

Preserve the current workspace-per-agent model while adding better experiment discipline around isolated labs, manifests, and regression reporting.

## Core Principle

Keep:

- shared project workspace
- specialized agent workspaces
- isolated experiment areas for risky or exploratory work

Improve:

- manifests
- experiment runners
- parity/quality reports
- promotion criteria for moving sandbox work into production

## Why This Matters

The repo already has a strong workspace pattern, but the experiments around extraction quality, fallback strategies, and Ledger behavior need better repeatability.

Without a harness layer, we risk:

- rediscovering the same findings
- mixing production and sandbox logic too early
- making promotion decisions from terminal memory instead of reports

## Proposed Structure

1. Shared repo workspace remains the main production surface.
2. Each agent workspace remains responsible for its own reasoning contract and memory.
3. Each experimental thread gets an isolated lab with:
   - sample manifest
   - runner script
   - machine-readable report
   - human findings note
   - promotion decision

## Standard Experiment Package

Every isolated experiment should include:

- `manifest.json`
  - the sample set being evaluated
- `runner.py`
  - reproducible execution entrypoint
- `report.json`
  - machine-readable outcome
- `FINDINGS.md`
  - short human summary
- `PROMOTION.md` or planning note
  - whether the experiment should be promoted, postponed, or discarded

## Promotion Rules

Sandbox work should only move into the main pipeline when:

1. it improves a clearly defined quality metric
2. it does not regress the validation panel
3. it is reproducible from the runner and report
4. it has a clear production responsibility

## Immediate Candidate Uses

- filing extraction source comparison
- normalization family regression testing
- evidence-contract evaluation
- Ledger risk-review prompt/harness testing

## Not The Immediate Priority

This plan is intentionally parked.

The current priority remains:

- turning the downloaded SEC data into useful Ledger information
- improving extraction quality and evidence quality
- deciding the production extraction stack

## Resume Trigger

Come back to this plan when:

- the extraction stack is clearer
- we are ready to formalize recurring experiments
- we need stronger promotion discipline across multiple agent workspaces
