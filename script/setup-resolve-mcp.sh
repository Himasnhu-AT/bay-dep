#!/usr/bin/env bash
# Set up bay's DaVinci Resolve connector: samuelgursky/davinci-resolve-mcp (MIT) at a pinned
# commit, a Python 3.11 venv beside it, and its bridge script in Resolve's Scripts menu.
#
#   script/setup-resolve-mcp.sh                      # into <repo>/vendor/davinci-resolve-mcp
#   script/setup-resolve-mcp.sh --dir <path>         # e.g. bay's "<userData>/resolve-mcp"
#   script/setup-resolve-mcp.sh --set-python-home    # also tell Resolve where Python 3.11 is
#
# Safe to run again: each step is skipped when it is already done. This is the only thing that
# fetches the connector; bay itself never downloads it (src/main/resolve/).
set -euo pipefail

REPO_URL="https://github.com/samuelgursky/davinci-resolve-mcp.git"
# v2.103.3 — the commit bay's use of the connector was verified against.
PIN="99a45e3abcba098dbc2db7db61d6ae6183831de2"
PYTHON_VERSION="3.11"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$ROOT/vendor/davinci-resolve-mcp"
SET_PYTHON_HOME=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)
      [ $# -ge 2 ] || { echo "--dir needs a path" >&2; exit 2; }
      DIR="$2"
      shift 2
      ;;
    --set-python-home)
      SET_PYTHON_HOME=1
      shift
      ;;
    -h | --help)
      /usr/bin/sed -n '2,10p' "${BASH_SOURCE[0]}" | /usr/bin/sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $1 (see --help)" >&2
      exit 2
      ;;
  esac
done

say() { printf '\n== %s\n' "$*"; }

command -v git >/dev/null || { echo "git is not installed." >&2; exit 1; }
command -v uv >/dev/null || {
  echo "uv is not installed. It provides the Python $PYTHON_VERSION the Resolve API needs:" >&2
  echo "  brew install uv" >&2
  exit 1
}

# uv's default timeout is 30 seconds, which a slow connection does not meet.
export UV_HTTP_TIMEOUT=900

# ── 1. The connector's source, at the pinned commit ──────────────────────────────────────────
say "Connector source in $DIR"
if [ -d "$DIR/.git" ]; then
  HEAD_NOW="$(git -C "$DIR" rev-parse HEAD)"
  if [ "$HEAD_NOW" = "$PIN" ]; then
    echo "Already at $PIN."
  else
    echo "At $HEAD_NOW; moving to $PIN."
    if ! git -C "$DIR" cat-file -e "$PIN^{commit}" 2>/dev/null; then
      git -C "$DIR" fetch origin "$PIN"
    fi
    git -C "$DIR" checkout --detach "$PIN"
  fi
elif [ -e "$DIR" ] && [ -n "$(/bin/ls -A "$DIR" 2>/dev/null)" ]; then
  echo "$DIR exists, is not empty and is not a git clone. Move it aside or pass another --dir." >&2
  exit 1
else
  /bin/mkdir -p "$DIR"
  git -C "$DIR" init --quiet
  git -C "$DIR" remote add origin "$REPO_URL"
  git -C "$DIR" fetch --depth 1 origin "$PIN"
  git -C "$DIR" checkout --detach FETCH_HEAD
fi
[ -f "$DIR/src/server.py" ] || { echo "$DIR/src/server.py is missing after checkout." >&2; exit 1; }

# ── 2. A Python 3.11 venv with the server's requirements ─────────────────────────────────────
VENV="$DIR/venv"
PY="$VENV/bin/python"
say "Python $PYTHON_VERSION environment in $VENV"
if [ -x "$PY" ] && "$PY" -c "import sys; sys.exit(0 if sys.version_info[:2] == (3, 11) else 1)"; then
  echo "Already there: $("$PY" --version)."
else
  # The system python3 may be newer than Resolve's scripting library supports; uv manages 3.11.
  [ -e "$VENV" ] && /bin/rm -rf "$VENV"
  uv venv --python "$PYTHON_VERSION" "$VENV"
fi
uv pip install --python "$PY" -r "$DIR/requirements.txt"
"$PY" -c "import mcp.server.fastmcp" || { echo "The mcp package did not install." >&2; exit 1; }

# ── 3. The bridge script, in Resolve's Scripts menu ──────────────────────────────────────────
# The free edition refuses outside scripts; the bridge runs inside Resolve instead. The
# installer keeps an existing token (~/.config/davinci-resolve-mcp/bridge.json) and rewrites
# the copies in Resolve's Scripts/Utility folder.
say "Bridge script in Resolve's Scripts menu"
# Captured first, so a failed install stops the script; its own "Next:" steps are about a
# probe bay does not use, and are replaced by the last lines here.
INSTALL_OUT="$("$PY" "$DIR/scripts/install_resolve_bridge.py")"
printf '%s\n' "$INSTALL_OUT" | /usr/bin/sed -n '/^Next:/q;p'
BRIDGE="$HOME/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility/resolve_bridge.py"
if [ -f "$BRIDGE" ]; then
  echo "Installed: $BRIDGE"
else
  echo "The bridge script is not at $BRIDGE. Is DaVinci Resolve installed?" >&2
fi

# ── 4. Whether Resolve will find a Python to run it with ─────────────────────────────────────
# Resolve looks at PYTHON3HOME (launchd's, not a shell's), then /usr/local/bin/python3. With
# neither it lists no .py script at all, and says nothing.
say "Python as Resolve sees it"
PY_PREFIX="$("$PY" -c 'import sys; print(sys.base_prefix)')"
LAUNCHD_HOME="$(launchctl getenv PYTHON3HOME 2>/dev/null || true)"
if [ "$SET_PYTHON_HOME" = 1 ]; then
  launchctl setenv PYTHON3HOME "$PY_PREFIX"
  LAUNCHD_HOME="$PY_PREFIX"
  echo "Set PYTHON3HOME=$PY_PREFIX for apps launched from now until the next login."
fi
if [ -n "$LAUNCHD_HOME" ]; then
  echo "PYTHON3HOME (launchd) = $LAUNCHD_HOME"
  if ! /bin/ls "$LAUNCHD_HOME"/lib/libpython3.*.dylib >/dev/null 2>&1; then
    echo "  It holds no lib/libpython3.*.dylib, so Resolve cannot load it. Run:"
    echo "    launchctl setenv PYTHON3HOME \"$PY_PREFIX\""
  fi
elif [ -e /usr/local/bin/python3 ]; then
  FALLBACK="$(/usr/local/bin/python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || echo unknown)"
  echo "PYTHON3HOME is not set for launchd; Resolve will use /usr/local/bin/python3 (Python $FALLBACK)."
  echo "  If resolve_bridge does not appear under Workspace > Scripts, point Resolve at 3.11:"
  echo "    launchctl setenv PYTHON3HOME \"$PY_PREFIX\""
  echo "  (or run this script again with --set-python-home), then restart Resolve."
else
  echo "Resolve will NOT find a Python: PYTHON3HOME is not set for launchd and there is no"
  echo "/usr/local/bin/python3. Its Scripts menu will list no Python script. Run:"
  echo "    launchctl setenv PYTHON3HOME \"$PY_PREFIX\""
  echo "  (or run this script again with --set-python-home). It lasts until the next login."
fi

say "Done"
echo "Next: restart DaVinci Resolve, open a project, then choose Workspace > Scripts > resolve_bridge."
echo "The bridge is needed once each time Resolve starts. Then check again in bay."
