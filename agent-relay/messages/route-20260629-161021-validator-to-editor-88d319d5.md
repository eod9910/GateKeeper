# Validator Directive: Protocol Compliance Addendum

## Review Scope

Correct the GateKeeper forensic audit trail so it explicitly names the protocol files used from `agent-relay/protocols/`.

## Editor Checks

- Confirm the audit report names the relevant protocol files.
- Confirm the addendum does not rewrite the original routed message body or invalidate its route hash.
- Confirm the correction remains scoped to relay/audit documentation.

## Blockers

Mark `EDITOR BLOCKER` if the audit trail still hides protocol usage, if routed-message integrity is broken, or if the correction changes source/runtime behavior.

## Required Output

Return a concise Editor addendum confirming that protocol usage is now visible in the durable audit report and relay ledger.
