# CONTEXT.md format

`CONTEXT.md` is the domain glossary and nothing else. It sets the canonical English terms for code, UI, prompts and documents.

## Structure

```md
# {Context name}

{One or two sentences: what this context is.}

## Language

**Card**: {Definition in one or two sentences.}
_Avoid_: Flashcard, question
```

## Rules

1. **One term per concept.** Choose the canonical word and list the others in `_Avoid_`. Separate similar concepts explicitly: each gets its own term and an `_Avoid_` with the neighbour's term (Review and Skip).
2. **A definition is one or two sentences.** State what the concept is, not everything it does.
3. **Domain terms only.** Implementation details and general technical concepts go to their owner document.
4. **A human decides the term.** Record a new term or a change of meaning after the user decides or explicitly delegates the choice.

## When to update

In the same change as the code, when the change:

- introduces a new domain entity or state that the person sees;
- renames an entity in the UI, a command, a prompt or the data;
- changes the meaning or boundary of a term;
- makes a word from `_Avoid_` necessary.

After a glossary edit, check that the UI, prompts and documents use the new term.
