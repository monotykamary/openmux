/**
 * Build script for openmux that uses the Solid.js Bun plugin
 * This is needed because `bun build --compile` doesn't use preload scripts
 */

import solidTransformPlugin from "@opentui/solid/bun-plugin";

// Bundle main entry with Solid.js plugin
const mainResult = await Bun.build({
  entrypoints: ["./src/index.tsx"],
  outdir: "./dist",
  minify: true,
  target: "bun",
  packages: "bundle",
  plugins: [solidTransformPlugin],
});

if (!mainResult.success) {
  console.error("Main bundle failed:");
  for (const log of mainResult.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Bundle worker separately (no Solid plugin needed, no JSX)
// Output as emulator-worker.ts to match the URL reference in worker-pool.ts
const workerResult = await Bun.build({
  entrypoints: ["./src/terminal/emulator-worker.ts"],
  outdir: "./dist",
  minify: true,
  target: "bun",
  packages: "bundle",
  naming: "emulator-worker.ts", // Keep .ts extension to match URL reference
});

if (!workerResult.success) {
  console.error("Worker bundle failed:");
  for (const log of workerResult.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log("Bundle created successfully");
