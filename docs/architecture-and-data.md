# Architecture and data

What the person sees and the scheduling rules are in `README.md`; the terms are in `CONTEXT.md`. This document keeps the contracts between the parts.

## Runtime

- The engine loads `hooks/register.tsx` (named in `hooks/hooks.json`) into its own environment: no DOM, no Node. Everything outside the module goes through `$`: files, processes, the clock, model calls and the UI.
- A reload after an edit runs `register` and `session.start` again. `$.state` survives a reload; the module's own variables (the data cache, the session log buffer) start over. A value kept in `$.state` declares a `shape` in its `atom`; change the shape when the stored value changes its form.
- The band is an `AbovePrompt` render hook, and other plugins may draw there too. The hook always calls `next(e)` and draws the card under what it returns; a hook that answers without `next(e)` would hide every plugin beneath it. It passes the band on whole while a survey holds the band, while the cards are paused, and while the person hid it with the footer button (a `SessionMode` render hook; the choice is kept in `$.store`). Its buttons take keys only after the person moves the keys to the band (ctrl+x tab), so the mod never draws `autoFocus` there.
- The card in the band is a `$.state` value (`band` in `hooks/register.tsx`), chosen when a session starts, after a review or a skip, and at the end of a turn while its answer is hidden. The render hook only reads it, so a card never changes under the person's eyes. Skipped cards live in the module and are forgotten on a reload.

## Files and the lock

All data is in `~/.claude/ebb/`; `README.md` § Data lists the files.

- Several Claude Code sessions run the mod at once. Each one writes `data.json` only through `mutate` in `hooks/register.tsx`: it takes the lock (`withLock`), reads the file again inside it, applies a pure change and replaces the file through a temporary file and `mv`. A write outside `mutate` loses another session's grades.
- The lock is a directory, because `mkdir` is atomic. `withLock` owns the stale-lock rule.
- Each session writes only its own log file, so logs need no lock.
- `$.fs` reads and writes at most 4 MiB, so `data.json` holds about 10 000 notes. A write past that fails and leaves the file as it was.
- `upgrade` in `hooks/model.ts` reads data that an earlier version wrote. A change of the stored form extends `upgrade` and adds a test that seeds the old form.

## Model calls

`/ebb add` calls a model through `$`. `hooks/generate.ts` owns the prompts and parses the replies; it is pure, so a test checks a parser with a reply as text. A reply that does not parse shows the reason in the pane and adds nothing.

## Release and site

- `.github/workflows/release.yml` bumps the version in `.claude-plugin/plugin.json` and tags it after `.github/workflows/check.yml` passes on a push to `main` that changed the mod. Without a new version, `claude plugin update` does not see the change. CI installs the Claude Code version that `check.yml` pins; update it there together with a change that needs a newer engine.
- `.github/workflows/pages.yml` builds `site/build.mjs` into `_site/` when `decks/` or `site/` changes. A deck file in `decks/` is public: the site serves it for `/ebb install`.
