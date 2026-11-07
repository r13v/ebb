---
worth: later
where: hooks/register.tsx:1
added: 2026-11-07
source: ship 20261107-1600-ebb, main @ none
---

# The band does not show a card that comes due while the session is idle

**Idea.** Choose the card again on a timer set to the next due time, and when another session changes the data.

**Why it matters.** After the last card, the band stays empty when a learning card (1 or 10 minutes) comes due, until the next turn ends.

**Evidence.** `showNextCard` runs at session start, after a review or a skip, and at the end of a turn only.

**Why it was deferred.** Found in the diff review; outside the first run's fixes.
