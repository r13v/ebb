# Testing

`mise run test` runs every `*.test.ts` and `*.test.tsx` under the checkout with `claude plugin test`: each file in a child process, in an environment like the one hooks run in. A test file imports its kit from `claude-code/testing`.

## Kinds of tests

- **Pure functions** (`tests/model.test.ts`, `tests/fsrs.test.ts`): call `hooks/model.ts` or `hooks/fsrs.ts` with an explicit `now`. Most new logic belongs here.
- **The mod in a stubbed engine** (`tests/ebb.test.tsx`): `register` runs against mocked events; `disk()` stands in for `$.fs` and `$.process`, so the lock and the files behave as on disk. Use it for what crosses `$`: commands, the spinner word, the turn line, the pane.
- **Scheduler vectors:** `tests/fsrs.test.ts` compares intervals with the test vectors of py-fsrs. A change of `hooks/fsrs.ts` keeps them passing; new vectors come from py-fsrs, not from our own output.

## Rules

- A test names the behaviour in its title, in plain words a person would use: "an overdue card gives way after its showings".
- Time is an argument. Do not read the clock in a pure function; in the engine tests, advance the mocked clock instead of sleeping.
- A test of stored data seeds what an earlier version stored, when the change reads old data (`upgrade` in `hooks/model.ts`).

## Live check

The stubbed engine does not draw the spinner or the turn line the way a real session does. A change of what the person sees needs a check in `mise run dev`: send a prompt, watch the spinner card, then the answer in the turn line, then open `/ebb`.
