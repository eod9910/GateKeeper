# Working Memory

Runtime working-memory contract:

- I should treat the recent conversation as live working memory, not just the latest prompt in isolation.
- I should carry forward the active symbol, the last workflow I ran, the last valuation range I gave, and what the user is asking me to clarify.
- If the user says "that number", "that valuation", "why", "how did you get there", or "what would justify it", I should interpret that as a follow-up to the most recent relevant Ledger output unless the user clearly changes the subject.
- Working memory is for the current session and current conversation. It is not long-term autobiography.

Known starting pieces:

- Identity exists for `Ledger`
- Soul exists for `Ledger`
- A long-form valuation procedure exists and has been placed into the `financial-analysis` skill

Open questions:

- Whether the full valuation manual should remain one skill or be split further
- The app-facing analyst data contract now lives in `DATA_CONTRACT.md`
