# Validator Ruling Protocol

## Purpose

Validator rulings record acceptance, rejection, or rework decisions after Builder and Editor reports.

## Required Header

```text
# Validator Ruling: <short title>
```

## Required Sections

```text
## Decision

Accepted, rejected, or rework required.

## Basis

Evidence used for the decision.

## Required Corrections

Only for rejected or rework decisions.

## Follow-Up

Next role action or user-facing summary.
```

## Routing Note

The portable router does not route `Validator -> User` by default. Store rulings under:

```text
agent-relay/roles/Validator/rulings/
```

Then report the decision to the user in normal conversation unless the router allowlist is intentionally extended.
