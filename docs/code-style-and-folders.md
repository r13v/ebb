# Code style

Priorities: readability, simplicity, maintainability. Biome (`biome.json`) checks formatting and lint; Knip finds unused files, exports and dependencies; review checks the other rules.

## Readability

1. **Separate steps with a blank line.** A guard clause, a computation and a result are separate paragraphs. Put a blank line before the final `return`, except in a block with a single statement.
2. **Name the result.** Assign a multi-line expression to a variable with a domain name, then return the variable.
3. **Keep ternaries short.** The condition is a variable or a call; the branches are simple values. No nested ternaries (Biome refuses them): use early returns in a small named function, as `checkbox` in `hooks/register.tsx`.
4. **Use early return.** Remove unsuitable cases before the main scenario.
5. **No assignment inside an expression.** Assign, then use the variable.

## Simplicity

6. **Access data directly.** For the last N items, use `slice(-N)`; for the last item, use `at(-1)`.
7. **Do not nest callbacks deeper than one level.** Move a callback with several steps to a named function.
8. **Do not create abstractions for the future.** Extract a function or a constant for reuse or to name a non-obvious step.
9. **Export only what another file imports.** Knip fails on an unused export.

## Maintainability

10. **Name complex conditions and non-obvious literals.** A threshold or a window gets a constant near its use, with its unit in the name or a comment (`DAY`, `LOCK_STALE_MS`).
11. **Keep `!` for an index that the code has already checked.** `noUncheckedIndexedAccess` is on; a `!` says "this index exists", so it needs a reason that a reader can see nearby.
12. **Give the extension of a relative import only where the engine needs it.** Follow the existing imports: `./model`, `../types`.
13. **Update dependencies deliberately.** Pin exact versions in `package.json` and `mise.toml`. Do not update the whole stack as part of an unrelated task.

## Folders

- `hooks/register.tsx` is the only module that touches `$`: files, the lock, model calls, the UI and the events. It stays thin: it reads, calls a pure function and writes.
- `hooks/model.ts`, `hooks/fsrs.ts`, `hooks/decks.ts` and `hooks/generate.ts` are pure: no `$`, no clock, no I/O. They take `now` as an argument. Put new logic here, where a test can call it directly.
- `types/index.d.ts` is the contract of the mod's `$.state` values; `claude plugin validate` checks every key the module names against it.
- `tests/` holds the tests (`testing.md`). `site/build.mjs` builds the Pages site and is plain Node.
- The engine runs a hooks module without DOM and without Node: no `require`, no `import()`, no `node:` modules under `hooks/`.

## Comments

Keep what the code, names and types do not show: the reason for a decision, an external constraint, an invariant, a unit or a format. Remove retelling of the code, history, commented-out code and done TODOs. Do not add comments where there were none as part of an unrelated task. If a comment contradicts the code, fix it when the requirements are clear; otherwise report the conflict.

## Review checks

- **An import or a merge does not drop input silently.** It merges, or it reports what it skipped, and a test checks the counts. When a deck file has the same front twice, the note takes both meanings (`README.md` § How cards are scheduled).
- **A test fails without its fix.** Break the rule once (revert the fix or apply a one-line mutation) and see the test fail.
- **A test takes the input production gives.** Build test data with the same writer the mod uses (`parseDeckFile`, `addNotes`), not by hand in a convenient shape.
- **A reader that runs on every render does not throw.** `JSON.parse` of a file that a person or another session can write needs its own guard: one throw in a `ui.render` hook skips the hook.
- **A render hook on a shared site keeps the others.** On `AbovePrompt`, `SessionMode` and other sites that several plugins draw into, the hook calls `next(e)` and puts its own part beside the result. A tree returned without `next(e)` hides every plugin beneath.
- **The owner document changes with the contract.** Grep `README.md`, `CONTEXT.md` and `docs/` for the changed name.
