---
worth: yes
where: hooks/model.ts:95
added: 2026-11-07
source: ship 20261107-1600-ebb, main @ none
---

# Rule: an importer must not drop input silently

**Idea.** Create `CODING_STANDARDS.md` with the rule: an importer or merge must not drop input silently; it merges or reports what it skipped, and a test checks the counts.

**Why it matters.** The diff reviewer reads the standards document; without the rule the same kind of loss can pass review again.

**Evidence.** The first import dropped 20 meanings of words that are in two lists (`mejor` = лучше, `gratis` = бесплатно). The diff review missed it; final-check found it.

**Why it was deferred.** Retro candidate of the first run; outside its scope.
