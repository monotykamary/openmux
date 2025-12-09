#!/usr/bin/env bash
set -euo pipefail

# Publish openmux to npm
# This script verifies GitHub release exists before publishing

REPO="monotykamary/openmux"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}⚠${NC} %s\n" "$1"; }
error() { printf "${RED}✗${NC} %s\n" "$1" >&2; exit 1; }

cd "$PROJECT_DIR"

# Get version from package.json
VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
TAG="v$VERSION"

echo ""
echo "Publishing openmux $TAG to npm"
echo "─────────────────────────────────"
echo ""

# Check if logged into npm
if ! npm whoami &>/dev/null; then
    error "Not logged into npm. Run 'npm login' first."
fi
info "Logged into npm as $(npm whoami)"

# Check for uncommitted changes
if [[ -n $(git status --porcelain) ]]; then
    error "Working directory has uncommitted changes. Commit or stash them first."
fi
info "Working directory clean"

# Check if tag exists
if ! git rev-parse "$TAG" &>/dev/null; then
    error "Tag $TAG does not exist. Run 'bun run release' first."
fi
info "Tag $TAG exists"

# Check if GitHub release exists with binaries
echo ""
echo "Checking GitHub release..."

RELEASE_URL="https://api.github.com/repos/$REPO/releases/tags/$TAG"
RELEASE_DATA=$(curl -fsSL "$RELEASE_URL" 2>/dev/null || echo "")

if [[ -z "$RELEASE_DATA" ]]; then
    error "GitHub release for $TAG not found. Wait for GitHub Actions to complete."
fi

# Check for expected assets
ASSETS=$(echo "$RELEASE_DATA" | grep -o '"name": *"openmux-[^"]*\.tar\.gz"' | wc -l)
if [[ "$ASSETS" -lt 3 ]]; then
    warn "Expected 3 binary assets, found $ASSETS"
    echo ""
    echo "Available assets:"
    echo "$RELEASE_DATA" | grep -o '"name": *"[^"]*"' | sed 's/"name": *"/  - /' | sed 's/"$//'
    echo ""
    read -p "Continue anyway? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    info "GitHub release has $ASSETS binary assets"
fi

# Dry run first
echo ""
echo "Running npm pack (dry run)..."
npm pack --dry-run

echo ""
read -p "Publish to npm? [y/N] " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    npm publish
    echo ""
    info "Published openmux@$VERSION to npm!"
    echo ""
    echo "Users can now install with:"
    echo "  npm install -g openmux"
    echo "  bun add -g openmux"
else
    echo "Aborted."
fi
