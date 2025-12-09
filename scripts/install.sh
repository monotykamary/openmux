#!/usr/bin/env bash
set -euo pipefail

# openmux installer
# Usage: curl -fsSL https://raw.githubusercontent.com/monotykamary/openmux/main/scripts/install.sh | bash

REPO="monotykamary/openmux"
BINARY_NAME="openmux"
INSTALL_DIR="${OPENMUX_INSTALL_DIR:-$HOME/.local/bin}"
LIB_DIR="${OPENMUX_LIB_DIR:-$HOME/.local/lib/openmux}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info() {
    printf "${BLUE}info${NC}: %s\n" "$1"
}

success() {
    printf "${GREEN}success${NC}: %s\n" "$1"
}

warn() {
    printf "${YELLOW}warn${NC}: %s\n" "$1"
}

error() {
    printf "${RED}error${NC}: %s\n" "$1" >&2
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
    info "Detected platform: $TARGET"
}

get_latest_version() {
    info "Fetching latest version..."

    if command -v curl &> /dev/null; then
        VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
    elif command -v wget &> /dev/null; then
        VERSION=$(wget -qO- "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
    else
        error "curl or wget is required to download openmux"
    fi

    if [[ -z "$VERSION" ]]; then
        error "Failed to fetch latest version. Check https://github.com/$REPO/releases"
    fi

    info "Latest version: $VERSION"
}

download_and_extract() {
    local url="https://github.com/$REPO/releases/download/$VERSION/openmux-$VERSION-$TARGET.tar.gz"
    local tmp_dir

    tmp_dir=$(mktemp -d)
    trap 'rm -rf "$tmp_dir"' EXIT

    info "Downloading from $url"

    if command -v curl &> /dev/null; then
        curl -fsSL "$url" -o "$tmp_dir/openmux.tar.gz" || error "Download failed. Check if release exists for $TARGET"
    else
        wget -q "$url" -O "$tmp_dir/openmux.tar.gz" || error "Download failed. Check if release exists for $TARGET"
    fi

    info "Extracting..."
    tar -xzf "$tmp_dir/openmux.tar.gz" -C "$tmp_dir"

    # Create directories
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$LIB_DIR"

    # Move files
    mv "$tmp_dir/openmux-bin" "$LIB_DIR/"
    chmod +x "$LIB_DIR/openmux-bin"

    # Move native library
    if [[ "$OS" == "darwin" ]]; then
        mv "$tmp_dir/librust_pty.dylib" "$LIB_DIR/"
        LIB_EXT="dylib"
    else
        mv "$tmp_dir/librust_pty.so" "$LIB_DIR/"
        LIB_EXT="so"
    fi

    # Create wrapper script
    cat > "$INSTALL_DIR/$BINARY_NAME" << WRAPPER
#!/usr/bin/env bash
export BUN_PTY_LIB="\${BUN_PTY_LIB:-$LIB_DIR/librust_pty.$LIB_EXT}"
exec "$LIB_DIR/openmux-bin" "\$@"
WRAPPER
    chmod +x "$INSTALL_DIR/$BINARY_NAME"

    success "Installed openmux to $INSTALL_DIR/$BINARY_NAME"
}

check_path() {
    if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
        warn "$INSTALL_DIR is not in your PATH"
        echo ""
        echo "Add it to your shell configuration:"
        echo ""

        local shell_name
        shell_name=$(basename "$SHELL")

        case "$shell_name" in
            bash)
                echo "  echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.bashrc"
                echo "  source ~/.bashrc"
                ;;
            zsh)
                echo "  echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.zshrc"
                echo "  source ~/.zshrc"
                ;;
            fish)
                echo "  fish_add_path $INSTALL_DIR"
                ;;
            *)
                echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
                ;;
        esac
        echo ""
    fi
}

verify_installation() {
    if [[ -x "$INSTALL_DIR/$BINARY_NAME" ]]; then
        success "openmux $VERSION installed successfully!"
        echo ""
        echo "Run 'openmux' to start the terminal multiplexer."
    else
        error "Installation verification failed"
    fi
}

main() {
    echo ""
    echo "  ┌─────────────────────────────────┐"
    echo "  │     openmux installer           │"
    echo "  └─────────────────────────────────┘"
    echo ""

    detect_platform
    get_latest_version
    download_and_extract
    check_path
    verify_installation
}

main
