#!/usr/bin/env bash
# Provision the Kokoro text-to-speech sidecar bay shells out to for narration.
#
#   ./script/setup-speech.sh           create the venv if it is missing, else do nothing
#   ./script/setup-speech.sh --check   report status only, never install (exit 1 if absent)
#   ./script/setup-speech.sh --force   rebuild the venv from scratch
#
# Idempotent by design: build.sh calls it on every build, so the common case must cost a
# single interpreter start rather than re-resolving a ~2 GB dependency tree.
#
# Location is overridable with BAY_KOKORO_PYTHON (the Rust side reads the same variable), so a
# machine that keeps its virtualenvs elsewhere does not have to patch anything.
set -euo pipefail

VENV="${BAY_SPEECH_VENV:-$HOME/.local/share/bay/kokoro-venv}"
PYTHON="${BAY_KOKORO_PYTHON:-$VENV/bin/python}"
SPACY_MODEL="https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl"

MODE="install"
for arg in "$@"; do
  case "$arg" in
    --check) MODE="check" ;;
    --force) MODE="force" ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# The sidecar needs kokoro AND spaCy's English model — misaki's G2P otherwise tries to install
# the latter at runtime, which shells out to pip from inside the server and fails.
is_ready() {
  [ -x "$PYTHON" ] && "$PYTHON" - <<'PY' >/dev/null 2>&1
import importlib.util, sys
sys.exit(0 if all(importlib.util.find_spec(m) for m in ("kokoro", "en_core_web_sm")) else 1)
PY
}

if is_ready; then
  if [ "$MODE" = "force" ]; then
    echo "── speech: rebuilding $VENV ──"
    rm -rf "$VENV"
  else
    echo "✓ speech sidecar ready ($PYTHON)"
    exit 0
  fi
elif [ "$MODE" = "check" ]; then
  echo "✗ speech sidecar not installed at $PYTHON"
  echo "  run: ./script/setup-speech.sh"
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  cat >&2 <<'EOF'
✗ uv is required to provision the speech sidecar.

  Install it:  curl -LsSf https://astral.sh/uv/install.sh | sh
  Or point bay at an existing interpreter that has kokoro:
               export BAY_KOKORO_PYTHON=/path/to/python

Narration is optional — everything else in bay works without it.
EOF
  exit 1
fi

echo "── speech: provisioning Kokoro into $VENV ──"
echo "   (a few hundred MB of torch; one time)"
mkdir -p "$(dirname "$VENV")"
uv venv --python 3.12 "$VENV"
uv pip install --python "$PYTHON" "kokoro>=0.9.4" soundfile
# Pre-installed rather than left to runtime: misaki's English G2P calls spacy.load() and, when
# the model is absent, shells out to pip — which fails inside the sidecar and takes narration
# down with an error that points nowhere useful.
uv pip install --python "$PYTHON" "en_core_web_sm @ $SPACY_MODEL"

if is_ready; then
  echo "✓ speech sidecar ready ($PYTHON)"
  echo "  optional: brew install espeak-ng   # out-of-dictionary words, non-English"
else
  echo "✗ provisioning finished but kokoro still does not import — see the output above" >&2
  exit 1
fi
