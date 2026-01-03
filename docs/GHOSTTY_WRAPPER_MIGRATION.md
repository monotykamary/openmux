# Migrating from Patch-Based libghostty-vt to a Wrapper Library

This document describes the migration from the patch-based approach for integrating Ghostty's terminal emulator into openmux, to a cleaner wrapper library approach. The goal is to eliminate the fragile patch system while maintaining the submodule setup and avoiding a fork of the Ghostty repository.

## Status (Completed)

- Wrapper library lives at `native/zig-ghostty-wrapper`.
- Patch file `patches/ghostty-vt.patch` removed; the Ghostty submodule stays clean.
- Build/test scripts use the wrapper library (`scripts/build.sh`, `scripts/test-ghostty-vt.sh`).

## Background and Motivation

Openmux uses Ghostty's terminal emulation library (libghostty-vt) as its core VT parser and terminal state machine. Previously, this integration was achieved through a patch file (`patches/ghostty-vt.patch`) that modified the Ghostty submodule in `vendor/ghostty`. The wrapper library now replaces that patch and provides the same C API surface.

### Problems with the Patch Approach

The patch-based approach has several significant drawbacks that motivate this migration:

First, patches are fragile across upstream updates. When Ghostty releases new versions, the patch may fail to apply cleanly due to context drift, renamed files, or API changes. This creates maintenance burden and delays in adopting upstream improvements.

Second, patches are difficult to review in pull requests. Changes to the patch appear as a single monolithic diff of a diff, making it hard to understand what actually changed in the integration layer.

Third, git tooling does not work well with patches. Commands like `git blame` cannot trace the history of patched code, and merge conflicts in the patch file itself are particularly painful to resolve.

Fourth, the patch conflates multiple concerns into a single file. Build system changes, C API additions, and configuration options are all intermingled, making it difficult to understand or modify individual pieces.

### The Wrapper Library Alternative

The proposed alternative follows the same pattern already used successfully in openmux for libgit2 integration. The `native/zig-git` directory contains a standalone Zig library that wraps libgit2, which remains as an unmodified submodule in `vendor/libgit2`. The wrapper library links against the upstream library and exports its own C API for consumption by the TypeScript layer.

This approach can be applied to Ghostty integration, with one important advantage: Ghostty is itself written in Zig, and its `lib_vt.zig` module already exports the key types (Terminal, RenderState, Screen, Stream, etc.) as public Zig declarations. This means the wrapper can import these types directly rather than going through C FFI, resulting in cleaner and more maintainable code.

## Legacy Patch-Based Architecture (historical)

Understanding the current architecture is essential for planning the migration.

### Submodule and Patch Structure

Ghostty is tracked as a git submodule at `vendor/ghostty`, pointing to the upstream `https://github.com/ghostty-org/ghostty` repository. The patch file at `patches/ghostty-vt.patch` was applied by `scripts/update-ghostty-vt.sh` in the legacy flow. This patch step is now removed.

### What the Wrapper Provides

The wrapper replaces the legacy patch by moving the C API implementation into `native/zig-ghostty-wrapper`. It exposes the same terminal lifecycle, render state queries, scrollback access, mode queries, Kitty graphics enumeration, and response buffer handling functions, while importing Ghostty types directly via Zig.

The wrapper also ships its own `include/zig-ghostty-wrapper/terminal.h` header, matching the C API previously provided by the patch.

### FFI Interface from TypeScript

The TypeScript layer interacts with libghostty-vt through Bun's FFI system. The file `src/terminal/ghostty-vt/ffi.ts` uses `dlopen` to load the shared library and declares the function signatures. The higher-level wrapper in `src/terminal/ghostty-vt/terminal.ts` provides a more ergonomic interface, managing terminal instances and converting between JavaScript and native types.

The FFI currently imports approximately 50 functions covering terminal lifecycle, render state queries, scrollback access, mode queries, Kitty graphics enumeration, response handling, and key event encoding.

### Build Process

The build script `scripts/build.sh` orchestrates the native library builds. For Ghostty, it now builds `native/zig-ghostty-wrapper` and copies the resulting `libghostty-vt` shared library into the distribution directory alongside the zig-pty and zig-git libraries.

## Proposed Wrapper Library Architecture

The new architecture introduces a `native/zig-ghostty-wrapper` directory that contains a standalone Zig library. This library imports Ghostty's public Zig modules and exports a C API, completely replacing the patched code.

### Directory Structure

The wrapper library will have the following structure:

```
native/zig-ghostty-wrapper/
  build.zig           # Build configuration
  build.zig.zon       # Package manifest declaring ghostty dependency
  src/
    main.zig          # C export declarations
    terminal.zig      # Terminal wrapper implementation
    render_state.zig  # RenderState query functions
    scrollback.zig    # Scrollback access functions
    kitty.zig         # Kitty graphics enumeration
    responses.zig     # Response buffer handling
  include/
    zig-ghostty-wrapper/
      terminal.h      # Public C header
```

### Package Dependency Declaration

The `build.zig.zon` file declares Ghostty as a path dependency, pointing to the vendored submodule:

```zig
.{
    .name = "zig-ghostty-wrapper",
    .version = "0.1.0",
    .paths = .{""},
    .dependencies = .{
        .ghostty = .{ .path = "../../vendor/ghostty" },
    },
}
```

This allows the wrapper's Zig code to import Ghostty modules using `@import("ghostty")`.

### Importing Ghostty Types

The key insight enabling this migration is that Ghostty's `src/lib_vt.zig` already exports the types needed for terminal emulation as public declarations. The wrapper can import these directly:

```zig
const ghostty = @import("ghostty");

const Terminal = ghostty.Terminal;
const RenderState = ghostty.RenderState;
const Screen = ghostty.Screen;
const Stream = ghostty.Stream;
const Page = ghostty.page.Page;
const Cell = ghostty.Cell;
```

This is fundamentally different from the zig-git approach, where libgit2 is a C library and must be accessed through C headers and linking. With Ghostty, the wrapper has direct access to Zig types, enabling cleaner code and better compile-time checking.

### Build Configuration

The `build.zig` file configures the shared library build. It must handle several concerns:

It must resolve the Ghostty dependency and access its modules. The Zig build system handles this automatically through the dependency declared in `build.zig.zon`.

It must configure build options that affect terminal behavior. The `kitty_graphics_passthrough` option needs to be set appropriately. This may require either accessing Ghostty's build option system or implementing equivalent logic in the wrapper layer.

It must link the required dependencies. Ghostty's terminal module depends on wuffs (for image decoding) and oniguruma (for regex). These dependencies must either be pulled from Ghostty's dependency tree or declared separately.

It must produce a shared library with C exports. The `main.zig` file uses `@export` declarations to expose functions with C-compatible names.

### C API Compatibility

The wrapper must export the same C API that the TypeScript layer currently expects. This means maintaining the same function names, parameter types, and return values. The functions are:

Terminal lifecycle: `ghostty_terminal_new`, `ghostty_terminal_new_with_config`, `ghostty_terminal_free`, `ghostty_terminal_resize`, `ghostty_terminal_set_pixel_size`, `ghostty_terminal_write`.

Render state queries: `ghostty_render_state_update`, `ghostty_render_state_get_cols`, `ghostty_render_state_get_rows`, `ghostty_render_state_get_cursor_x`, `ghostty_render_state_get_cursor_y`, `ghostty_render_state_get_cursor_visible`, `ghostty_render_state_get_bg_color`, `ghostty_render_state_get_fg_color`, `ghostty_render_state_is_row_dirty`, `ghostty_render_state_mark_clean`, `ghostty_render_state_get_viewport`, `ghostty_render_state_get_grapheme`.

Terminal modes: `ghostty_terminal_is_alternate_screen`, `ghostty_terminal_has_mouse_tracking`, `ghostty_terminal_get_mode`, `ghostty_terminal_get_kitty_keyboard_flags`.

Kitty graphics: `ghostty_terminal_get_kitty_images_dirty`, `ghostty_terminal_clear_kitty_images_dirty`, `ghostty_terminal_get_kitty_image_count`, `ghostty_terminal_get_kitty_image_ids`, `ghostty_terminal_get_kitty_image_info`, `ghostty_terminal_copy_kitty_image_data`, `ghostty_terminal_get_kitty_placement_count`, `ghostty_terminal_get_kitty_placements`.

Scrollback: `ghostty_terminal_get_scrollback_length`, `ghostty_terminal_get_scrollback_line`, `ghostty_terminal_get_scrollback_grapheme`, `ghostty_terminal_is_row_wrapped`.

Responses: `ghostty_terminal_has_response`, `ghostty_terminal_read_response`.

Key encoding: `ghostty_key_event_new`, `ghostty_key_event_free`, `ghostty_key_event_set_action`, `ghostty_key_event_set_key`, `ghostty_key_event_set_mods`, `ghostty_key_event_set_consumed_mods`, `ghostty_key_event_set_composing`, `ghostty_key_event_set_utf8`, `ghostty_key_event_set_unshifted_codepoint`, `ghostty_key_encoder_new`, `ghostty_key_encoder_free`, `ghostty_key_encoder_setopt`, `ghostty_key_encoder_encode`.

The key encoding functions are already exported by upstream Ghostty's lib_vt, so the wrapper can either re-export them or let the TypeScript layer load them from the upstream library directly. For simplicity and consistency, the wrapper should re-export all functions so there is a single library to load.

## Migration Steps

The migration should proceed in phases to minimize risk and allow for incremental testing.

### Phase 1: Create the Wrapper Library Skeleton

Create the `native/zig-ghostty-wrapper` directory with `build.zig.zon` declaring the Ghostty dependency. Create a minimal `build.zig` that attempts to import the Ghostty modules and build a shared library. Create a `src/main.zig` that exports a single test function. Verify that `zig build` succeeds and produces a loadable shared library.

This phase validates that the Zig package dependency system works correctly with the vendored Ghostty submodule.

### Phase 2: Implement Terminal Wrapper Core

Extract the terminal wrapper implementation from the legacy patch (now materialized in `native/zig-ghostty-wrapper/src/terminal.zig`). The relevant code originated in `src/terminal/c/terminal.zig` and was adapted to import types from the Ghostty package rather than relative imports.

Create `src/terminal.zig` with the `TerminalWrapper` struct that holds a pointer to a Ghostty `Terminal` and a `RenderState`. Implement the lifecycle functions (`new`, `free`, `resize`, `write`). Export these from `main.zig` with the expected C function names.

Test by temporarily modifying the TypeScript FFI to load the wrapper library and verify that terminal creation and basic output work.

### Phase 3: Implement Render State Queries

Add the render state query functions that extract information from the terminal's current state. These include cursor position, viewport contents, dirty row tracking, and grapheme extraction.

The implementation should closely follow the patched code, adapting imports as needed. The `RenderState` type from Ghostty provides most of the functionality; the wrapper functions translate between Ghostty's types and C-compatible types.

### Phase 4: Implement Scrollback and Mode Queries

Add functions for accessing scrollback history and querying terminal modes. The scrollback functions iterate over the terminal's page list to extract historical lines. The mode query functions check various terminal state flags.

### Phase 5: Implement Kitty Graphics Support

Add the Kitty graphics enumeration functions. These allow the TypeScript layer to discover what images and placements exist in the terminal state.

The `kitty_graphics_passthrough` build option affects how image data is stored. If passthrough is enabled, images retain their original encoded format (PNG, etc.) rather than being decoded to raw pixels. The wrapper should configure this appropriately, either through Ghostty's build options or by implementing equivalent logic.

### Phase 6: Implement Response Handling

Add the response buffer functions that allow reading terminal responses (for device status reports and other queries). The terminal accumulates responses in an internal buffer; these functions expose that buffer to the TypeScript layer.

### Phase 7: Re-export Key Encoding Functions

Either re-export the key encoding functions that Ghostty already provides, or ensure they are accessible through the wrapper library. The simplest approach is to import them from Ghostty and re-export with the same names.

### Phase 8: Create the C Header

Create `include/zig-ghostty-wrapper/terminal.h` with declarations for all exported functions. This header should match the current header in the patch to ensure TypeScript FFI compatibility.

### Phase 9: Update Build System

Modify `scripts/build.sh` to build the wrapper library instead of the patched Ghostty. The build function should:

1. Build the wrapper library using `zig build` in `native/zig-ghostty-wrapper`
2. Copy the resulting shared library to the distribution directory
3. No longer apply the patch or build within `vendor/ghostty`

Update the TypeScript FFI loader (`src/terminal/ghostty-vt/ffi.ts`) to look for the wrapper library with its new name, or keep the same name for compatibility.

### Phase 10: Remove the Patch (Completed)

The patch file `patches/ghostty-vt.patch` has been removed. `scripts/update-ghostty-vt.sh` now only handles submodule updates without patch management, and the vendored Ghostty submodule stays clean.

## Technical Challenges and Mitigations

Several technical challenges may arise during migration.

### Ghostty Module Accessibility

The wrapper depends on Ghostty exposing its terminal types through the `lib_vt.zig` public interface. Current analysis confirms that `Terminal`, `RenderState`, `Screen`, `Stream`, and related types are already exported. However, some internal details accessed by the current patch may not be public.

If certain functionality requires access to non-public Ghostty internals, there are several options: request that Ghostty upstream export the needed types, implement equivalent functionality in the wrapper layer without accessing internals, or as a last resort maintain a minimal patch that only adds the necessary exports.

### Build Option Configuration

The current patch sets `kitty_graphics_passthrough = true` in the build configuration. In the wrapper approach, this option must be configured differently.

One approach is to rely on Ghostty's default behavior and handle any necessary format conversion in the wrapper or TypeScript layer. Another approach is to investigate whether the wrapper can influence Ghostty's build options through the dependency system. If neither works, the image handling logic could be implemented entirely in the wrapper.

### Dependency Management

Ghostty's terminal module depends on external libraries (wuffs, oniguruma) for image decoding and regex. The wrapper's build must ensure these dependencies are available.

The cleanest approach is to use Ghostty's own dependency artifacts. When the Zig build system resolves the Ghostty dependency, it should make these transitive dependencies available. If not, the wrapper's `build.zig` can declare them explicitly, referencing Ghostty's `pkg/` directory.

### Testing Strategy

The migration must maintain compatibility with existing functionality. The test strategy should include:

Running the existing test suite (`bun run test:ts` and `bun run test:ghostty-vt`) after each phase to catch regressions early.

Manual testing of terminal rendering, scrollback, Kitty graphics display, and keyboard input to verify the wrapper produces identical behavior.

Comparing the shared library's exported symbols before and after migration to ensure API compatibility.

### Rollback Plan

If issues arise during migration that cannot be quickly resolved, the patch-based approach remains available as a fallback. The migration should not delete the patch file until the wrapper is fully validated. Git branches should be used to isolate migration work and allow easy rollback.

## Verification Checklist

Before considering the migration complete, verify the following:

1. The wrapper library builds successfully on all supported platforms (macOS arm64, macOS x64, Linux x64, Linux arm64).

2. All exported symbols match the previous library's symbol table.

3. The TypeScript FFI loads the wrapper library without modification (or with minimal, documented changes).

4. All existing tests pass without modification.

5. Manual testing confirms: terminal output renders correctly, scrollback works, Kitty graphics display properly, keyboard input is encoded correctly, terminal resize works, and session persistence and restoration work.

6. The vendored Ghostty submodule contains no local modifications (clean `git status`).

7. Updating the Ghostty submodule to a new version requires only rebuilding, with no patch regeneration.

8. Documentation accurately reflects the new architecture.

## Appendix: Key File References

For implementers, here are the key files to reference:

**Wrapper implementation:**
- `native/zig-ghostty-wrapper/src/terminal.zig` - Terminal C API wrapper implementation
- `native/zig-ghostty-wrapper/src/main.zig` - C export declarations
- `native/zig-ghostty-wrapper/include/zig-ghostty-wrapper/terminal.h` - Public C header

**Ghostty public interface:**
- `vendor/ghostty/src/lib_vt.zig` - Public Zig API exports
- `vendor/ghostty/src/build/GhosttyZig.zig` - Module configuration
- `vendor/ghostty/src/terminal/c/main.zig` - Existing C API (key encoding, etc.)

**Existing wrapper pattern:**
- `native/zig-git/build.zig` - Example of wrapper library build configuration
- `native/zig-git/src/main.zig` - Example of C export pattern

**TypeScript FFI layer:**
- `src/terminal/ghostty-vt/ffi.ts` - FFI declarations that must remain compatible
- `src/terminal/ghostty-vt/terminal.ts` - Higher-level terminal wrapper

**Build system:**
- `scripts/build.sh` - Builds the wrapper library
- `scripts/update-ghostty-vt.sh` - Submodule update script (no patches)

This document should provide sufficient context and detail for implementing the migration. The key insight is that Ghostty already exports the types needed as public Zig declarations, making the wrapper library approach not only feasible but cleaner than the current patch system.
