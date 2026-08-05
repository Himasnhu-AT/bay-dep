#!/usr/bin/env bash
# Build the vii native editor in release mode.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/rust"
cargo build --release -p opencut-desktop "$@"
echo "Release binary: $ROOT/rust/target/release/opencut"
