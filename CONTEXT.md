# ebb

ebb teaches any skill by spaced repetition inside Claude Code, in the background of normal work.

## Language

**Deck**: A named set of notes on one subject, such as Castilian Spanish.
_Avoid_: Collection, course, set

**Deck file**: A deck as one JSON file that `/ebb install` adds from a path or a URL.
_Avoid_: Bundled deck, preset, package

**Language deck**: A deck that teaches a language; it knows the language learned and the language of the answers, and makes both recognition and production cards.
_Avoid_: Vocabulary deck

**Note**: One thing to learn, such as a word with its translation, from which one or more cards are made.
_Avoid_: Word, entry, item

**Card**: One direction of a note that is scheduled on its own, such as ES→RU or RU→ES.
_Avoid_: Flashcard, question

**Recognition card**: The card that shows the target-language side and asks for the meaning (ES→RU).
_Avoid_: Forward card

**Production card**: The card that shows the meaning and asks for the target-language side with its article (RU→ES). It unlocks when the recognition card is stable enough.
_Avoid_: Reverse card

**Review**: A graded answer to a card in the band: Forgot (FSRS Again) or Got it (FSRS Good). Only reviews change the schedule.
_Avoid_: Practice

**Band**: The line above the prompt that shows one card at a time, where the user grades or skips it.
_Avoid_: Study pane, study session, widget

**Skip**: Putting the card in the band aside for this session without a review; it comes back when no other card is left.
_Avoid_: Bury, postpone

**Reveal**: Showing the answer side of the card in the band after the user grades it Forgot; Next takes the band to the next card.
_Avoid_: Flip

**Due card**: A card whose scheduled time has come.
_Avoid_: Pending card

**New card**: A card that has had no review yet.
_Avoid_: Unseen card
