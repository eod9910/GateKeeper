# Operator Behavior Audit Checklist

Percent complete: 0%

Status: TODO
PRD: `operator-behavior-audit-prd.md`

## Product Definition

- [ ] Define the post-trade after-action report workflow.
- [ ] Define the mandatory fork between strategy outcome and operator deviation.
- [ ] Define the operator deviation taxonomy.
- [ ] Define the operator reliability score model.
- [ ] Define how reliability affects risk, cooldowns, or confirmation gates.

## Data Contracts

- [ ] Finalize the `OperatorDeviation` schema.
- [ ] Finalize the `OperatorReliabilityScore` schema.
- [ ] Create the missing `TradePostmortem` schema.
- [ ] Decide whether schemas belong in backend runtime validation or planning-only reference.
- [ ] Add versioning rules for postmortem and reliability score records.

## Backend

- [ ] Add storage for trade postmortems.
- [ ] Add storage for operator deviation records.
- [ ] Add storage for operator reliability score history.
- [ ] Add endpoint to create post-trade after-action reports.
- [ ] Add endpoint to fetch operator reliability history.
- [ ] Add reliability score recalculation service.

## Frontend

- [ ] Add post-trade after-action report UI.
- [ ] Add strategy outcome vs operator deviation fork.
- [ ] Add deviation tag picker.
- [ ] Add self-reported cause picker.
- [ ] Add notes field.
- [ ] Add operator reliability score display.
- [ ] Add history view for repeated behavior patterns.

## AI Behavior

- [ ] Add AI prompt rules for strategy-outcome postmortems.
- [ ] Add AI prompt rules for operator-deviation postmortems.
- [ ] Require metric or rule evidence for AI claims.
- [ ] Prevent AI from assigning blame or overriding strategy validation.

## Verification

- [ ] A completed trade can be postmortemed.
- [ ] A rule-following trade is stored as strategy outcome, not operator deviation.
- [ ] A rule-breaking trade requires deviation classification.
- [ ] Repeated deviations change the reliability score.
- [ ] Reliability score changes are auditable.
- [ ] The UI makes the psychological pattern visible without turning it into discretionary judgment.
