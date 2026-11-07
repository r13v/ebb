---
worth: later
where: hooks/generate.ts:1
added: 2026-11-07
source: ship 20261107-1600-ebb, main @ none
---

# Check gender and lemmas of generated Spanish notes against Wiktionary

**Idea.** Use a local wiktextract dump to flag a wrong article or an unknown word in `/ebb add`.

**Why it matters.** Back-translation does not catch every wrong gender.

**Evidence.** Research: no existing LLM card tool checks gender against a dictionary; kaikki.org data has gender tags (CC-BY-SA).

**Why it was deferred.** Needs a download of about 100 MB and helps only Spanish.
