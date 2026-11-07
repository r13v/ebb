# Architecture and data

What the person sees and the scheduling rules are in `README.md`; the terms are in `CONTEXT.md`. This document keeps the contracts between the parts.

## Two hosts, one core

- `core/ebb.ts` is the session that both hosts share: the data file under the lock, the review log, the card in the band, the commands and the drafting of new notes. It reaches the world only through a `Host`: files, the lock primitives, the clock, the network, the model and a call that redraws the band. The other `core/` modules are pure.
- `hooks/register.tsx` adapts `$` of Claude Code to `Host` and draws the band and the pane. `pi/index.ts` adapts Node (`pi/host.ts`) and pi's `ctx` to `Host` and draws the band as a widget, the list of `/ebb add` as a custom component, and grades with shortcuts.
- A host draws; it does not decide. Logic that both hosts need goes to `core/`, so the two never drift apart.

## Runtime of Claude Code

- The engine loads `hooks/register.tsx` (named in `hooks/hooks.json`) into its own environment: no DOM, no Node. Everything outside the module goes through `$`: files, processes, the clock, model calls and the UI.
- A reload after an edit runs `register` and `session.start` again. `$.state` survives a reload; the module's own variables (the data cache, the session log buffer) start over. A value kept in `$.state` declares a `shape` in its `atom`; change the shape when the stored value changes its form.
- The band is an `AbovePrompt` render hook, and other plugins may draw there too. The hook always calls `next(e)` and draws the card under what it returns; a hook that answers without `next(e)` would hide every plugin beneath it. It passes the band on whole while a survey holds the band, while the cards are paused, and while the person hid it with the footer button (a `SessionMode` render hook; the choice is kept in `$.store`). Its buttons take keys only after the person moves the keys to the band (ctrl+x tab), so the mod never draws `autoFocus` there.
- The session in `core/ebb.ts` chooses the card in the band when a session starts, after a review or a skip, and at the end of a turn while its answer is hidden. `hooks/register.tsx` mirrors it into a `$.state` value (`band`), and the render hook reads that value only to be drawn again when it changes; it draws the session's own card, so a card never changes under the person's eyes. `$.state` belongs to one conversation: a `/clear` starts a new one with every value unwritten and fires no `session.start`, while the module and its session go on. The footer's hidden flag follows the same rule. Skipped cards live in the module and are forgotten on a reload.
- The engine wants `types/index.d.ts` self-contained, so it repeats the stored types of `core/ebb.ts`; the type check of `hooks/register.tsx` fails when they drift apart.

## Files and the lock

All data is in `dataDir` of `core/ebb.ts` (`$XDG_DATA_HOME/ebb`); `README.md` § Data lists the files. Claude Code and pi share it, so a person has one schedule.

- Several sessions of both hosts run at once. Each one writes `data.json` only through `mutate` in `core/ebb.ts`: it takes the lock (`withLock`), reads the file again inside it, applies a pure change and replaces the file through a temporary file and `mv`. A write outside `mutate` loses another session's grades.
- The lock is a directory, because `mkdir` is atomic on both hosts (`/bin/mkdir` in Claude Code, `fs.mkdir` in pi). `withLock` owns the stale-lock rule.
- Each session writes only its own log file, so logs need no lock.
- `$.fs` of Claude Code reads and writes at most 4 MiB, so `data.json` holds about 10 000 notes. A write past that fails and leaves the file as it was.
- `upgrade` in `core/model.ts` reads data that an earlier version wrote. A change of the stored form extends `upgrade` and adds a test that seeds the old form.

## Model calls

`/ebb add` calls a model through `Host`: Claude Code calls `sonnet`, pi the model of the session. `core/generate.ts` owns the prompts and parses the replies; it is pure, so a test checks a parser with a reply as text. A reply that does not parse shows the reason in the pane and adds nothing.

## Release and site

- `.github/workflows/release.yml` bumps the version in `.claude-plugin/plugin.json` and tags it after `.github/workflows/check.yml` passes on a push to `main` that changed the mod. Without a new version, `claude plugin update` does not see the change. CI installs the latest Claude Code, so a red Check with no change of the mod means the engine changed.
- `.github/workflows/release-pi.yml` publishes `pi/` to npm as `pi-ebb` with semantic-release (`.releaserc.json`): a `fix:` or `feat:` commit since the last `pi-v*` tag makes a version, other commits make none. npm trusts the workflow through OIDC, so the repository holds no npm token. The version in `pi/package.json` stays `0.0.0-development`; semantic-release sets it only in the published package.
- Vite (`pi/vite.config.ts`) bundles `pi/index.ts` and `core/` into `pi/dist/index.js`. The packages pi supplies to an extension and Node's modules stay imports: a bundled copy of a pi package would bypass pi's module mapping.
- `.github/workflows/pages.yml` builds `site/build.mjs` into `_site/` when `decks/` or `site/` changes. A deck file in `decks/` is public: the site serves it for `/ebb install`.
