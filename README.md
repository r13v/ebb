# ebb

ebb is a Claude Code mod for spaced repetition. It teaches you words, phrases or any other facts while you do your normal work.

- While Claude works, the spinner shows one card, for example `el corazón`.
- When the turn ends, the turn line shows the answer: `✻ Baked for 12s · el corazón — сердце · 7 к повторению · /ebb`.
- You grade cards only when you open a study session with `/ebb`. ebb never interrupts you.

The scheduler is FSRS-6, the algorithm that Anki uses. The first deck is Castilian Spanish for Russian speakers.

## Install

```sh
claude plugin marketplace add r13v/ebb
claude plugin install ebb@ebb
```

Then restart Claude Code.

On the first start, ebb imports the word lists from `~/.claude/spanish` if that folder exists. Run `/ebb import` again after you change the lists.

## Commands

| Command | Result |
|---|---|
| `/ebb` | Opens the study pane. |
| `/ebb add <topic>` | Claude writes up to 9 new notes on the topic. A second model call translates each note back and flags the notes that do not match. You select the notes to add. |
| `/ebb add @<deck> <topic>` | The same for another deck, for example `@k8s`. ebb creates the deck on first use. Such a deck asks in one direction only: question → answer. |
| `/ebb pause [1h\|30m\|2d\|off]` | Stops the cards in the spinner for that time. The default is 1 hour. |
| `/ebb stats` | Shows the number of notes, due cards and new cards. |
| `/ebb import` | Imports `~/.claude/spanish` again. Notes that exist already are skipped. |

In the study pane:

- Press `r` or Enter to show the answer.
- Press `1` (Again), `2` (Hard), `3` (Good) or `4` (Easy) to grade the card. Each button shows the next interval.
- Press `q` to ask Claude a question about the card.
- Press Escape to close the pane.

In the pane of `/ebb add`:

- Press `1` to `9` to tick or untick a note. A note marked `[дубль]` is in the deck already and cannot be ticked.
- Press `a` to add the ticked notes, or `x` to cancel.
- If the back-translation fails, no note is ticked and the pane says so. Check the notes yourself.

## How cards are scheduled

- A new note gets a recognition card (Spanish → Russian).
- When the recognition card reaches a stability of 21 days, ebb adds a production card (Russian → Spanish, with the article).
- The study session shows due cards first. Then it shows new cards, up to 10 each day for each deck. Then it shows learning cards that come due in the next 20 minutes.
- Learning steps are 1 minute and 10 minutes. The relearning step is 10 minutes.
- The spinner shows cards that are in learning or due within a day. If there are none, it shows one of the next 5 new cards in deck order.
- Each card gives way after 3 showings in the spinner since its last review. Thus the spinner moves through the deck on its own, about one new word for each 3 turns, also when you never open `/ebb`. A review starts the count again. To change the number, set `passiveShows` on the deck in `data.json`.
- When every card has had its showings, the spinner shows any card you have met.
- A card in the spinner does not change its schedule. The counts of showings are in `~/.claude/ebb/passive.json`.
- The import from `~/.claude/spanish` merges a word that is in two lists: `mejor` gets `лучший; лучше`.
- The spinner never shows a card with more than 40 characters on its front.

The terms are defined in [CONTEXT.md](CONTEXT.md).

## Data

All data is in `~/.claude/ebb/`:

- `data.json` holds the decks, notes and card schedules.
- `passive.json` holds how many times the spinner showed each card since its last review.
- `log/<YYYY-MM>/<session>.json` holds the reviews and the spinner exposures of one session.

Each session writes only its own log file. A change to `data.json` takes a lock (`~/.claude/ebb/lock`) and reads the file again before it writes. Thus two open sessions do not lose each other's grades. A lock that is older than 10 seconds is removed.

## Development

Load the mod from a local checkout. Claude Code reloads it when a turn ends after a change:

```sh
claude --plugin-dir ~/Projects/ebb
```

Run the checks:

```sh
claude plugin validate ~/Projects/ebb
claude plugin test ~/Projects/ebb
```

The FSRS tests use the test vectors of py-fsrs.
