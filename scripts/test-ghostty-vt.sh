#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

ghostty_dir="${GHOSTTY_VT_DIR:-$PROJECT_DIR/ghostty}"
if [[ ! -d "$ghostty_dir" ]]; then
  ghostty_dir="$PROJECT_DIR/vendor/ghostty"
fi

if [[ ! -d "$ghostty_dir" ]]; then
  echo "Error: ghostty directory not found. Set GHOSTTY_VT_DIR or add ghostty sources."
  exit 1
fi

if [[ ! -f "$ghostty_dir/include/ghostty/vt/terminal.h" ]]; then
  GHOSTTY_VT_DIR="$ghostty_dir" "$PROJECT_DIR/scripts/update-ghostty-vt.sh" --patch-only
fi

if [[ ! -f "$ghostty_dir/include/ghostty/vt/terminal.h" ]]; then
  echo "Error: ghostty-vt patch missing (include/ghostty/vt/terminal.h not found)."
  echo "Run: scripts/update-ghostty-vt.sh --patch-only"
  exit 1
fi

if ! command -v zig &> /dev/null; then
  echo "Error: zig compiler not found. Please install Zig: https://ziglang.org/download/"
  exit 1
fi

ghostty_version=$(grep -E 'version = "' "$ghostty_dir/build.zig.zon" | head -1 | sed -E 's/.*version = "([^"]+)".*/\1/')
if [[ -z "$ghostty_version" ]]; then
  echo "Error: could not determine ghostty version from $ghostty_dir/build.zig.zon"
  exit 1
fi

cd "$ghostty_dir"
zig build test-lib-vt -Dversion-string="$ghostty_version"
