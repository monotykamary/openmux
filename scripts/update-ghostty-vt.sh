#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

GHOSTTY_DIR="${GHOSTTY_VT_DIR:-$PROJECT_DIR/vendor/ghostty}"
REMOTE_URL="${GHOSTTY_VT_REMOTE:-https://github.com/ghostty-org/ghostty.git}"

REF=""

usage() {
  cat <<'USAGE'
Usage: scripts/update-ghostty-vt.sh [options]

Options:
  --ref <ref>      Update the submodule to a specific ref (commit/tag/branch).
  --help, -h       Show this help message.

Environment:
  GHOSTTY_VT_DIR     Override ghostty source directory (default: vendor/ghostty)
  GHOSTTY_VT_REMOTE  Override ghostty remote URL
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref)
      REF="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$GHOSTTY_DIR" == "$PROJECT_DIR/vendor/ghostty" ]]; then
  git submodule update --init --recursive "$GHOSTTY_DIR"
fi

if [[ ! -d "$GHOSTTY_DIR" ]]; then
  echo "Error: ghostty directory not found at $GHOSTTY_DIR" >&2
  echo "Run: git submodule update --init --recursive vendor/ghostty" >&2
  exit 1
fi

if ! git -C "$GHOSTTY_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: $GHOSTTY_DIR is not a git repository; cannot update." >&2
  exit 1
fi

git -C "$GHOSTTY_DIR" remote set-url origin "$REMOTE_URL" >/dev/null 2>&1 || true

git -C "$GHOSTTY_DIR" fetch origin --tags --force

if [[ -n "$REF" ]]; then
  target_ref="$REF"
else
  target_ref="$(git -C "$GHOSTTY_DIR" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || true)"
  if [[ -z "$target_ref" ]]; then
    target_ref="origin/main"
  fi
fi

target_commit="$(git -C "$GHOSTTY_DIR" rev-parse "$target_ref")"

git -C "$GHOSTTY_DIR" reset --hard HEAD
git -C "$GHOSTTY_DIR" clean -fd
git -C "$GHOSTTY_DIR" checkout --detach "$target_commit"

echo "Pinned ghostty to $target_commit"
echo "Remember to commit the new submodule pointer: git add vendor/ghostty"
