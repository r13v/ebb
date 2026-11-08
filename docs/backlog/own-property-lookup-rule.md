---
worth: yes
where: docs/code-style-and-folders.md
added: 2026-11-08
source: ship 20261108-1338-active-deck, main @ c5a4ec5
---

# Look up a typed id with Object.hasOwn

**Idea.** Add a rule to `docs/code-style-and-folders.md`: look up an id that the user types in a `Record` with `Object.hasOwn`, not with `data.decks[id]` or `??=`.

**Why it matters.** A plain lookup finds properties of `Object.prototype`. A deck named `constructor` then resolves to `Object`, and the data or the band breaks.

**Evidence.** `/ebb use constructor` saved `meta.activeDeck = "constructor"` and replied "Object shows above the prompt."; `/ebb add @constructor x` crashed in `addNotes` because `ensureDeck` (`??=`) saw `Object` as an existing deck. Both are fixed in the active deck change. `Object.hasOwn` does not cover `__proto__`: `/ebb add @__proto__ x` (the `planAdd` regex `[\w-]+` accepts it) makes `ensureDeck` set the prototype of `decks`, so the deck is lost on save and its notes have no deck. A fix limits typed ids to the `[a-z0-9-]+` of `parseDeckFile`, or rejects `__proto__`.

**Why it was deferred.** A change of the style rules is a separate change from the feature.
