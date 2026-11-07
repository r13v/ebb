# Architecture and data

What the person sees and the scheduling rules are in `README.md`; the terms are in `CONTEXT.md`. This document keeps the contracts between the parts.

## Runtime

- The engine loads `hooks/register.tsx` (named in `hooks/hooks.json`) into its own environment: no DOM, no Node. Everything outside the module goes through `$`: files, processes, the clock, model calls and the UI.
- A reload after an edit runs `register` and `session.start` again. `$.state` survives a reload; the module's own variables (the data cache, the session log buffer) start over. A value kept in `$.state` declares a `shape` in its `atom`; change the shape when the stored value changes its form.
- The mod never blocks a turn on its own work: a failed hook must leave the spinner and the turn line of the engine as they are.

## Files and the lock

All data is in `~/.claude/ebb/`; `README.md` § Data lists the files.

- Several Claude Code sessions run the mod at once. Each one writes `data.json` only through `mutate` in `hooks/register.tsx`: it takes the lock (`withLock`), reads the file again inside it, applies a pure change and replaces the file through a temporary file and `mv`. A write outside `mutate` loses another session's grades.
- The lock is a directory, because `mkdir` is atomic. `withLock` owns the stale-lock rule.
- A spinner showing writes `passive.json`, not `data.json`, so a turn never rewrites the large file.
- Each session writes only its own log file, so logs need no lock.
- `upgrade` in `hooks/model.ts` reads data that an earlier version wrote. A change of the stored form extends `upgrade` and adds a test that seeds the old form.

## Model calls

`/ebb add` and the question in the study pane call a model through `$`. `hooks/generate.ts` owns the prompts and parses the replies; it is pure, so a test checks a parser with a reply as text. A reply that does not parse shows the reason in the pane and adds nothing.

## Release and site

- `.github/workflows/release.yml` bumps the version in `.claude-plugin/plugin.json` and tags it on every push that changes the mod. Without a new version, `claude plugin update` does not see the change.
- `.github/workflows/pages.yml` builds `site/build.mjs` into `_site/` when `decks/` or `site/` changes. A deck file in `decks/` is public: the site serves it for `/ebb install`.
