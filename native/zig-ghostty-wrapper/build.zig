const std = @import("std");

const TerminalArtifact = enum {
    ghostty,
    lib,
};

const TerminalOptions = struct {
    artifact: TerminalArtifact,
    oniguruma: bool,
    simd: bool,
    c_abi: bool,
    slow_runtime_safety: bool,
    kitty_graphics_passthrough: bool,
};

const UnicodeTables = struct {
    props_output: std.Build.LazyPath,
    symbols_output: std.Build.LazyPath,

    pub fn init(
        b: *std.Build,
        ghostty_dep: *std.Build.Dependency,
        uucode_tables: std.Build.LazyPath,
    ) !UnicodeTables {
        const props_exe = b.addExecutable(.{
            .name = "props-unigen",
            .root_module = b.createModule(.{
                .root_source_file = ghostty_dep.path("src/unicode/props_uucode.zig"),
                .target = b.graph.host,
                .strip = false,
                .omit_frame_pointer = false,
                .unwind_tables = .sync,
            }),
            .use_llvm = true,
        });

        const symbols_exe = b.addExecutable(.{
            .name = "symbols-unigen",
            .root_module = b.createModule(.{
                .root_source_file = ghostty_dep.path("src/unicode/symbols_uucode.zig"),
                .target = b.graph.host,
                .strip = false,
                .omit_frame_pointer = false,
                .unwind_tables = .sync,
            }),
            .use_llvm = true,
        });

        if (b.lazyDependency("uucode", .{
            .target = b.graph.host,
            .tables_path = uucode_tables,
            .build_config_path = ghostty_dep.path("src/build/uucode_config.zig"),
        })) |dep| {
            props_exe.root_module.addImport("uucode", dep.module("uucode"));
            symbols_exe.root_module.addImport("uucode", dep.module("uucode"));
        }

        const props_run = b.addRunArtifact(props_exe);
        const symbols_run = b.addRunArtifact(symbols_exe);

        const wf = b.addWriteFiles();
        const props_output = wf.addCopyFile(props_run.captureStdOut(), "props.zig");
        const symbols_output = wf.addCopyFile(symbols_run.captureStdOut(), "symbols.zig");

        return .{
            .props_output = props_output,
            .symbols_output = symbols_output,
        };
    }

    pub fn addModuleImport(self: *const UnicodeTables, module: *std.Build.Module) void {
        module.addAnonymousImport("unicode_tables", .{
            .root_source_file = self.props_output,
        });
        module.addAnonymousImport("symbols_tables", .{
            .root_source_file = self.symbols_output,
        });
    }
};

fn addBuildOptions(
    b: *std.Build,
    module: *std.Build.Module,
    simd_enabled: bool,
) void {
    const build_opts = b.addOptions();
    build_opts.addOption(bool, "simd", simd_enabled);
    module.addOptions("build_options", build_opts);
}

fn addVtDeps(
    b: *std.Build,
    module: *std.Build.Module,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
) void {
    if (b.lazyDependency("wuffs", .{
        .target = target,
        .optimize = optimize,
    })) |dep| {
        module.addImport("wuffs", dep.module("wuffs"));
    }

    if (b.lazyDependency("oniguruma", .{
        .target = target,
        .optimize = optimize,
    })) |dep| {
        module.addImport("oniguruma", dep.module("oniguruma"));
        module.linkLibrary(dep.artifact("oniguruma"));
    }
}

fn addSimdDeps(
    b: *std.Build,
    module: *std.Build.Module,
    ghostty_dep: *std.Build.Dependency,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
) !void {
    if (b.lazyDependency("simdutf", .{
        .target = target,
        .optimize = optimize,
    })) |simdutf_dep| {
        module.linkLibrary(simdutf_dep.artifact("simdutf"));
    }

    if (b.lazyDependency("highway", .{
        .target = target,
        .optimize = optimize,
    })) |highway_dep| {
        module.linkLibrary(highway_dep.artifact("highway"));
    }

    if (b.lazyDependency("utfcpp", .{
        .target = target,
        .optimize = optimize,
    })) |utfcpp_dep| {
        module.linkLibrary(utfcpp_dep.artifact("utfcpp"));
    }

    module.addIncludePath(ghostty_dep.path("src"));

    const flags: []const []const u8 = if (target.result.cpu.arch == .x86_64)
        &.{b.fmt("-DHWY_DISABLED_TARGETS={}", .{(@as(c_int, 1 << 3) | @as(c_int, 1 << 4) | @as(c_int, 1 << 6) | @as(c_int, 1 << 7) | @as(c_int, 1 << 8))})}
    else
        &.{};

    module.addCSourceFiles(.{
        .root = ghostty_dep.path(""),
        .flags = flags,
        .files = &.{
            "src/simd/base64.cpp",
            "src/simd/codepoint_width.cpp",
            "src/simd/index_of.cpp",
            "src/simd/vt.cpp",
        },
    });
}

fn addUucodeImport(
    b: *std.Build,
    module: *std.Build.Module,
    uucode_tables: std.Build.LazyPath,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
    build_config_path: std.Build.LazyPath,
) void {
    if (b.lazyDependency("uucode", .{
        .target = target,
        .optimize = optimize,
        .tables_path = uucode_tables,
        .build_config_path = build_config_path,
    })) |dep| {
        module.addImport("uucode", dep.module("uucode"));
    }
}

pub fn build(b: *std.Build) !void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const simd_default = !target.result.cpu.arch.isWasm();
    const simd_enabled = b.option(bool, "simd", "Enable SIMD fast paths") orelse simd_default;

    const ghostty_dep = b.dependency("ghostty", .{});

    const uucode_dep = b.dependency("uucode", .{
        .build_config_path = ghostty_dep.path("src/build/uucode_config.zig"),
    });
    const uucode_tables = uucode_dep.namedLazyPath("tables.zig");

    const unicode_tables = try UnicodeTables.init(b, ghostty_dep, uucode_tables);

    const terminal_options: TerminalOptions = .{
        .artifact = .lib,
        .oniguruma = true,
        .simd = simd_enabled,
        .c_abi = true,
        .slow_runtime_safety = switch (optimize) {
            .Debug => true,
            .ReleaseSafe,
            .ReleaseSmall,
            .ReleaseFast,
            => false,
        },
        .kitty_graphics_passthrough = true,
    };

    const terminal_options_mod = b.addOptions();
    terminal_options_mod.addOption(TerminalArtifact, "artifact", terminal_options.artifact);
    terminal_options_mod.addOption(bool, "c_abi", terminal_options.c_abi);
    terminal_options_mod.addOption(bool, "oniguruma", terminal_options.oniguruma);
    terminal_options_mod.addOption(bool, "simd", terminal_options.simd);
    terminal_options_mod.addOption(bool, "slow_runtime_safety", terminal_options.slow_runtime_safety);
    terminal_options_mod.addOption(bool, "kitty_graphics_passthrough", terminal_options.kitty_graphics_passthrough);
    terminal_options_mod.addOption(bool, "kitty_graphics", terminal_options.oniguruma);
    terminal_options_mod.addOption(bool, "tmux_control_mode", terminal_options.oniguruma);

    const ghostty_module = b.createModule(.{
        .root_source_file = ghostty_dep.path("src/lib_vt.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
        .link_libcpp = simd_enabled,
    });

    ghostty_module.addOptions("terminal_options", terminal_options_mod);
    addBuildOptions(b, ghostty_module, simd_enabled);
    unicode_tables.addModuleImport(ghostty_module);
    addVtDeps(b, ghostty_module, target, optimize);
    if (simd_enabled) {
        try addSimdDeps(b, ghostty_module, ghostty_dep, target, optimize);
    } else {
        addUucodeImport(b, ghostty_module, uucode_tables, target, optimize, ghostty_dep.path("src/build/uucode_config.zig"));
    }

    const lib = b.addLibrary(.{
        .name = "ghostty-vt",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        }),
        .linkage = .dynamic,
    });

    lib.root_module.addImport("ghostty", ghostty_module);
    lib.installHeadersDirectory(
        b.path("include/zig-ghostty-wrapper"),
        "zig-ghostty-wrapper",
        .{ .include_extensions = &.{".h"} },
    );

    b.installArtifact(lib);

    const main_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        }),
    });

    main_tests.root_module.addImport("ghostty", ghostty_module);

    const run_tests = b.addRunArtifact(main_tests);
    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&run_tests.step);
}
