# Testing

`mise run test` runs every `*.test.ts` and `*.test.tsx` under the checkout with `claude plugin test`: each file in a child process, in an environment like the one hooks run in. A test file imports its kit from `claude-code/testing`.

## Kinds of tests

- **Pure functions** (`tests/model.test.ts`, `tests/fsrs.test.ts`): call `hooks/model.ts` or `hooks/fsrs.ts` with an explicit `now`. Most new logic belongs here.
- **The mod in a stubbed engine** (`tests/ebb.test.tsx`): `register` runs against mocked events; `disk()` stands in for `$.fs` and `$.process`, so the lock and the files behave as on disk. Use it for what crosses `$`: commands, the band and the pane. `$.ui.mount` draws the band; read its whole tree with `drawn()`, because `find` matches an outer `Text` with the text of its children.
- **Scheduler vectors:** `tests/fsrs.test.ts` compares intervals with the test vectors of py-fsrs. A change of `hooks/fsrs.ts` keeps them passing; new vectors come from py-fsrs, not from our own output.

## Rules

- A test names the behaviour in its title, in plain words a person would use: "skip shows another card and changes no schedule".
- Time is an argument. Do not read the clock in a pure function; in the engine tests, advance the mocked clock instead of sleeping.
- A test of stored data seeds what an earlier version stored, when the change reads old data (`upgrade` in `hooks/model.ts`).

## Live check

The stubbed engine does not lay out the band or move the keys the way a real session does. A change of what the person sees needs a check in `mise run dev`: see the card above the prompt, press ctrl+x tab and `r`, see the grades, press Escape, then send a prompt and see that the band stays and the prompt takes the keys.
