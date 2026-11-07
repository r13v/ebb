# Testing

`mise run test` runs the tests under `tests/` with `claude plugin test`: each file in a child process, in an environment like the one hooks run in. A test file imports its kit from `claude-code/testing`.

`mise run pi:test` runs `pi/*.spec.ts` with Vitest in Node. They are `.spec.ts`, because `claude plugin test` runs every `*.test.ts` of the checkout.

## Kinds of tests

- **Pure functions** (`tests/model.test.ts`, `tests/fsrs.test.ts`): call `core/model.ts` or `core/fsrs.ts` with an explicit `now`. Most new logic belongs here.
- **The mod in a stubbed engine** (`tests/ebb.test.tsx`): `register` runs against mocked events; `disk()` stands in for `$.fs` and `$.process`, so the lock and the files behave as on disk. Use it for what crosses `$`: commands, the band and the pane. `$.ui.mount` draws the band; read its whole tree with `drawn()`, because `find` matches an outer `Text` with the text of its children.
- **The pi extension** (`pi/ebb.spec.ts`): a real pi session from the SDK (`createAgentSession`) loads the extension, so pi's own runner dispatches its command, events and shortcuts; model calls go to pi's faux provider, files to a temporary `XDG_DATA_HOME`. Only the terminal is a stand-in, typed by pi's `ExtensionUIContext`, as pi's own test suite does it. pi publishes no test kit, and the SDK does not export pi's built-in keybindings, so a clash of a shortcut with one is not tested.
- **Scheduler vectors:** `tests/fsrs.test.ts` compares intervals with the test vectors of py-fsrs. A change of `core/fsrs.ts` keeps them passing; new vectors come from py-fsrs, not from our own output.

## Rules

- A test names the behaviour in its title, in plain words a person would use: "skip shows another card and changes no schedule".
- Time is an argument. Do not read the clock in a pure function; in the engine tests, advance the mocked clock instead of sleeping.
- A test of stored data seeds what an earlier version stored, when the change reads old data (`upgrade` in `core/model.ts`).

## Live check

The stubbed engine does not lay out the band or move the keys the way a real session does. A change of what the person sees needs a check in a real session. Inside agterm, `mise run live` (`scripts/live-check.sh`) opens one and prints the band with its card; it never grades, because the session uses the real data, so it cannot show the answer. Elsewhere, check by hand in `mise run dev`: the card above the prompt, ctrl+x tab and `u`, then `y` and Next, Escape, then a prompt that the band does not take keys from.

For pi, check by hand in `mise run pi:dev`: the card above the editor, `cmd+u`, then `cmd+y` twice (Forgot, Next), a click on Got it, `ctrl+0` twice, and a prompt typed with `y`, `u` and `i` that the band leaves alone. A click needs a real mouse: agterm types keys into a session, not clicks.
