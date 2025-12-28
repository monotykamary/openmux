#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GHOSTTY_SCRIPT="$SCRIPT_DIR/update-ghostty-vt.sh"
LIBGIT2_SCRIPT="$SCRIPT_DIR/update-libgit2.sh"

MODE="update"
REF=""
GHOSTTY_REF=""
LIBGIT2_REF=""

usage() {
  cat <<'USAGE'
Usage: scripts/update-submodules.sh [options]

Options:
  --patch-only        Apply patches without updating submodules.
  --ref <ref>         Update both submodules to a specific ref (commit/tag/branch).
  --ghostty-ref <ref> Update ghostty submodule to a specific ref.
  --libgit2-ref <ref> Update libgit2 submodule to a specific ref.
  --help, -h          Show this help message.

Notes:
  For different refs per submodule, use --ghostty-ref and --libgit2-ref.
USAGE
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
    --ghostty-ref)
      GHOSTTY_REF="${2:-}"
      shift 2
      ;;
    --libgit2-ref)
      LIBGIT2_REF="${2:-}"
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

if [[ "$MODE" == "patch" ]]; then
  "$GHOSTTY_SCRIPT" --patch-only
  "$LIBGIT2_SCRIPT" --patch-only
  exit 0
fi

if [[ -n "$GHOSTTY_REF" ]]; then
  ghostty_args=(--ref "$GHOSTTY_REF")
elif [[ -n "$REF" ]]; then
  ghostty_args=(--ref "$REF")
else
  ghostty_args=()
fi

if [[ -n "$LIBGIT2_REF" ]]; then
  libgit2_args=(--ref "$LIBGIT2_REF")
elif [[ -n "$REF" ]]; then
  libgit2_args=(--ref "$REF")
else
  libgit2_args=()
fi

"$GHOSTTY_SCRIPT" "${ghostty_args[@]}"
"$LIBGIT2_SCRIPT" "${libgit2_args[@]}"
