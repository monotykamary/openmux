const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // Shared library for FFI
    const lib = b.addLibrary(.{
        .name = "zig_pty",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        }),
        .linkage = .dynamic,
    });

    // Link libproc on macOS for proc_name, proc_pidinfo, etc.
    if (target.result.os.tag == .macos) {
        lib.root_module.linkSystemLibrary("proc", .{});
    }

    // Install the library
    b.installArtifact(lib);

    // Unit tests
    const main_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        }),
    });

    // Link libproc on macOS for tests too
    if (target.result.os.tag == .macos) {
        main_tests.root_module.linkSystemLibrary("proc", .{});
    }

    const run_main_tests = b.addRunArtifact(main_tests);
    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&run_main_tests.step);
}
