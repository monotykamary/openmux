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
                LIB_NAME="libzig_pty_arm64.dylib"
                LIB_NAME_FALLBACK="libzig_pty.dylib"
                GIT_LIB_NAME="libzig_git_arm64.dylib"
                GIT_LIB_NAME_FALLBACK="libzig_git.dylib"
            else
                LIB_NAME="libzig_pty.dylib"
                LIB_NAME_FALLBACK="libzig_pty.dylib"
                GIT_LIB_NAME="libzig_git.dylib"
                GIT_LIB_NAME_FALLBACK="libzig_git.dylib"
            fi
            ;;
        linux)
            LIB_EXT="so"
            if [[ "$ARCH" == "arm64" ]]; then
                LIB_NAME="libzig_pty_arm64.so"
                LIB_NAME_FALLBACK="libzig_pty.so"
                GIT_LIB_NAME="libzig_git_arm64.so"
                GIT_LIB_NAME_FALLBACK="libzig_git.so"
            else
                LIB_NAME="libzig_pty.so"
                LIB_NAME_FALLBACK="libzig_pty.so"
                GIT_LIB_NAME="libzig_git.so"
                GIT_LIB_NAME_FALLBACK="libzig_git.so"
            fi
            ;;
        windows)
            LIB_EXT="dll"
            LIB_NAME="zig_pty.dll"
            LIB_NAME_FALLBACK="zig_pty.dll"
            GIT_LIB_NAME="zig_git.dll"
            GIT_LIB_NAME_FALLBACK="zig_git.dll"
            ;;
    esac

    # libghostty-vt has a stable name across platforms
    GHOSTTY_LIB_NAME="libghostty-vt.$LIB_EXT"
}

# Build zig-pty native library
build_zig_pty() {
    echo "Building zig-pty native library..."

    local zig_pty_dir="$PROJECT_DIR/zig-pty"

    if [[ ! -d "$zig_pty_dir" ]]; then
        echo "Error: zig-pty directory not found at $zig_pty_dir"
        exit 1
    fi

    # Check if zig is available
    if ! command -v zig &> /dev/null; then
        echo "Error: zig compiler not found. Please install Zig: https://ziglang.org/download/"
        exit 1
    fi

    cd "$zig_pty_dir"
    zig build -Doptimize=ReleaseFast
    cd "$PROJECT_DIR"

    echo "Built zig-pty native library"
}

# Build zig-git native library
build_zig_git() {
    echo "Building zig-git native library..."

    local zig_git_dir="$PROJECT_DIR/zig-git"

    if [[ ! -d "$zig_git_dir" ]]; then
        echo "Error: zig-git directory not found at $zig_git_dir"
        exit 1
    fi

    if ! command -v zig &> /dev/null; then
        echo "Error: zig compiler not found. Please install Zig: https://ziglang.org/download/"
        exit 1
    fi

    if ! command -v cmake &> /dev/null; then
        echo "Error: cmake not found. Please install CMake: https://cmake.org/download/"
        exit 1
    fi

    cd "$zig_git_dir"
    zig build -Doptimize=ReleaseFast
    cd "$PROJECT_DIR"

    echo "Built zig-git native library"
}

# Build ghostty-vt native library
build_ghostty_vt() {
    echo "Building ghostty-vt native library..."

    local ghostty_dir="${GHOSTTY_VT_DIR:-$PROJECT_DIR/ghostty}"
    if [[ ! -d "$ghostty_dir" ]]; then
        ghostty_dir="$PROJECT_DIR/vendor/ghostty"
    fi

    if [[ ! -d "$ghostty_dir" ]]; then
        echo "Error: ghostty directory not found. Set GHOSTTY_VT_DIR or add ghostty sources."
        exit 1
    fi

    if [[ ! -f "$ghostty_dir/include/ghostty/vt/terminal.h" ]]; then
        if [[ "$ghostty_dir" == "$PROJECT_DIR/vendor/ghostty" && -x "$PROJECT_DIR/scripts/update-ghostty-vt.sh" ]]; then
            GHOSTTY_VT_DIR="$ghostty_dir" "$PROJECT_DIR/scripts/update-ghostty-vt.sh" --patch-only
        fi
    fi

    if [[ ! -f "$ghostty_dir/include/ghostty/vt/terminal.h" ]]; then
        echo "Error: ghostty-vt patch missing (include/ghostty/vt/terminal.h not found)."
        echo "Run: scripts/update-ghostty-vt.sh --patch-only"
        exit 1
    fi

    if ! command -v zig &> /dev/null; then
        echo "Error: zig compiler not found. Please install Zig: https://ziglang.org/download/"
        exit 1
    fi

    local ghostty_version
    ghostty_version=$(grep -E 'version = "' "$ghostty_dir/build.zig.zon" | head -1 | sed -E 's/.*version = "([^"]+)".*/\1/')
    if [[ -z "$ghostty_version" ]]; then
        echo "Error: could not determine ghostty version from $ghostty_dir/build.zig.zon"
        exit 1
    fi

    cd "$ghostty_dir"
    zig build lib-vt -Doptimize=ReleaseFast -Dversion-string="$ghostty_version"
    cd "$PROJECT_DIR"

    echo "Built ghostty-vt native library"
}

sign_macos_artifacts() {
    if [[ "$OS" != "darwin" ]]; then
        return 0
    fi

    if [[ -n "${OPENMUX_SKIP_CODESIGN:-}" ]]; then
        echo "Skipping codesign (OPENMUX_SKIP_CODESIGN set)."
        return 0
    fi

    if ! command -v codesign &> /dev/null; then
        echo "Warning: codesign not found; skipping macOS ad-hoc signing."
        return 0
    fi

    local sign_identity="${OPENMUX_CODESIGN_ID:--}"
    local targets=(
        "$DIST_DIR/$BINARY_NAME-bin"
        "$DIST_DIR/libzig_pty.$LIB_EXT"
        "$DIST_DIR/libzig_git.$LIB_EXT"
        "$DIST_DIR/$GHOSTTY_LIB_NAME"
    )

    for target in "${targets[@]}"; do
        if [[ ! -f "$target" ]]; then
            echo "Error: codesign target not found at $target"
            exit 1
        fi
    done

    echo "Ad-hoc signing macOS artifacts..."
    codesign --force --sign "$sign_identity" "${targets[@]}"
}

cleanup() {
    find "$PROJECT_DIR" -maxdepth 1 -name "*.bun-build" -type f -delete 2>/dev/null || true
    # Clean up intermediate bundle artifacts (keep binary, libs, wasm, etc.)
    rm -f "$DIST_DIR"/index.js 2>/dev/null || true
    rm -rf "$DIST_DIR"/chunk-*.js "$DIST_DIR"/terminal 2>/dev/null || true
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
    echo "  OPENMUX_SKIP_CODESIGN  Skip macOS ad-hoc signing when set"
    echo "  OPENMUX_CODESIGN_ID    Override codesign identity (default: ad-hoc -)"
    exit 0
}

build() {
    echo "Building $BINARY_NAME for $TARGET..."

    cleanup
    mkdir -p "$DIST_DIR"

    # Build zig-pty native library first
    build_zig_pty
    build_zig_git
    build_ghostty_vt

    # Bundle with Solid.js plugin (bun build --compile doesn't run preload scripts)
    # This transforms JSX and bundles all dependencies into a single file
    echo "Bundling with Solid.js transform..."
    bun run scripts/bundle.ts

    # Temporarily remove preload from bunfig.toml during compilation
    # The bundle.ts already handles Solid.js transform, so preload is not needed
    local bunfig_path="$PROJECT_DIR/bunfig.toml"
    local bunfig_backup_path="$PROJECT_DIR/bunfig.toml.build-backup"

    if [[ -f "$bunfig_path" ]]; then
        cp "$bunfig_path" "$bunfig_backup_path"
        # Create a version without preload lines
        grep -v '^preload' "$bunfig_backup_path" > "$bunfig_path" || true
    fi

    # Compile the bundled output into a standalone binary
    local compile_status=0
    bun build --compile --minify "$DIST_DIR/index.js" --outfile "$DIST_DIR/$BINARY_NAME-bin" || compile_status=$?

    # Restore bunfig.toml
    if [[ -f "$bunfig_backup_path" ]]; then
        mv "$bunfig_backup_path" "$bunfig_path"
    fi

    # Exit if compilation failed
    if [[ $compile_status -ne 0 ]]; then
        echo "Compilation failed"
        exit $compile_status
    fi

    # Find and copy native library from zig-pty
    local pty_lib="$PROJECT_DIR/zig-pty/zig-out/lib/$LIB_NAME"

    # Fallback to non-arch-specific name if needed
    if [[ ! -f "$pty_lib" ]]; then
        pty_lib="$PROJECT_DIR/zig-pty/zig-out/lib/$LIB_NAME_FALLBACK"
    fi

    if [[ -f "$pty_lib" ]]; then
        cp "$pty_lib" "$DIST_DIR/libzig_pty.$LIB_EXT"
        echo "Copied: $(basename "$pty_lib") -> $DIST_DIR/libzig_pty.$LIB_EXT"
    else
        echo "Error: Could not find native PTY library at $pty_lib"
        exit 1
    fi

    # Find and copy native library from zig-git
    local git_lib="$PROJECT_DIR/zig-git/zig-out/lib/$GIT_LIB_NAME"

    if [[ ! -f "$git_lib" ]]; then
        git_lib="$PROJECT_DIR/zig-git/zig-out/lib/$GIT_LIB_NAME_FALLBACK"
    fi

    if [[ -f "$git_lib" ]]; then
        cp "$git_lib" "$DIST_DIR/libzig_git.$LIB_EXT"
        echo "Copied: $(basename "$git_lib") -> $DIST_DIR/libzig_git.$LIB_EXT"
    else
        echo "Error: Could not find native git library at $git_lib"
        exit 1
    fi

    # Copy ghostty-vt native library
    local ghostty_dir="${GHOSTTY_VT_DIR:-$PROJECT_DIR/ghostty}"
    if [[ ! -d "$ghostty_dir" ]]; then
        ghostty_dir="$PROJECT_DIR/vendor/ghostty"
    fi
    local ghostty_lib="$ghostty_dir/zig-out/lib/$GHOSTTY_LIB_NAME"
    if [[ ! -f "$ghostty_lib" ]]; then
        ghostty_lib="$ghostty_dir/zig-out/lib/ghostty-vt.$LIB_EXT"
    fi
    if [[ -f "$ghostty_lib" ]]; then
        cp "$ghostty_lib" "$DIST_DIR/$GHOSTTY_LIB_NAME"
        echo "Copied: $(basename "$ghostty_lib") -> $DIST_DIR/$GHOSTTY_LIB_NAME"
    else
        echo "Error: Could not find native ghostty-vt library at $ghostty_lib"
        exit 1
    fi

    # Create empty bunfig.toml in dist to prevent parent config from being used
    echo "# openmux runtime config (empty - preload already compiled in)" > "$DIST_DIR/bunfig.toml"

    # Create wrapper script
    create_wrapper "$DIST_DIR/$BINARY_NAME"

    sign_macos_artifacts

    cleanup
    echo "Built: $DIST_DIR/$BINARY_NAME"
}

create_wrapper() {
    local wrapper_path="$1"

    if [[ "$OS" == "windows" ]]; then
        # Windows batch file
        # Note: cd to SCRIPT_DIR to avoid reading bunfig.toml from user's cwd
        # OPENMUX_ORIGINAL_CWD preserves the user's directory for initial shell
        cat > "${wrapper_path}.cmd" << 'WRAPPER'
@echo off
set "SCRIPT_DIR=%~dp0"
set "ZIG_PTY_LIB=%SCRIPT_DIR%zig_pty.dll"
set "ZIG_GIT_LIB=%SCRIPT_DIR%zig_git.dll"
set "GHOSTTY_VT_LIB=%SCRIPT_DIR%libghostty-vt.dll"
if not defined OPENMUX_ORIGINAL_CWD set "OPENMUX_ORIGINAL_CWD=%CD%"
cd /d "%SCRIPT_DIR%"
"%SCRIPT_DIR%openmux-bin.exe" %*
WRAPPER
    else
        # Unix shell script
        # Note: cd to SCRIPT_DIR to avoid reading bunfig.toml from user's cwd
        # OPENMUX_ORIGINAL_CWD preserves the user's directory for initial shell
        cat > "$wrapper_path" << WRAPPER
#!/usr/bin/env bash
SCRIPT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
export ZIG_PTY_LIB="\${ZIG_PTY_LIB:-\$SCRIPT_DIR/libzig_pty.$LIB_EXT}"
export ZIG_GIT_LIB="\${ZIG_GIT_LIB:-\$SCRIPT_DIR/libzig_git.$LIB_EXT}"
export GHOSTTY_VT_LIB="\${GHOSTTY_VT_LIB:-\$SCRIPT_DIR/$GHOSTTY_LIB_NAME}"
export OPENMUX_ORIGINAL_CWD="\${OPENMUX_ORIGINAL_CWD:-\$(pwd)}"
cd "\$SCRIPT_DIR"
exec "./openmux-bin" "\$@"
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

    # Create tarball with dist contents (includes empty bunfig.toml for isolation)
    tar -czf "$tarball_path" -C "$DIST_DIR" \
        "$BINARY_NAME" \
        "$BINARY_NAME-bin" \
        "libzig_pty.$LIB_EXT" \
        "libzig_git.$LIB_EXT" \
        "$GHOSTTY_LIB_NAME" \
        "bunfig.toml"

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

    # Copy native libraries
    if [[ -f "$DIST_DIR/libzig_pty.$LIB_EXT" ]]; then
        cp "$DIST_DIR/libzig_pty.$LIB_EXT" "$LIB_INSTALL_DIR/libzig_pty.$LIB_EXT"
    fi
    if [[ -f "$DIST_DIR/libzig_git.$LIB_EXT" ]]; then
        cp "$DIST_DIR/libzig_git.$LIB_EXT" "$LIB_INSTALL_DIR/libzig_git.$LIB_EXT"
    fi
    if [[ -f "$DIST_DIR/$GHOSTTY_LIB_NAME" ]]; then
        cp "$DIST_DIR/$GHOSTTY_LIB_NAME" "$LIB_INSTALL_DIR/$GHOSTTY_LIB_NAME"
    fi

    # Copy empty bunfig.toml to prevent parent config from being used
    cp "$DIST_DIR/bunfig.toml" "$LIB_INSTALL_DIR/bunfig.toml"

    # Create wrapper in bin directory
    # Note: cd to LIB_INSTALL_DIR to avoid reading bunfig.toml from user's cwd
    # OPENMUX_ORIGINAL_CWD preserves the user's directory for initial shell
    if [[ "$OS" == "windows" ]]; then
        cat > "$INSTALL_DIR/$BINARY_NAME.cmd" << WRAPPER
@echo off
set "ZIG_PTY_LIB=$LIB_INSTALL_DIR\\zig_pty.dll"
set "ZIG_GIT_LIB=$LIB_INSTALL_DIR\\zig_git.dll"
set "GHOSTTY_VT_LIB=$LIB_INSTALL_DIR\\libghostty-vt.dll"
if not defined OPENMUX_ORIGINAL_CWD set "OPENMUX_ORIGINAL_CWD=%CD%"
cd /d "$LIB_INSTALL_DIR"
"$LIB_INSTALL_DIR\\$BINARY_NAME-bin.exe" %*
WRAPPER
    else
        cat > "$INSTALL_DIR/$BINARY_NAME" << WRAPPER
#!/usr/bin/env bash
export ZIG_PTY_LIB="\${ZIG_PTY_LIB:-$LIB_INSTALL_DIR/libzig_pty.$LIB_EXT}"
export ZIG_GIT_LIB="\${ZIG_GIT_LIB:-$LIB_INSTALL_DIR/libzig_git.$LIB_EXT}"
export GHOSTTY_VT_LIB="\${GHOSTTY_VT_LIB:-$LIB_INSTALL_DIR/$GHOSTTY_LIB_NAME}"
export OPENMUX_ORIGINAL_CWD="\${OPENMUX_ORIGINAL_CWD:-\$(pwd)}"
cd "$LIB_INSTALL_DIR"
exec "./$BINARY_NAME-bin" "\$@"
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
