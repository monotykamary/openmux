#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

wrapper_dir="$PROJECT_DIR/native/zig-ghostty-wrapper"
if [[ ! -d "$wrapper_dir" ]]; then
  echo "Error: zig-ghostty-wrapper directory not found at $wrapper_dir"
  exit 1
fi

if ! command -v zig &> /dev/null; then
  echo "Error: zig compiler not found. Please install Zig: https://ziglang.org/download/"
  exit 1
fi

cd "$wrapper_dir"
zig build test --summary all
zig build
cd "$PROJECT_DIR"

bun scripts/test-zig-ghostty-wrapper-smoke.ts
