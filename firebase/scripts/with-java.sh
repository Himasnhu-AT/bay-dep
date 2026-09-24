#!/bin/sh
# Runs a command with a Java on PATH for the Firestore emulator. macOS's /usr/bin/java is a stub
# that fails when no JDK is registered, and Homebrew's openjdk is keg-only (not on PATH), so a
# clean shell had no usable Java and `pnpm test` could not start. Order: $JAVA_HOME, then a
# working `java` already on PATH, then Homebrew's openjdk@26 / openjdk.
set -eu
if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then
  PATH="$JAVA_HOME/bin:$PATH"
elif ! java -version >/dev/null 2>&1; then
  for p in /opt/homebrew/opt/openjdk@26 /opt/homebrew/opt/openjdk /usr/local/opt/openjdk; do
    if [ -x "$p/bin/java" ]; then PATH="$p/bin:$PATH"; break; fi
  done
fi
export PATH
java -version >/dev/null 2>&1 || { echo "No Java for the Firestore emulator: install one (brew install openjdk) or set JAVA_HOME." >&2; exit 1; }
exec "$@"
