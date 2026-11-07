---
worth: later
where: hooks/register.tsx:1
added: 2026-11-07
source: ship 20261107-1600-ebb, main @ none
---

# The custom turn line hides anything else the engine draws there

**Idea.** Draw the card after the engine's own turn line instead of replacing the whole line, if the API allows it.

**Why it matters.** If a later Claude Code build adds content to the turn line, ebb hides it.

**Evidence.** The `TurnDuration` hook returns its own `<Text>` and passes to `next(e)` only for expanded or waiting lines.

**Why it was deferred.** Unknown whether the API can append to the engine's line.
