---
worth: later
where: core/ebb.ts:commitAdd
added: 2026-11-08
source: ship 20261108-1338-active-deck, main @ c5a4ec5
---

# An empty active deck leaves the band blank

**Idea.** Stop an empty deck from being the active deck, or make the band say what to do when the active deck has no cards.

**Why it matters.** The band shows the cards of the active deck only. When that deck has no cards, the band shows nothing, and the pi hint (`pi/index.ts:66`) asks to add or install a deck, although other decks have cards.

**Evidence.** `commitAdd` in `core/ebb.ts` calls `ensureDeck` for a new deck before `addNotes`, also when no note is ticked; neither host blocks "Add ticked (0)". `/ebb use @<deck>` accepts a deck with no cards. `bandView` returns `none`, not `no-deck`, when the active deck is empty.

**Why it was deferred.** It was found in the review of the active deck change and is outside its scope. Unknown: whether to block empty decks at the source or to add a hint in the band.
