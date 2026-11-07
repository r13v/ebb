---
worth: later
where: hooks/register.tsx:1
added: 2026-11-07
source: ship 20261107-1600-ebb, main @ none
---

# The study pane does not redraw when a card comes due

**Idea.** Redraw the pane on a timer set to the next due time, and when another session changes the data.

**Why it matters.** "На сейчас всё" stays on screen after a learning card (1 or 10 minutes) comes due.

**Evidence.** The pane redraws only when its `view` state changes.

**Why it was deferred.** Found in the diff review; outside the first run's fixes.
