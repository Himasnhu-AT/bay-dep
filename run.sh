#!/bin/sh
# Run bay, exactly once, on current code.
#
# This exists because "is the window I am looking at the code I just wrote?" turned out to be a
# real question with an expensive wrong answer. `electron .` compiles nothing — it runs whatever
# is in `out/` — so an app started without a build shows the previous build with no sign that it
# is doing so. Twice in one session a probe reported green against a binary that did not contain
# the change under test.
#
# It also enforces one instance. On macOS closing the window does not quit the process, each
# `open -na` is a separate app with its own user-data-dir and socket, and only one can hold the
# debugging port — so extras are invisible, undriveable, and accumulate.
#
#   ./run.sh              build, then run one instance
#   ./run.sh --no-build   run what is already in out/ (say so out loud)
#   ./run.sh --dev        electron-vite dev, with renderer HMR
#   ./run.sh --stop       stop every instance and exit
#   ./run.sh --gate       run WITHOUT the dev access bypass (see below), to see the sign-in screen
#
# bay is invite-only: a build shows its access screen until an account with access signs in, and
# refuses every MCP tool call until then. This script launches with BAY_ACCESS=dev, which skips
# that check — honoured only by an unpackaged build (`electron .`), never by an installed app — so
# the probes in test/app/ drive the editor as before. `--gate` leaves it off.
#
# The debugging port is always on: `test/app/*.mjs` drive the app through it, and an instance
# started without it is one the probes cannot see.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$here"

PORT=9222
MODE=build
GATE=0

for arg in "$@"; do
  case "$arg" in
    --no-build) MODE=nobuild ;;
    --dev)      MODE=dev ;;
    --stop)     MODE=stop ;;
    --gate)     GATE=1 ;;
    --port=*)   PORT=${arg#--port=} ;;
    -h|--help)  sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "run.sh: unknown option $arg (try --help)" >&2; exit 2 ;;
  esac
done

# Find our app's main processes.
#
# Two traps, both hit while writing this. The repo path appears BEFORE the binary name
# (`…/synthai/vii/node_modules/…/MacOS/Electron . --remote-debugging-port=…`), so a pattern like
# `Electron .*$here` matches nothing — the first version silently found zero instances while one
# was holding the debugging port. And every helper process shares that same prefix
# (`…/MacOS/Electron Helper (Renderer)`), so matching the binary alone sweeps up children that
# die with their parent anyway.
#
# So: match the Electron binary inside THIS checkout, then drop anything whose arguments say
# Helper. Another project's Electron is not ours to kill.
running() {
  pgrep -f "$here/node_modules/.*/MacOS/Electron" 2>/dev/null | while read -r pid; do
    case "$(ps -p "$pid" -o args= 2>/dev/null)" in
      *"Electron Helper"*) ;;
      *) echo "$pid" ;;
    esac
  done
}

stop() {
  pids=$(running)
  [ -z "$pids" ] && return 0
  echo "stopping $(echo "$pids" | wc -l | tr -d ' ') running instance(s)"
  # TERM first so main can close its socket and release composition windows; KILL only if it
  # will not go. A composition window outliving its app is a renderer process nothing reclaims.
  for pid in $pids; do kill "$pid" 2>/dev/null || true; done
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ -z "$(running)" ] && return 0
    sleep 0.3
  done
  for pid in $(running); do kill -9 "$pid" 2>/dev/null || true; done
  sleep 0.5
}

stop
[ "$MODE" = stop ] && { echo "stopped."; exit 0; }

if [ "$MODE" = dev ]; then
  echo "▶ electron-vite dev (renderer HMR; main changes still need a restart)"
  if [ "$GATE" = 1 ]; then unset BAY_ACCESS; else BAY_ACCESS=dev; export BAY_ACCESS; fi
  exec pnpm dev
fi

if [ "$MODE" = build ]; then
  echo "▶ building"
  pnpm build
else
  # Say it rather than let a stale bundle pass for a fresh one.
  built=$(find out -name '*.js' -newer package.json 2>/dev/null | head -1 || true)
  [ -z "$built" ] && echo "!  --no-build, and out/ looks older than package.json" \
                  || echo "!  --no-build: running whatever is already in out/"
fi

[ -f out/main/index.js ] || { echo "run.sh: out/main/index.js is missing — run without --no-build" >&2; exit 1; }

if [ "$GATE" = 1 ]; then
  echo "▶ starting one instance on port $PORT (access gate ON: sign-in screen, MCP locked)"
  unset BAY_ACCESS
else
  echo "▶ starting one instance on port $PORT (BAY_ACCESS=dev: access check skipped)"
  BAY_ACCESS=dev
  export BAY_ACCESS
fi
# MCP clients are off by default (Preferences › Agent); a dev run opens bay-mcp.sock so terminal
# clients and the probes in test/app/ that use it can connect.
BAY_MCP_CLIENTS=1
export BAY_MCP_CLIENTS
./node_modules/.bin/electron . \
  --remote-debugging-port="$PORT" \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --disable-background-timer-throttling &
pid=$!

# Report what actually came up, rather than assuming the spawn worked.
#
# The check asks whether the debugging port is serving OUR renderer, not merely whether
# something answers there. A stale Electron from an earlier run holds the port, the new one
# prints `bind() failed: Address already in use` to stderr and carries on without devtools, and
# a bare `/json/version` probe answers happily — from the wrong app. That is how the first
# version of this script reported "bay is up · CDP 9222" about a process it had failed to start
# a debugger for.
ours="$here/out/renderer/index.html"
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  sleep 0.5
  if curl -sf "http://127.0.0.1:$PORT/json" 2>/dev/null | grep -qF "$ours"; then
    echo "✔ bay is up  ·  pid $pid  ·  CDP http://127.0.0.1:$PORT"
    echo "  probes:  node test/app/agent-gate.mjs"
    echo "  stop:    ./run.sh --stop"
    wait "$pid"
    exit $?
  fi
  kill -0 "$pid" 2>/dev/null || { echo "run.sh: the app exited during startup" >&2; wait "$pid"; exit 1; }
done

if curl -sf "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "run.sh: port $PORT is answering, but not for this app — something else holds it." >&2
  echo "  who:  lsof -nP -iTCP:$PORT -sTCP:LISTEN" >&2
  echo "  then: ./run.sh --stop && ./run.sh   (or ./run.sh --port=9223)" >&2
else
  echo "run.sh: started, but the debugging port never answered — probes cannot attach." >&2
fi
wait "$pid"
