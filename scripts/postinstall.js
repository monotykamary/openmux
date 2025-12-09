#!/usr/bin/env node

/**
 * openmux postinstall script
 * Downloads prebuilt binaries from GitHub releases
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");

const REPO = "monotykamary/openmux";
const PACKAGE_ROOT = path.join(__dirname, "..");
const DIST_DIR = path.join(PACKAGE_ROOT, "dist");

function getPlatform() {
  const platform = process.platform;
  const arch = process.arch;

  let os;
  switch (platform) {
    case "darwin":
      os = "darwin";
      break;
    case "linux":
      os = "linux";
      break;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }

  let cpu;
  switch (arch) {
    case "x64":
      cpu = "x64";
      break;
    case "arm64":
      cpu = "arm64";
      break;
    default:
      throw new Error(`Unsupported architecture: ${arch}`);
  }

  return { os, arch: cpu, target: `${os}-${cpu}` };
}

function getVersion() {
  const packageJson = require(path.join(PACKAGE_ROOT, "package.json"));
  return `v${packageJson.version}`;
}

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "openmux-installer" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        fetch(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        return;
      }
      resolve(res);
    }).on("error", reject);
  });
}

async function downloadFile(url, destPath) {
  console.log(`Downloading ${url}...`);

  const response = await fetch(url);
  const writeStream = fs.createWriteStream(destPath);

  return new Promise((resolve, reject) => {
    response.pipe(writeStream);
    writeStream.on("finish", () => {
      writeStream.close();
      resolve();
    });
    writeStream.on("error", reject);
  });
}

async function main() {
  // Skip in CI or when OPENMUX_SKIP_DOWNLOAD is set
  if (process.env.CI || process.env.OPENMUX_SKIP_DOWNLOAD) {
    console.log("Skipping binary download");
    return;
  }

  try {
    const { target } = getPlatform();
    const version = getVersion();

    console.log(`Installing openmux ${version} for ${target}...`);

    const url = `https://github.com/${REPO}/releases/download/${version}/openmux-${version}-${target}.tar.gz`;

    // Ensure dist directory exists
    fs.mkdirSync(DIST_DIR, { recursive: true });

    const tarballPath = path.join(DIST_DIR, "download.tar.gz");

    await downloadFile(url, tarballPath);

    console.log("Extracting...");

    // Use native tar command to extract
    execSync(`tar -xzf "${tarballPath}" -C "${DIST_DIR}"`, { stdio: "inherit" });

    // Clean up tarball
    fs.unlinkSync(tarballPath);

    // Make binary executable
    const binaryPath = path.join(DIST_DIR, "openmux-bin");
    if (fs.existsSync(binaryPath)) {
      fs.chmodSync(binaryPath, 0o755);
    }

    // Make wrapper executable
    const wrapperPath = path.join(DIST_DIR, "openmux");
    if (fs.existsSync(wrapperPath)) {
      fs.chmodSync(wrapperPath, 0o755);
    }

    console.log("openmux installed successfully!");
  } catch (error) {
    // Don't fail the install if download fails
    // User might be building from source
    console.warn(`Warning: Could not download prebuilt binary: ${error.message}`);
    console.warn("You may need to build from source: bun run build");
  }
}

main();
