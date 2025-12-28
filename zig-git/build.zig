const std = @import("std");

fn fileExists(path: []const u8) bool {
    std.fs.cwd().access(path, .{}) catch return false;
    return true;
}

fn addLibgit2Deps(
    b: *std.Build,
    target: std.Build.ResolvedTarget,
    compile: *std.Build.Step.Compile,
    libgit2_dir_opt: []const u8,
    libgit2_build_dir_opt: []const u8,
) void {
    const libgit2_dir = b.pathFromRoot(libgit2_dir_opt);
    const libgit2_build_dir = b.pathFromRoot(libgit2_build_dir_opt);

    const lib_name = if (target.result.os.tag == .windows) "git2.lib" else "libgit2.a";
    const lib_path = b.pathJoin(&.{ libgit2_build_dir, lib_name });
    const lib_release_path = b.pathJoin(&.{ libgit2_build_dir, "Release", lib_name });

    var needs_build = !fileExists(lib_path);
    if (!needs_build and target.result.os.tag == .windows) {
        needs_build = !fileExists(lib_release_path);
    }

    if (needs_build) {
        const cmake_config = b.addSystemCommand(&.{
            "cmake",
            "-S",
            libgit2_dir,
            "-B",
            libgit2_build_dir,
            "-DBUILD_SHARED_LIBS=OFF",
            "-DBUILD_CLAR=OFF",
            "-DBUILD_TESTS=OFF",
            "-DBUILD_EXAMPLES=OFF",
            "-DBUILD_CLI=OFF",
            "-DUSE_SSH=OFF",
            "-DUSE_HTTPS=OFF",
            "-DUSE_GSSAPI=OFF",
            "-DUSE_NTLMCLIENT=OFF",
            "-DUSE_BUNDLED_ZLIB=ON",
            "-DUSE_BUNDLED_PCRE=ON",
            "-DUSE_BUNDLED_HTTP_PARSER=ON",
            "-DCMAKE_POSITION_INDEPENDENT_CODE=ON",
            "-DCMAKE_BUILD_TYPE=Release",
        });

        const cmake_build = b.addSystemCommand(&.{
            "cmake",
            "--build",
            libgit2_build_dir,
            "--config",
            "Release",
        });
        cmake_build.step.dependOn(&cmake_config.step);
        compile.step.dependOn(&cmake_build.step);
    }

    compile.root_module.addIncludePath(.{
        .cwd_relative = b.pathJoin(&.{ libgit2_dir, "include" }),
    });
    compile.addLibraryPath(.{ .cwd_relative = libgit2_build_dir });
    if (target.result.os.tag == .windows) {
        compile.addLibraryPath(.{
            .cwd_relative = b.pathJoin(&.{ libgit2_build_dir, "Release" }),
        });
    }
    compile.linkSystemLibrary("git2");

    if (target.result.os.tag == .linux) {
        compile.linkSystemLibrary("pthread");
        compile.linkSystemLibrary("dl");
    } else if (target.result.os.tag == .macos) {
        compile.linkSystemLibrary("iconv");
    }
}

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const libgit2_dir_opt = b.option(
        []const u8,
        "libgit2_dir",
        "Path to libgit2 sources",
    ) orelse "../vendor/libgit2";
    const libgit2_build_dir_opt = b.option(
        []const u8,
        "libgit2_build_dir",
        "Path to libgit2 build directory",
    ) orelse "zig-out/libgit2";

    const lib = b.addLibrary(.{
        .name = "zig_git",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        }),
        .linkage = .dynamic,
    });

    addLibgit2Deps(b, target, lib, libgit2_dir_opt, libgit2_build_dir_opt);

    b.installArtifact(lib);

    const main_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        }),
    });

    addLibgit2Deps(b, target, main_tests, libgit2_dir_opt, libgit2_build_dir_opt);

    const run_tests = b.addRunArtifact(main_tests);
    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&run_tests.step);
}
