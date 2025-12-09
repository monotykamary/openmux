#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BINARY_NAME="openmux"
DIST_DIR="$PROJECT_DIR/dist"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
LIB_INSTALL_DIR="${LIB_INSTALL_DIR:-$HOME/.local/lib/openmux}"

cd "$PROJECT_DIR"

# Detect platform and architecture
detect_platform() {
    local os arch
    os="$(uname -s | tr '[:upper:]' '[:lower:]')"
    arch="$(uname -m)"

    case "$os" in
        darwin) OS="darwin" ;;
        linux) OS="linux" ;;
        mingw*|msys*|cygwin*) OS="windows" ;;
        *) echo "Unsupported OS: $os"; exit 1 ;;
    esac

    case "$arch" in
        x86_64|amd64) ARCH="x64" ;;
        arm64|aarch64) ARCH="arm64" ;;
        *) echo "Unsupported architecture: $arch"; exit 1 ;;
    esac

    TARGET="${OS}-${ARCH}"
}

# Get native library extension and name for current platform
get_lib_info() {
    case "$OS" in
        darwin)
            LIB_EXT="dylib"
            if [[ "$ARCH" == "arm64" ]]; then
                LIB_NAME="librust_pty_arm64.dylib"
            else
                LIB_NAME="librust_pty.dylib"
            fi
            ;;
        linux)
            LIB_EXT="so"
            if [[ "$ARCH" == "arm64" ]]; then
                LIB_NAME="librust_pty_arm64.so"
            else
                LIB_NAME="librust_pty.so"
            fi
            ;;
        windows)
            LIB_EXT="dll"
            LIB_NAME="rust_pty.dll"
            ;;
    esac
}

cleanup() {
    find "$PROJECT_DIR" -maxdepth 1 -name "*.bun-build" -type f -delete 2>/dev/null || true
}

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --install     Build and install to $INSTALL_DIR"
    echo "  --release     Build release tarball for distribution"
    echo "  --help        Show this help message"
    echo ""
    echo "Environment variables:"
    echo "  INSTALL_DIR      Binary install directory (default: ~/.local/bin)"
    echo "  LIB_INSTALL_DIR  Library install directory (default: ~/.local/lib/openmux)"
    exit 0
}

build() {
    echo "Building $BINARY_NAME for $TARGET..."

    cleanup
    mkdir -p "$DIST_DIR"

    # Build the binary
    bun build --compile --minify src/index.tsx --outfile "$DIST_DIR/$BINARY_NAME-bin"

    # Find and copy native library
    local pty_lib="$PROJECT_DIR/node_modules/bun-pty/rust-pty/target/release/$LIB_NAME"

    # Fallback to non-arch-specific name if needed
    if [[ ! -f "$pty_lib" ]]; then
        case "$OS" in
            darwin) pty_lib="$PROJECT_DIR/node_modules/bun-pty/rust-pty/target/release/librust_pty.dylib" ;;
            linux) pty_lib="$PROJECT_DIR/node_modules/bun-pty/rust-pty/target/release/librust_pty.so" ;;
        esac
    fi

    if [[ -f "$pty_lib" ]]; then
        cp "$pty_lib" "$DIST_DIR/librust_pty.$LIB_EXT"
        echo "Copied: $(basename "$pty_lib") -> $DIST_DIR/librust_pty.$LIB_EXT"
    else
        echo "Warning: Could not find native PTY library at $pty_lib"
    fi

    # Create wrapper script
    create_wrapper "$DIST_DIR/$BINARY_NAME"

    cleanup
    echo "Built: $DIST_DIR/$BINARY_NAME"
}

create_wrapper() {
    local wrapper_path="$1"

    if [[ "$OS" == "windows" ]]; then
        # Windows batch file
        cat > "${wrapper_path}.cmd" << 'WRAPPER'
@echo off
set "SCRIPT_DIR=%~dp0"
set "BUN_PTY_LIB=%SCRIPT_DIR%rust_pty.dll"
"%SCRIPT_DIR%openmux-bin.exe" %*
WRAPPER
    else
        # Unix shell script
        cat > "$wrapper_path" << WRAPPER
#!/usr/bin/env bash
SCRIPT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
export BUN_PTY_LIB="\${BUN_PTY_LIB:-\$SCRIPT_DIR/librust_pty.$LIB_EXT}"
exec "\$SCRIPT_DIR/openmux-bin" "\$@"
WRAPPER
        chmod +x "$wrapper_path"
    fi
}

create_release() {
    local version
    version=$(grep '"version"' "$PROJECT_DIR/package.json" | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')

    local tarball_name="openmux-v${version}-${TARGET}.tar.gz"
    local tarball_path="$DIST_DIR/$tarball_name"

    echo "Creating release tarball: $tarball_name"

    # Create tarball with dist contents
    tar -czf "$tarball_path" -C "$DIST_DIR" \
        "$BINARY_NAME" \
        "$BINARY_NAME-bin" \
        "librust_pty.$LIB_EXT"

    echo "Created: $tarball_path"

    # Output for GitHub Actions
    if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
        echo "tarball_name=$tarball_name" >> "$GITHUB_OUTPUT"
        echo "tarball_path=$tarball_path" >> "$GITHUB_OUTPUT"
    fi
}

install_binary() {
    echo "Installing to $INSTALL_DIR..."
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$LIB_INSTALL_DIR"

    # Copy the actual binary
    cp "$DIST_DIR/$BINARY_NAME-bin" "$LIB_INSTALL_DIR/$BINARY_NAME-bin"
    chmod +x "$LIB_INSTALL_DIR/$BINARY_NAME-bin"

    # Copy native library
    if [[ -f "$DIST_DIR/librust_pty.$LIB_EXT" ]]; then
        cp "$DIST_DIR/librust_pty.$LIB_EXT" "$LIB_INSTALL_DIR/librust_pty.$LIB_EXT"
    fi

    # Create wrapper in bin directory
    if [[ "$OS" == "windows" ]]; then
        cat > "$INSTALL_DIR/$BINARY_NAME.cmd" << WRAPPER
@echo off
set "BUN_PTY_LIB=$LIB_INSTALL_DIR\\rust_pty.dll"
"$LIB_INSTALL_DIR\\$BINARY_NAME-bin.exe" %*
WRAPPER
    else
        cat > "$INSTALL_DIR/$BINARY_NAME" << WRAPPER
#!/usr/bin/env bash
export BUN_PTY_LIB="\${BUN_PTY_LIB:-$LIB_INSTALL_DIR/librust_pty.$LIB_EXT}"
exec "$LIB_INSTALL_DIR/$BINARY_NAME-bin" "\$@"
WRAPPER
        chmod +x "$INSTALL_DIR/$BINARY_NAME"
    fi

    echo "Installed: $INSTALL_DIR/$BINARY_NAME"
    echo "Libraries: $LIB_INSTALL_DIR/"
}

# Initialize platform detection
detect_platform
get_lib_info

# Parse arguments
INSTALL=false
RELEASE=false

for arg in "$@"; do
    case $arg in
        --install)
            INSTALL=true
            ;;
        --release)
            RELEASE=true
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

if [[ "$RELEASE" == true ]]; then
    create_release
fi

if [[ "$INSTALL" == true ]]; then
    install_binary
fi

echo "Done!"
