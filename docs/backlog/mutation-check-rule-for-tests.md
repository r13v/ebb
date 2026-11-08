---
worth: yes
where: docs/testing.md
added: 2026-11-08
source: ship 20261108-1338-active-deck, main @ c5a4ec5
---

# Remove a new filter once to check that a test fails

**Idea.** Add a rule to `docs/testing.md`: for a new filter or condition, remove it once and check that a test fails.

**Why it matters.** A filter that no test covers can break with all checks green. The diff review does not catch this reliably.

**Evidence.** In the active deck change, removing the per-deck filter in `counts` (`core/model.ts`) left all 42 tests passing. The diff review missed it; only the final check found it.

**Why it was deferred.** A change of the review rules is a separate change from the feature.
