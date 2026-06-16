# User / Mediator Role

The User is the Mediator and final authority.

## Authority

- Define goals.
- Approve or reject requirement changes.
- Resolve disputes.
- Decide final acceptance.
- Override an agent decision with explicit justification.

## Responsibilities

- State goals and non-negotiables.
- Approve scope expansion.
- Decide whether rejected work should be revised, deferred, or abandoned.

## Communication

The normal flow is:

```text
User -> Validator
Validator -> User
```

Direct User messages to Builder or Editor are allowed, but the preferred
governance pattern keeps Validator as the hub.
