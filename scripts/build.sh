#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BINARY_NAME="openmux"
DIST_DIR="$PROJECT_DIR/dist"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
LIB_INSTALL_DIR="${LIB_INSTALL_DIR:-$HOME/.local/lib/openmux}"

cd "$PROJECT_DIR"

usage() {
    echo "Usage: $0 [--install]"
    echo ""
    echo "Options:"
    echo "  --install    Build and install to $INSTALL_DIR"
    echo "  --help       Show this help message"
    echo ""
    echo "Environment variables:"
    echo "  INSTALL_DIR      Binary install directory (default: ~/.local/bin)"
    echo "  LIB_INSTALL_DIR  Library install directory (default: ~/.local/lib/openmux)"
    exit 0
}

build() {
    echo "Building $BINARY_NAME..."
    mkdir -p "$DIST_DIR"

    # Build the binary
    bun build --compile --minify src/index.tsx --outfile "$DIST_DIR/$BINARY_NAME-bin"

    # Copy native library
    local PTY_LIB="$PROJECT_DIR/node_modules/bun-pty/rust-pty/target/release/librust_pty_arm64.dylib"
    if [[ ! -f "$PTY_LIB" ]]; then
        PTY_LIB="$PROJECT_DIR/node_modules/bun-pty/rust-pty/target/release/librust_pty.dylib"
    fi

    if [[ -f "$PTY_LIB" ]]; then
        cp "$PTY_LIB" "$DIST_DIR/librust_pty.dylib"
        echo "Copied: $(basename "$PTY_LIB") -> $DIST_DIR/librust_pty.dylib"
    else
        echo "Warning: Could not find librust_pty.dylib"
    fi

    # Create wrapper script
    cat > "$DIST_DIR/$BINARY_NAME" << 'WRAPPER'
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export BUN_PTY_LIB="${BUN_PTY_LIB:-$SCRIPT_DIR/librust_pty.dylib}"
exec "$SCRIPT_DIR/openmux-bin" "$@"
WRAPPER
    chmod +x "$DIST_DIR/$BINARY_NAME"

    echo "Built: $DIST_DIR/$BINARY_NAME"
}

install_binary() {
    echo "Installing to $INSTALL_DIR..."
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$LIB_INSTALL_DIR"

    # Copy the actual binary
    cp "$DIST_DIR/$BINARY_NAME-bin" "$LIB_INSTALL_DIR/$BINARY_NAME-bin"
    chmod +x "$LIB_INSTALL_DIR/$BINARY_NAME-bin"

    # Copy native library
    if [[ -f "$DIST_DIR/librust_pty.dylib" ]]; then
        cp "$DIST_DIR/librust_pty.dylib" "$LIB_INSTALL_DIR/librust_pty.dylib"
    fi

    # Create wrapper in bin directory
    cat > "$INSTALL_DIR/$BINARY_NAME" << WRAPPER
#!/usr/bin/env bash
export BUN_PTY_LIB="\${BUN_PTY_LIB:-$LIB_INSTALL_DIR/librust_pty.dylib}"
exec "$LIB_INSTALL_DIR/$BINARY_NAME-bin" "\$@"
WRAPPER
    chmod +x "$INSTALL_DIR/$BINARY_NAME"

    echo "Installed: $INSTALL_DIR/$BINARY_NAME"
    echo "Libraries: $LIB_INSTALL_DIR/"
}

# Parse arguments
INSTALL=false
for arg in "$@"; do
    case $arg in
        --install)
            INSTALL=true
            ;;
        --help|-h)
            usage
            ;;
        *)
            echo "Unknown option: $arg"
            usage
            ;;
    esac
done

build

if [ "$INSTALL" = true ]; then
    install_binary
fi

echo "Done!"
