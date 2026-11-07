# pi-ebb

Spaced repetition in the background of [pi](https://pi.dev). It teaches you words, phrases or any other facts while you work.

```text
el corazón  │  alt+r Forgot  alt+g Got it  alt+s Skip
```

## Install

```sh
pi install npm:pi-ebb
```

## Use

- `/ebb install <file or URL>` adds a deck file, for example about 2000 words of Castilian Spanish with Russian translations: `/ebb install https://r13v.github.io/ebb/decks/es-ru.json`.
- `/ebb add <topic>` writes up to 9 new notes with the model of the session. Press `1` to `9` to tick a note, `a` to add the ticked notes, `x` or Escape to cancel.
- `/ebb decks`, `/ebb stats`, `/ebb pause [1h|30m|2d|off]`.

The card shows above the editor. The shortcuts never take a key the editor types:

- `alt+r`: Forgot, and Next after the answer.
- `alt+g`: Got it.
- `alt+s`: Skip.
- `alt+h`: hide or show the card.

The scheduler is FSRS-6. The data is in `$XDG_DATA_HOME/ebb/` (by default `~/.local/share/ebb/`), shared with the [Claude Code mod](https://github.com/r13v/ebb).

The full guide, the deck file format and the scheduling rules are in the [repository](https://github.com/r13v/ebb#readme).
