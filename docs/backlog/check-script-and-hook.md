---
worth: yes
where: tests/ebb.test.tsx:1
added: 2026-11-07
source: ship 20261107-1600-ebb, main @ none
---

# No automatic checks run in the repository

**Idea.** Add `scripts/check.sh` that runs `claude plugin validate`, `claude plugin test` and `tsc -p .`, and a pre-commit hook that runs it.

**Why it matters.** Without it, a change can break the mod or its types and nobody sees it until a live session fails.

**Evidence.** The first ship run typed every check by hand. The type check needed a temporary tsconfig outside the repository, because `tsconfig.json` extends `.claude-plugin/types/`, which exists only after the engine loads the mod.

**Why it was deferred.** Retro candidate of the first run; outside its scope.
