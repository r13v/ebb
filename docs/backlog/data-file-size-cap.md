---
worth: later
where: hooks/register.tsx:1
added: 2026-11-07
source: ship 20261107-1600-ebb, main @ none
---

# `data.json` cannot grow past 4 MiB

**Idea.** Split the storage (for example notes and schedules in separate files) or warn before the limit.

**Why it matters.** `$.fs.read` rejects files over 4 MiB; then every read and write fails at once.

**Evidence.** The real file is 716 KB for 1973 notes, so the limit is about 10 000 notes.

**Why it was deferred.** Far from the limit today.
