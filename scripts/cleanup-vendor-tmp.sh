#!/usr/bin/env bash
# Remove .tmp files left in vendor dirs by upstream builds
# (e.g. libgit2 cmake writes git2.h.tmp in the source tree)
find "$(dirname "$0")/../vendor" -name '*.tmp' -type f -delete 2>/dev/null || true
