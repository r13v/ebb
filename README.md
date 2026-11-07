# ebb

ebb is a Claude Code mod for spaced repetition. It teaches you words, phrases or any other facts while you do your normal work.

Site and decks: <https://r13v.github.io/ebb/>

- A band above the prompt shows one card: `el corazón  [ Show ]  [ Skip ]`.
- Show the answer, then grade the card: `el corazón — heart  [ Again 1m ]  [ Hard 6m ]  [ Good 10m ]  [ Easy 2d ]`. A hint of the note, if it has one, follows the answer. The next card comes at once.
- You can do it while Claude works, or ignore the band. The `🌊 ebb` button under the prompt hides the band and shows it again. ebb never interrupts you.

The scheduler is FSRS-6, the algorithm that Anki uses.

## Install

```sh
claude plugin marketplace add r13v/ebb
claude plugin install ebb@ebb
```

Then restart Claude Code.

To update, open `/plugin` in Claude Code, or run:

```sh
claude plugin marketplace update ebb
claude plugin update ebb@ebb
```

Every change of the plugin on `main` gets a new version and a `v*` tag (`.github/workflows/release.yml`), so these commands see it.

## Get cards

ebb comes with no cards. Make a deck, or install one.

- **Make one:** `/ebb add <topic>`. Write the request in your own language, for example `/ebb add испанские слова для бара` or `/ebb add Spanish words for a bar`. Claude takes the language you learn from the request and gives the answers in the language you write in. If it cannot tell your language, the pane asks once. A topic that is not about a language, such as `/ebb add @k8s pods`, makes a deck of questions and answers.
- **Install one:** `/ebb install <file or URL>` adds a deck file. For example, about 2000 words, phrases and idioms of Castilian Spanish with Russian translations:

  ```text
  /ebb install https://r13v.github.io/ebb/decks/es-ru.json
  ```

  Install the same file again to get its new notes. Your cards keep their schedule.

  Every deck in `decks/` of this repository is on the site, with a button that copies its install command. To share a deck, add its file to `decks/` in a pull request.

### Deck file

A deck file is JSON:

```json
{
  "id": "es-en",
  "name": "Spanish for English speakers",
  "learn": "Spanish",
  "native": "English",
  "guidance": "Nouns carry their article.",
  "notes": [
    {"front": "el agua", "back": "water", "hint": "el, although agua is feminine", "tags": ["noun"]}
  ]
}
```

- `id` and `name` are necessary. The `id` has lowercase letters, digits and hyphens.
- `learn` and `native` make a language deck: the language you learn and the language of the answers. Without them, the deck asks questions in one direction only.
- `guidance` is optional: more instructions for the notes that `/ebb add` writes in this deck.
- New cards come in the order of `notes`.

## Commands

| Command | Result |
|---|---|
| `/ebb` | Shows the counts and the commands. |
| `/ebb install <file or URL>` | Adds a deck file, or the new notes of a deck file you installed before. |
| `/ebb decks` | Lists your decks with their cards, due cards and new cards. |
| `/ebb add <topic>` | Claude writes up to 9 new notes on the topic. In a language deck, a second model call translates each note back and flags the notes that do not match. You select the notes to add. |
| `/ebb add @<deck> <topic>` | The same for a named deck. ebb creates the deck on first use. With more than one deck, the name is necessary. |
| `/ebb pause [1h\|30m\|2d\|off]` | Hides the band for that time. The default is 1 hour. |
| `/ebb stats` | Shows the number of notes, due cards and new cards. |

In the band above the prompt:

- Click a button, or press `ctrl+x tab` to move the keys to the band and then press its key.
- Press `r` to show the answer, or `s` to skip the card. A skipped card comes back when no other card is left.
- Press `1` (Again), `2` (Hard), `3` (Good) or `4` (Easy) to grade the card. Each button shows the next interval.
- Press Escape to return to the prompt.
- Click `🌊 ebb` under the prompt to hide or show the band. It stays as you left it in new sessions.

In the pane of `/ebb add`:

- Press `1` to `9` to tick or untick a note. A note marked `[have]` is in the deck already and cannot be ticked.
- Press `a` to add the ticked notes, or `x` to cancel.
- If the back-translation fails, no note is ticked and the pane says so. Check the notes yourself.

## How cards are scheduled

- A new note gets a recognition card (for example Spanish → Russian).
- In a language deck, when the recognition card reaches a stability of 21 days, ebb adds a production card (Russian → Spanish). A deck of facts asks in one direction only.
- The band takes due cards and new cards in turns, as Anki mixes new cards with reviews. New cards come in deck order, up to 20 each day for each deck. Then new production cards: they are words you know already, so they do not count toward the 20. To change the number, set `newPerDay` on the deck in `data.json`.
- A card you just graded or skipped never comes straight back while another card is left. A learning card waits for its step.
- Learning steps are 1 minute and 10 minutes. The relearning step is 10 minutes.
- When nothing is scheduled, the band runs ahead: new cards past the daily limit, then the card that comes due soonest. So it always has a card.
- Only a grade changes a schedule. Showing or skipping a card does not.
- At the end of each turn, a card whose answer is hidden makes way for a card that came due.
- When a deck file has the same front twice, the note gets the meanings of both: `mejor` is `лучший; лучше`.

The terms are defined in [CONTEXT.md](CONTEXT.md).

## Data

All data is in `~/.claude/ebb/`:

- `data.json` holds the decks, notes and card schedules.
- `log/<YYYY-MM>/<session>.json` holds the reviews of one session.

Each session writes only its own log file. A change to `data.json` takes a lock (`~/.claude/ebb/lock`) and reads the file again before it writes. Thus two open sessions do not lose each other's grades. A lock that is older than 10 seconds is removed.

## Development

The tools and tasks are in `mise.toml`. Install [mise](https://mise.jdx.dev), then:

```sh
mise install      # Node.js, hk, the npm tools and the Git hook
mise run dev      # a Claude Code session with the mod of this checkout
mise run verify   # Biome, Knip, TypeScript, validation and the tests
mise run live     # inside agterm: a real session with the mod, its band before and after Show
```

`mise run dev` loads the mod from the checkout; Claude Code reloads it when a turn ends after a change. It also writes `.claude-plugin/types/`, which `mise run typecheck` needs. `mise run site` builds the site into `_site/` (GitHub Actions publishes it on a push to `main`).

The FSRS tests use the test vectors of py-fsrs. The rules for code and documents are in [AGENTS.md](AGENTS.md) and [docs/](docs).
