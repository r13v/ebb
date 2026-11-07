---
worth: later
where: hooks/model.ts:1
added: 2026-11-07
source: ship 20261107-1600-ebb, main @ none
---

# Production cards come before new recognition cards

**Idea.** Decide the order of new production and new recognition cards in a study session, and whether production cards use the daily new limit.

**Why it matters.** A mature deck can fill the daily limit with production cards and stop new words.

**Evidence.** `nextStudyCard` sorts new cards by note order; a production card of an old note sorts first.

**Why it was deferred.** Needs a product decision.
