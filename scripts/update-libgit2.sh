#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

LIBGIT2_DIR="${LIBGIT2_DIR:-$PROJECT_DIR/vendor/libgit2}"
REMOTE_URL="${LIBGIT2_REMOTE:-https://github.com/libgit2/libgit2.git}"

REF=""

usage() {
  cat <<'USAGE'
Usage: scripts/update-libgit2.sh [options]

Options:
  --ref <ref>      Update the submodule to a specific ref (commit/tag/branch).
  --help, -h       Show this help message.

Environment:
  LIBGIT2_DIR         Override libgit2 source directory (default: vendor/libgit2)
  LIBGIT2_REMOTE      Override libgit2 remote URL
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

if [[ "$LIBGIT2_DIR" == "$PROJECT_DIR/vendor/libgit2" ]]; then
  git submodule update --init --recursive "$LIBGIT2_DIR"
fi

if [[ ! -d "$LIBGIT2_DIR" ]]; then
  echo "Error: libgit2 directory not found at $LIBGIT2_DIR" >&2
  echo "Run: git submodule update --init --recursive vendor/libgit2" >&2
  exit 1
fi

if git -C "$LIBGIT2_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "$LIBGIT2_DIR" remote set-url origin "$REMOTE_URL" >/dev/null 2>&1 || true
fi

if ! git -C "$LIBGIT2_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: $LIBGIT2_DIR is not a git repository; cannot update." >&2
  exit 1
fi

git -C "$LIBGIT2_DIR" fetch origin --tags --force

if [[ -n "$REF" ]]; then
  target_ref="$REF"
else
  target_ref="$(git -C "$LIBGIT2_DIR" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || true)"
  if [[ -z "$target_ref" ]]; then
    target_ref="origin/main"
  fi
fi

target_commit="$(git -C "$LIBGIT2_DIR" rev-parse "$target_ref")"

git -C "$LIBGIT2_DIR" reset --hard HEAD
git -C "$LIBGIT2_DIR" clean -fd
git -C "$LIBGIT2_DIR" checkout --detach "$target_commit"
echo "Pinned libgit2 to $target_commit"
echo "Remember to commit the new submodule pointer: git add vendor/libgit2"
