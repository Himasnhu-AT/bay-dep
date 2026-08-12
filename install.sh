#!/usr/bin/env bash
# Build bay, install it into /Applications, run it, and prove the copy that is running is the
# copy that was just built.
#
#   ./install.sh --bump minor       0.0.1 — 1.2.56 → 1.2.57
#   ./install.sh --bump major       0.1.0 — 1.2.56 → 1.3.0
#   ./install.sh --bump release     1.0.0 — 1.2.56 → 2.0.0
#   ./install.sh                    asks which, if there is a terminal to ask on
#   ./install.sh --arch aarch64     this machine's architecture only — much faster, for testing
#   ./install.sh --no-start         install and verify the files, but do not launch
#   ./install.sh --dest ~/Applications
#
# **Every install bumps the version.** A bump rewrites rust/desktop/Cargo.toml before building,
# and everything downstream follows: the .dmg filename, Info.plist, `bay --version`, and the
# check at the end. Each level resets the ones below it, so a release never inherits a stale
# patch number.
#
# It is compulsory because the final check is only worth something if the number changes. Two
# builds at the same version are indistinguishable to every test this script runs — Info.plist
# would agree, the binary would agree, the running process would agree, and all three would
# agree just as loudly if the install had silently not happened at all.
#
# Why it installs *from the .dmg* rather than copying `dist/macos/bay.app` directly: the .dmg is
# the artifact a user downloads, so it is the one worth exercising. Copying the .app beside it
# would test a file that nobody receives and would not notice a .dmg that was built empty or
# unreadable.
#
# The version check at the end is the point of the script. "It built" and "it launched" are both
# true of a stale binary — the previous copy stays in /Applications and keeps working, so a build
# that silently failed to be installed looks exactly like a successful install until someone
# hunts for a feature that is missing. Three independent places have to agree on the version, and
# the last of them is read out of the running process.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

APP_NAME="bay"
BUNDLE_ID="dev.bay.editor"
DEST="/Applications"
START=1
BUNDLE_ARGS=(--dmg)
BUMP=""
MANIFEST="rust/desktop/Cargo.toml"

while [ $# -gt 0 ]; do
  case "$1" in
    --bump) shift; BUMP="${1:?--bump needs minor, major or release}" ;;
    --no-start) START=0 ;;
    --dest) shift; DEST="${1:?--dest needs a directory}" ;;
    --arch) shift; BUNDLE_ARGS+=(--arch "${1:?--arch needs a value}") ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

DEST="${DEST/#\~/$HOME}"
INSTALLED="$DEST/$APP_NAME.app"

CURRENT="$(grep -m1 '^version' "$MANIFEST" | cut -d'"' -f2)"
[ -n "$CURRENT" ] || { echo "install: could not read a version from $MANIFEST" >&2; exit 1; }
[[ "$CURRENT" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "install: $MANIFEST says version \"$CURRENT\", which is not major.minor.patch — bump it by hand" >&2
  exit 1
}

# Each level resets everything below it. That reset is the reason this is arithmetic rather than
# a string edit: shipping 2.0.56 because a release inherited the previous patch number is the
# exact mistake the three names exist to prevent.
bumped() {
  local IFS=.
  read -r major minor patch <<<"$CURRENT"
  case "$1" in
    minor)   patch=$((patch + 1)) ;;
    major)   minor=$((minor + 1)); patch=0 ;;
    release) major=$((major + 1)); minor=0; patch=0 ;;
    *) return 1 ;;
  esac
  printf '%s.%s.%s' "$major" "$minor" "$patch"
}

if [ -z "$BUMP" ]; then
  # No flag. Ask, when there is someone to ask — and refuse otherwise rather than picking a
  # level on a person's behalf. A script that guessed here would silently decide what a version
  # number means, which is a judgement that belongs to whoever is shipping.
  if [ ! -t 0 ]; then
    echo "install: --bump is required (minor, major or release). Nothing is attached to stdin," >&2
    echo "         so there is no way to ask which." >&2
    exit 2
  fi
  echo "Current version: $CURRENT"
  echo "  1) minor     $(bumped minor)"
  echo "  2) major     $(bumped major)"
  echo "  3) release   $(bumped release)"
  while [ -z "$BUMP" ]; do
    printf 'Which bump? [1-3, or q to cancel] '
    read -r answer
    case "$answer" in
      1|minor)   BUMP=minor ;;
      2|major)   BUMP=major ;;
      3|release) BUMP=release ;;
      q|Q) echo "cancelled — nothing was built or installed."; exit 0 ;;
      *) echo "  pick 1, 2 or 3." ;;
    esac
  done
  echo
fi

EXPECTED="$(bumped "$BUMP")" || {
  echo "install: --bump takes minor, major or release, got \"$BUMP\"" >&2
  exit 2
}

# Written before the build, so the version is compiled in rather than stamped on afterwards.
# Anchored to the first `version =` line, which is the [package] one — a dependency further down
# the file has its own, and rewriting that instead would change what bay is built against.
perl -0pi -e 's/^version = "[^"]*"/version = "'"$EXPECTED"'"/m' "$MANIFEST"
WROTE="$(grep -m1 '^version' "$MANIFEST" | cut -d'"' -f2)"
[ "$WROTE" = "$EXPECTED" ] || {
  echo "install: tried to write $EXPECTED to $MANIFEST and it now reads \"$WROTE\"" >&2
  exit 1
}

echo "── bay $CURRENT → $EXPECTED ($BUMP) → $INSTALLED ──"

# ---------------------------------------------------------------------------- 1. stop
#
# Before building, not after: a bay holding 127.0.0.1:7333 would still be holding it when the new
# copy launches, and the new window would come up unable to serve agents. Quitting the GUI app
# first gives it the chance to save; the registry sweep afterwards catches `bay --mcp`, which has
# no window to quit.
echo "── stopping any running bay ──"
osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1 || true
for _ in 1 2 3 4 5 6 7 8 9 10; do
  pgrep -x "$APP_NAME" >/dev/null 2>&1 || break
  sleep 0.5
done
# Whatever is left is headless or wedged. `bay --agents` is the supported way to ask, but it only
# exists on a copy that is already installed, so fall back to the process name.
pkill -x "$APP_NAME" 2>/dev/null || true
sleep 0.5
if lsof -nP -iTCP:7333 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "install: something still holds 127.0.0.1:7333 after stopping bay:" >&2
  lsof -nP -iTCP:7333 -sTCP:LISTEN >&2
  echo "install: quit it and run again — installing over a live server gives a window that cannot serve agents." >&2
  exit 1
fi

# ---------------------------------------------------------------------------- 2. build
echo "── building ──"
./script/bundle-mac "${BUNDLE_ARGS[@]}"

DMG="$ROOT/dist/macos/$APP_NAME-$EXPECTED.dmg"
[ -f "$DMG" ] || { echo "install: expected a disk image at $DMG, and there is none" >&2; exit 1; }

# ---------------------------------------------------------------------------- 3. replace
#
# Mounted read-only at a private point rather than /Volumes/bay, so this cannot collide with the
# same image already mounted by a double-click, and the trap detaches it on any exit path — a
# failed copy that left an image mounted would make the *next* run fail for a different reason.
MOUNT="$(mktemp -d)"
cleanup() { hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true; rmdir "$MOUNT" 2>/dev/null || true; }
trap cleanup EXIT

echo "── installing from $(basename "$DMG") ──"
hdiutil attach "$DMG" -mountpoint "$MOUNT" -nobrowse -readonly -quiet
STAGED="$MOUNT/$APP_NAME.app"
[ -d "$STAGED" ] || { echo "install: the disk image has no $APP_NAME.app in it" >&2; exit 1; }

# Refuse to delete anything that is not the app this script installs. `rm -rf` against a path
# assembled from a flag is worth one identity check: --dest is a directory a person types, and
# the cost of being wrong is somebody else's application.
if [ -e "$INSTALLED" ]; then
  FOUND_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$INSTALLED/Contents/Info.plist" 2>/dev/null || true)"
  if [ "$FOUND_ID" != "$BUNDLE_ID" ]; then
    echo "install: $INSTALLED is not bay — its bundle id is ${FOUND_ID:-unreadable}, expected $BUNDLE_ID." >&2
    echo "install: refusing to remove it. Move it aside yourself if this is really where bay should go." >&2
    exit 1
  fi
  OLD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INSTALLED/Contents/Info.plist" 2>/dev/null || echo unknown)"
  echo "   removing the installed copy (version $OLD)"
  rm -rf "$INSTALLED"
fi

mkdir -p "$DEST"
# -R rather than `ditto --rsrc`: the bundle came out of a read-only image we just made, so there
# is nothing to preserve that a plain recursive copy loses, and cp reports a partial copy.
cp -R "$STAGED" "$INSTALLED"
cleanup
trap - EXIT

# ---------------------------------------------------------------------------- 4. verify the files
#
# Two reads that do not require running anything: what the bundle claims, and what the binary
# inside it claims. They come from different places — Info.plist is written by the bundler,
# `--version` is compiled in — so agreement means the bundler and the binary were built from the
# same source, and disagreement localises the fault.
BINARY="$INSTALLED/Contents/MacOS/$APP_NAME"
[ -x "$BINARY" ] || { echo "install: no executable at $BINARY" >&2; exit 1; }

PLIST_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INSTALLED/Contents/Info.plist")"
BINARY_VERSION="$("$BINARY" --version | awk '{print $2}')"

fail=0
[ "$PLIST_VERSION" = "$EXPECTED" ] || { echo "install: Info.plist says $PLIST_VERSION, source says $EXPECTED" >&2; fail=1; }
[ "$BINARY_VERSION" = "$EXPECTED" ] || { echo "install: the binary says $BINARY_VERSION, source says $EXPECTED" >&2; fail=1; }
[ "$fail" -eq 0 ] || exit 1

echo "── installed ──"
echo "   source       $EXPECTED   (rust/desktop/Cargo.toml)"
echo "   bundle       $PLIST_VERSION   (Info.plist)"
echo "   binary       $BINARY_VERSION   (bay --version)"

if [ "$START" -eq 0 ]; then
  echo
  echo "Not started (--no-start). Launch with: open -a \"$INSTALLED\""
  exit 0
fi

# ---------------------------------------------------------------------------- 5. run, and ask it
#
# The check that actually matters. Everything above inspects files; this reads the version out of
# the process that is now serving, which is the only way to know the app that came up is the app
# that was just installed rather than a copy macOS had already loaded.
echo "── starting ──"
open -a "$INSTALLED"

SERVED=""
for _ in $(seq 1 40); do
  SERVED="$(curl -s -m 2 -X POST http://127.0.0.1:7333/mcp \
      -H 'Content-Type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"install.sh","version":"1"}}}' \
    | sed -n 's/.*"serverInfo":{[^}]*"version":"\([^"]*\)".*/\1/p')"
  [ -n "$SERVED" ] && break
  sleep 0.5
done

if [ -z "$SERVED" ]; then
  echo "install: bay was launched but nothing answered on 127.0.0.1:7333 within 20s." >&2
  echo "install: the window may still be opening, or it came up unable to serve agents — check with:" >&2
  echo "           \"$BINARY\" --agents" >&2
  exit 1
fi

# The served version is the *engine* crate's (bay-mcp), which is versioned separately from the
# app and is deliberately not bumped by this script — an app release is not an engine release.
# So it is checked against the engine's own manifest, not against the app version: that asserts
# the running process was built from this checkout's engine, and stays quiet across every app
# bump instead of crying wolf on all of them.
ENGINE="$(grep -m1 '^version' rust/crates/bay-mcp/Cargo.toml | cut -d'"' -f2)"
echo "   serving      $SERVED   (MCP serverInfo, engine crate, from the running process)"
if [ -n "$ENGINE" ] && [ "$SERVED" != "$ENGINE" ]; then
  echo "install: the running process serves engine $SERVED, but this checkout's engine is $ENGINE." >&2
  echo "install: something older than the build you just made is answering on 7333." >&2
  exit 1
fi

echo
echo "bay $EXPECTED is installed at $INSTALLED and serving agents on http://127.0.0.1:7333/mcp"
echo "Register it with:  claude mcp add --transport http bay http://127.0.0.1:7333/mcp"
