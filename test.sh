#!/usr/bin/env bash
# Run the Rust test suite (and optionally the web one).
#
#   ./test.sh              cargo fmt --check, clippy -D warnings, cargo test
#   STRICT=1 ./test.sh     also fail if the GPU or ffmpeg is unavailable instead of skipping
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

cd "$ROOT/rust"

echo "── fmt ──"
env -u CARGO_TARGET_DIR cargo fmt --all --check

echo "── clippy ──"
env -u CARGO_TARGET_DIR cargo clippy --workspace --all-targets -- -D warnings

echo "── test ──"
if [ "${STRICT:-0}" = "1" ]; then
  # Turn the graceful GPU/ffmpeg skips into hard failures for capability verification.
  BAY_REQUIRE_GPU=1 BAY_REQUIRE_FFMPEG=1 env -u CARGO_TARGET_DIR cargo test --workspace "$@"
else
  env -u CARGO_TARGET_DIR cargo test --workspace "$@"
fi
