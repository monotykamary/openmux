#!/usr/bin/env bash
set -euo pipefail

# openmux installer
# Usage: curl -fsSL https://raw.githubusercontent.com/monotykamary/openmux/main/scripts/install.sh | bash

REPO="monotykamary/openmux"
OPENMUX_HOME="${OPENMUX_HOME:-$HOME/.openmux}"
BIN_DIR="$OPENMUX_HOME/bin"

# Colors for output
BOLD='\033[1m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

spinner() {
    local pid=$1
    local spin='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    local i=0
    while kill -0 "$pid" 2>/dev/null; do
        printf "\r  %s %s" "${spin:i++%${#spin}:1}" "$2"
        sleep 0.1
    done
    printf "\r\033[K"
}

error() {
    printf "  ${RED}✗${NC} %s\n" "$1" >&2
    exit 1
}

detect_platform() {
    local os arch

    os="$(uname -s)"
    arch="$(uname -m)"

    case "$os" in
        Darwin) OS="darwin" ;;
        Linux) OS="linux" ;;
        *) error "Unsupported operating system: $os" ;;
    esac

    case "$arch" in
        x86_64|amd64) ARCH="x64" ;;
        arm64|aarch64) ARCH="arm64" ;;
        *) error "Unsupported architecture: $arch" ;;
    esac

    TARGET="${OS}-${ARCH}"

    # Library extension
    case "$OS" in
        darwin) LIB_EXT="dylib" ;;
        linux) LIB_EXT="so" ;;
    esac
}

get_latest_version() {
    if command -v curl &> /dev/null; then
        VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
    elif command -v wget &> /dev/null; then
        VERSION=$(wget -qO- "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
    else
        error "curl or wget is required"
    fi

    if [[ -z "$VERSION" ]]; then
        error "Failed to fetch latest version"
    fi
}

download_and_extract() {
    local url="https://github.com/$REPO/releases/download/$VERSION/openmux-$VERSION-$TARGET.tar.gz"
    local tmp_dir

    tmp_dir=$(mktemp -d)
    trap 'rm -rf "$tmp_dir"' EXIT

    mkdir -p "$BIN_DIR"

    # Download with spinner
    if command -v curl &> /dev/null; then
        curl -fsSL "$url" -o "$tmp_dir/openmux.tar.gz" 2>/dev/null &
    else
        wget -q "$url" -O "$tmp_dir/openmux.tar.gz" 2>/dev/null &
    fi
    spinner $! "Downloading..."
    wait $! || error "Download failed"
    printf "  ${GREEN}✓${NC} Downloaded\n"

    # Extract with spinner
    tar -xzf "$tmp_dir/openmux.tar.gz" -C "$tmp_dir" &
    spinner $! "Extracting..."
    wait $!
    printf "  ${GREEN}✓${NC} Extracted\n"

    # Move files to ~/.openmux/bin/
    mv "$tmp_dir/openmux" "$BIN_DIR/"
    mv "$tmp_dir/openmux-bin" "$BIN_DIR/"
    mv "$tmp_dir/libzig_pty.$LIB_EXT" "$BIN_DIR/"
    mv "$tmp_dir/libghostty-vt.$LIB_EXT" "$BIN_DIR/" || true
    mv "$tmp_dir/bunfig.toml" "$BIN_DIR/" || true
    chmod +x "$BIN_DIR/openmux-bin" "$BIN_DIR/openmux"

    # Write version file
    echo "${VERSION#v}" > "$BIN_DIR/.version"

    printf "  ${GREEN}✓${NC} Installed to $BIN_DIR\n"
}

check_path() {
    if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
        printf "\n"
        printf "  ${YELLOW}!${NC} Add to your PATH:\n"
        printf "\n"

        local shell_name
        shell_name=$(basename "$SHELL")

        case "$shell_name" in
            bash)
                printf "    echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.bashrc\n"
                printf "    source ~/.bashrc\n"
                ;;
            zsh)
                printf "    echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.zshrc\n"
                printf "    source ~/.zshrc\n"
                ;;
            fish)
                printf "    fish_add_path $BIN_DIR\n"
                ;;
            *)
                printf "    export PATH=\"$BIN_DIR:\$PATH\"\n"
                ;;
        esac
    fi
}

main() {
    printf "\n"
    printf "  ${BOLD}openmux${NC} installer\n"
    printf "\n"

    detect_platform
    get_latest_version

    printf "  Installing ${BOLD}openmux${NC} %s (%s)\n" "$VERSION" "$TARGET"
    printf "\n"

    download_and_extract
    check_path

    printf "\n"
    printf "  ${GREEN}Done!${NC} Run 'openmux' to start.\n"
    printf "\n"
}

main
