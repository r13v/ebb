# ebb: instructions for coding agents

ebb is a Claude Code mod: a hooks module that the engine loads from `hooks/hooks.json`. `README.md` is for people who install it; `CONTEXT.md` is the glossary.

## Working rules

1. **Think before coding.** State the significant assumptions and the success criteria. Research the facts yourself; if an ambiguity changes the result, ask. Propose a simpler solution when it solves the task.
2. **Simplicity first.** Write the minimum code for the current task, without features for the future and without one-time abstractions. In a design choice, recommend the option without a new field, layer or setting. Before you write your own implementation, check what `$` of the engine already gives (grep `.claude-plugin/types/claude-code/index.d.ts`).
3. **Surgical changes.** Change only what is necessary. Keep existing user changes, including staged ones. Do not include adjacent fixes and refactoring in the task.
4. **Goal-driven execution.** Bring the result to verification. Fix the errors that your change causes, run the affected checks again and report their limits.
5. **Read before writing.** Before a change, read the affected exports, their direct consumers and the owner document of the topic. Do not replace a contract that you do not understand with a guess.
6. **Test intent.** A test must catch a broken invariant, not reproduce the implementation (`testing.md`).
7. **Match conventions.** Follow `code-style-and-folders.md` and Biome. Discuss a harmful convention explicitly; do not silently create a second style.
8. **Keep the glossary current.** When a change adds or renames a domain term or changes its meaning, update `CONTEXT.md` in the same change, as `glossary-format.md` specifies.

## Commands and checks

Run everything through mise: `mise.toml` pins Node.js and hk (`mise install`), puts `node_modules/.bin` on `PATH`, reinstalls the npm tree when the lockfile changed and installs the Git hook. `mise tasks` lists the tasks.

- `mise run test` runs the mod tests in the engine's environment (`claude plugin test`). `mise run validate` reads the manifest and the hooks module as the engine does.
- `mise run typecheck` needs `.claude-plugin/types/`, which the engine writes when it loads the mod; without it the task prints a warning and checks nothing. Run `mise run dev` once on a new checkout and after a Claude Code update, and say in the report when the types were missing.
- Run only the checks that the change needs: `biome check <files>`, `mise run test`, `mise run typecheck` when types or exports change. `mise run verify` runs everything; the Git hook runs the same steps on staged files (`hk.pkl`). A documentation-only edit needs no code checks.
- Tests use a stubbed engine. A change of what the band or the pane of `/ebb add` shows also needs a live check: `mise run live` inside agterm, otherwise by hand in `mise run dev` (`testing.md` § Live check); say in the report when you did not make one.
- Read the exit code: do not pipe a check into `tail` without `set -o pipefail`.
- Name in the report what you ran and what you did not.

## Documentation

Run `tree docs` at the beginning (without `tree`: `find docs -name '*.md' | sort`); the file names say what each document owns. Before you change code, read `architecture-and-data.md` and `code-style-and-folders.md`. Before you change documentation, read `documentation-rules.md`. Defer ideas outside the task to `docs/backlog/` with the `backlog` skill.

## Invariants

- Only a review changes a schedule. Showing, revealing or skipping a card does not.
- Every write of `data.json` goes through `mutate` in `hooks/register.tsx`, under the lock (`architecture-and-data.md` § Files and the lock).
- On every push, `.github/workflows/check.yml` runs Biome, Knip, validation and the tests (not the type check: CI has no engine types). When it passes on `main` and the mod changed since the last `v*` tag, `.github/workflows/release.yml` releases a new version. Do not bump the version by hand.
- The mod never interrupts the user: it never takes the keys from the prompt, and no pane, toast or question opens unless the user ran `/ebb`.
