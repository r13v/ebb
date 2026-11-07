---
worth: later
where: hooks/register.tsx:1
added: 2026-11-07
source: ship 20261107-1600-ebb, main @ none
---

# A turn without a turn line loses its reveal

**Idea.** When a turn ends without a `TurnDuration` line, show the answer some other quiet way, or carry it to the next line.

**Why it matters.** The spinner showed the card, but the user never sees its answer.

**Evidence.** `pending` is replaced at the next prompt; the reveal binds only to a `TurnDuration` render.

**Why it was deferred.** Unknown how often Claude Code skips the line; all turns in the live checks had one.
