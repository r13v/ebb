---
worth: yes
where: hooks/register.tsx:1
added: 2026-11-07
source: ship 20261107-1600-ebb, main @ none
---

# No one-command live check of the mod in a real session

**Idea.** Add `scripts/live-check.sh` that starts a companion agterm session with `--plugin-dir`, sends one prompt and prints the spinner word and the turn line.

**Why it matters.** Two defects (a stale spinner card, the spinner not redrawing) showed only in a live session; tests with a stubbed engine passed.

**Evidence.** The first run spent about 20 hand-built agtermctl calls on live checks. Keystrokes sent before the session is ready land in the composer as text.

**Why it was deferred.** Retro candidate of the first run; outside its scope.
