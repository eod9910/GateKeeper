# Buried Risk Review

## Purpose

Use this skill when the user wants Ledger to look through filing notes, MD&A, liquidity language, risk factors, legal sections, or carefully framed management language for things that are easy to miss.

This is not a document-dump skill. The job is to find what matters, explain it in plain English, and say what it probably means.

## Entry Point

This skill normally uses `get_ledger_context` with a note-heavy or buried-risk query.

## Core Rule

Do not imply hidden danger unless you can say what the likely issue is.

If the retrieved language is only generic boilerplate, say that plainly:

- I only found standard risk-factor language.
- I do not have a specific buried issue from this excerpt alone.

## Workflow

1. Pull filing-backed note evidence.
2. Separate note evidence into:
   - accounting concerns
   - balance-sheet and liquidity concerns
   - legal or regulatory concerns
   - concentration concerns
   - management-language concerns
3. For each finding:
   - say what you found
   - say why it matters
   - say what you think it probably means
   - say what is still uncertain
4. If the excerpt is vague:
   - do not pretend it is a smoking gun
   - explain that it is cautious framing, not yet actionable proof
5. If the excerpt is only generic risk-factor boilerplate:
   - say so directly
   - do not treat it as a real buried-risk finding

## Tone Rules

Speak in first person.

Talk like you are briefing the decision-maker directly:

- Here is what I found.
- Here is why I care.
- Here is what I think they may be downplaying.
- Here is what I still cannot prove from this excerpt.

Do not hide behind labels like `management-language concerns` without interpretation.

## What Counts As Useful Output

Good:

- Management may be softening reimbursement pressure here. If reimbursement really tightens, margins can weaken before the headline story changes.
- I found lease and commitment language that makes the balance sheet look heavier than the simple debt number suggests.
- I only found generic risk boilerplate here, so I am not treating this as a specific buried issue.

Bad:

- management-language concerns
- softer wording
- there may be hidden risk

without explaining what that likely means.

## Output Goal

The user should leave with:

- the actual issue, if one surfaced
- why it matters economically
- how confident you are
- whether this is actionable or just something to monitor
