#!/bin/sh
# Starts a Claude Code session with the mod of this checkout in an agterm companion pane,
# prints the band, reveals the card and prints it again. It never grades: the data is real.
set -eu

if [ -z "${AGTERM_SOCKET:-}" ] || [ -z "${AGTERM_SESSION_ID:-}" ]; then
  echo "live-check runs inside an agterm session; elsewhere, check by hand with 'mise run dev'." >&2
  exit 1
fi

root=$(cd "$(dirname "$0")/.." && pwd)
ctl() { agtermctl "$@" --socket "$AGTERM_SOCKET"; }

id=$(ctl session new --parent "$AGTERM_SESSION_ID" --cwd "$root" --name ebb-live --no-select \
  --command "zsh -lc 'claude --plugin-dir $root'")
trap 'ctl session close --target "$id" >/dev/null' EXIT

# The band and the footer: the lines above and below the prompt.
screen() { ctl session text --target "$id" | grep -v '^[[:space:]]*$' | tail -6; }
type() { ctl session type --target "$id" "$1" >/dev/null; sleep 1; }

# The footer button shows once the mod has loaded.
for _ in $(seq 30); do
  screen | grep -q '🌊 ebb' && break
  sleep 1
done
sleep 2

echo '== the card'
screen
type "$(printf '\030\t')" # ctrl+x tab: the keys go to the band
type r
echo '== revealed'
screen
type "$(printf '\033')"
