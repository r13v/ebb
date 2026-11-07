# Documentation rules

Code comments follow `code-style-and-folders.md` § Comments.

- Document only what would surprise an experienced engineer who knows TypeScript, Claude Code mods and spaced repetition. Contracts and reasons, not a retelling of the code.
- Each topic has one owner document; the file name says which. Other documents refer to it and do not repeat it. A number or a limit lives in one place: the owner or the code.
- Describe the current state only. No history ("was", "used to", "previously", "no longer"), no dates, no commit hashes. Support for old data is a current contract, not history.
- Plans live only in `docs/backlog/`. An item that is implemented or dropped is deleted; the owner documents describe what is in effect.
- A contract change updates its owner document in the same change.
- Give descriptive kebab-case file names: `tree docs` shows only the names.

## Owners

- `README.md`: what a person who installs ebb sees and does. It keeps Markdown links, because people read it on GitHub.
- `CONTEXT.md`: the domain terms (`glossary-format.md`).
- `AGENTS.md`: working rules, commands and invariants for coding agents. Keep it minimal.
- `docs/`: contracts and reasons for the people who change the code.

## Code is the source of truth

Keep:

- Contracts and invariants between parts: who writes which file, what never changes a schedule, ordering and locking.
- The reason for a choice that an engineer would not expect, and the alternative it rules out.
- Behaviour that spans several files and that no single file shows.
- One pointer per topic to the file or function that implements it.

Remove:

- A step-by-step narration of what a function does.
- Lists of fields, constants, defaults and limits. Point to the symbol instead.
- A restatement of prompt text. The prompt in `hooks/generate.ts` owns its policy.
- File listings that `tree` shows.

Test a sentence: if a change of the code would make it false without a change of a contract, it retells the code.

## Style

- Write in English: active voice, short sentences (the `ste` skill).
- Use the terms of `CONTEXT.md`.
- Refer to a document in `docs/` by its file name in backticks, for example `testing.md`, and to its section as `testing.md` § Live check. Refer to any other file by its repo-root path, for example `hooks/model.ts`. No Markdown links to repository files outside `README.md`; external URLs stay links.
- Every path exists and has no line number.
- No manual wrapping of lines. No tables unless asked: use lists.

## Before you commit a documentation edit

- Every referenced path exists: ``grep -ohE '`(docs|hooks|tests|types|site|decks)/[^`]+`' AGENTS.md docs/*.md | tr -d '`' | sed 's/ §.*//' | sort -u | while read p; do ls -d "$p" >/dev/null 2>&1 || echo "missing: $p"; done``.
- No history: `grep -nE 'previously|used to|no longer|20[0-9]{2}-[0-9]{2}-[0-9]{2}' AGENTS.md README.md CONTEXT.md docs/*.md` finds nothing new.
- No duplicates: grep all documents for the topic and keep the text only in its owner.
- `git diff --check`.
