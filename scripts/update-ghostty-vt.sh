#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

GHOSTTY_DIR="${GHOSTTY_VT_DIR:-$PROJECT_DIR/vendor/ghostty}"
PATCH_FILE="$PROJECT_DIR/scripts/ghostty-vt.patch"
REMOTE_URL="${GHOSTTY_VT_REMOTE:-https://github.com/ghostty-org/ghostty.git}"

MODE="update"
REF=""

usage() {
  cat <<'EOF'
Usage: scripts/update-ghostty-vt.sh [options]

Options:
  --patch-only     Apply the ghostty-vt patch without updating the submodule.
  --ref <ref>      Update the submodule to a specific ref (commit/tag/branch).
  --help, -h       Show this help message.

Environment:
  GHOSTTY_VT_DIR     Override ghostty source directory (default: vendor/ghostty)
  GHOSTTY_VT_REMOTE  Override ghostty remote URL
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --patch-only)
      MODE="patch"
      shift
      ;;
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

if [[ ! -f "$PATCH_FILE" ]]; then
  echo "Error: patch file not found at $PATCH_FILE" >&2
  exit 1
fi

if [[ "$GHOSTTY_DIR" == "$PROJECT_DIR/vendor/ghostty" ]]; then
  git submodule update --init --recursive "$GHOSTTY_DIR"
fi

if [[ ! -d "$GHOSTTY_DIR" ]]; then
  echo "Error: ghostty directory not found at $GHOSTTY_DIR" >&2
  echo "Run: git submodule update --init --recursive vendor/ghostty" >&2
  exit 1
fi

if git -C "$GHOSTTY_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "$GHOSTTY_DIR" remote set-url origin "$REMOTE_URL" >/dev/null 2>&1 || true
fi

if [[ "$MODE" == "update" ]]; then
  if ! git -C "$GHOSTTY_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "Error: $GHOSTTY_DIR is not a git repository; cannot update." >&2
    exit 1
  fi

  git -C "$GHOSTTY_DIR" fetch origin --tags

  if [[ -n "$REF" ]]; then
    target_ref="$REF"
  else
    target_ref="$(git -C "$GHOSTTY_DIR" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || true)"
    if [[ -z "$target_ref" ]]; then
      target_ref="origin/main"
    fi
  fi

  target_commit="$(git -C "$GHOSTTY_DIR" rev-parse "$target_ref")"
  git -C "$GHOSTTY_DIR" checkout --detach "$target_commit"
  echo "Pinned ghostty to $target_commit"
fi

if git -C "$GHOSTTY_DIR" apply --reverse --check --whitespace=nowarn "$PATCH_FILE" >/dev/null 2>&1; then
  echo "ghostty-vt patch already applied."
else
  err_file="$(mktemp)"
  if ! git -C "$GHOSTTY_DIR" apply --whitespace=nowarn "$PATCH_FILE" 2> "$err_file"; then
    cat "$err_file" >&2
    rm -f "$err_file"
    echo "" >&2
    echo "ghostty-vt patch failed to apply. Update scripts/ghostty-vt.patch or adjust for upstream changes." >&2
    exit 1
  fi
  rm -f "$err_file"
  echo "Applied ghostty-vt patch."
fi

if [[ "$MODE" == "update" ]]; then
  echo "Remember to commit the new submodule pointer: git add vendor/ghostty"
fi
