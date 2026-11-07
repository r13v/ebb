# ebb

ebb teaches any skill by spaced repetition inside Claude Code, in the background of normal work. Castilian Spanish is the first deck.

## Language

**Deck**: A named set of notes on one subject, such as Castilian Spanish.
_Avoid_: Collection, course, set

**Note**: One thing to learn, such as a word with its translation, from which one or more cards are made.
_Avoid_: Word, entry, item

**Card**: One direction of a note that is scheduled on its own, such as ES→RU or RU→ES.
_Avoid_: Flashcard, question

**Recognition card**: The card that shows the target-language side and asks for the meaning (ES→RU).
_Avoid_: Forward card

**Production card**: The card that shows the meaning and asks for the target-language side with its article (RU→ES). It unlocks when the recognition card is stable enough.
_Avoid_: Reverse card

**Exposure**: A passive showing of a card in the spinner while Claude works, with its answer at the end of the turn. It never changes the schedule.
_Avoid_: Impression, passive review

**Review**: A graded answer to a card (Again, Hard, Good or Easy) in a study session. Only reviews change the schedule.
_Avoid_: Exposure, practice

**Study session**: The on-demand pane opened by `/ebb`, where the user reviews due cards and meets new ones.
_Avoid_: Lesson, quiz

**Reveal**: Showing the answer side of a card, at the end of a turn for an exposure or on request in a study session.
_Avoid_: Flip

**Due card**: A card whose scheduled time has come.
_Avoid_: Pending card

**New card**: A card that has had no review yet.
_Avoid_: Unseen card
