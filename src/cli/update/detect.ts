import fsSync from 'node:fs';
import path from 'node:path';
import type { UpdateIO, ManagedInstall, PackageManagerInstall } from './types';
import { normalizeVersion } from './io';

function getManagedInstallDir(env: NodeJS.ProcessEnv): string | null {
  const home = env.HOME ?? env.USERPROFILE ?? '';
  if (!home) return null;
  const dataHome = env.XDG_DATA_HOME ?? path.join(home, '.local', 'share');
  return path.join(dataHome, 'openmux');
}

function getManagedBinDir(env: NodeJS.ProcessEnv): string | null {
  const home = env.HOME ?? env.USERPROFILE ?? '';
  if (!home) return null;
  return env.XDG_BIN_HOME ?? path.join(home, '.local', 'bin');
}

export async function detectManagedInstall(
  io: UpdateIO
): Promise<{ ok: true; value: ManagedInstall } | { ok: false; error: string }> {
  const managedDir = getManagedInstallDir(io.env);
  if (!managedDir) {
    return { ok: false, error: 'Could not determine managed install directory (HOME is not set).' };
  }
  const binDir = getManagedBinDir(io.env);
  if (!binDir) {
    return { ok: false, error: 'Could not determine managed bin directory (HOME is not set).' };
  }

  const execDir = path.dirname(io.execPath);
  const execName = path.basename(io.execPath);
  if (execName !== 'openmux-bin' && execName !== 'openmux-bin.exe') {
    return {
      ok: false,
      error:
        'This install is not managed by openmux update. Use your package manager or installer to update.',
    };
  }

  if (path.resolve(execDir) !== path.resolve(managedDir)) {
    return {
      ok: false,
      error: `Managed install expected at ${managedDir}, but running binary from ${execDir}.`,
    };
  }

  const versionPath = path.join(managedDir, '.version');
  let currentVersion: string;
  const readResult = await io.readFile(versionPath);
  if (readResult instanceof Error) {
    return {
      ok: false,
      error: `Missing version metadata at ${versionPath}. Reinstall openmux with the official installer.`,
    };
  }
  currentVersion = normalizeVersion(readResult);

  if (!currentVersion) {
    return {
      ok: false,
      error: `Version metadata at ${versionPath} is empty. Reinstall openmux with the official installer.`,
    };
  }

  return {
    ok: true,
    value: {
      binDir,
      wrapperPath: path.join(binDir, 'openmux'),
      installDir: managedDir,
      currentVersion,
    },
  };
}

function fileExists(targetPath: string): boolean {
  try {
    fsSync.accessSync(targetPath, fsSync.constants.F_OK);
    return true;
  } catch {
    // intentionally ignored: file may not exist
    return false;
  }
}

function detectPackageManagerFromPath(env: NodeJS.ProcessEnv): PackageManagerInstall | null {
  const pathValue = env.PATH ?? '';
  if (!pathValue) return null;

  const entries = pathValue.split(path.delimiter).filter((entry) => entry.length > 0);
  for (const entry of entries) {
    const normalizedEntry = path.resolve(entry);

    // Ignore project-local node_modules/.bin entries. We only care about global installs.
    if (normalizedEntry.includes(`${path.sep}node_modules${path.sep}.bin`)) {
      continue;
    }

    const wrapperPath = path.join(entry, 'openmux');
    if (!fileExists(wrapperPath)) {
      continue;
    }

    let resolvedWrapperPath = wrapperPath;
    try {
      resolvedWrapperPath = fsSync.realpathSync(wrapperPath);
    } catch {
      // Keep original wrapper path.
    }

    const candidates = [path.resolve(wrapperPath), path.resolve(resolvedWrapperPath)];

    if (
      candidates.some(
        (candidate) =>
          candidate.includes(`${path.sep}.bun${path.sep}`) || candidate.includes('bun/install')
      )
    ) {
      return { type: 'bun', updateCommand: 'bun update -g openmux' };
    }

    if (
      candidates.some(
        (candidate) =>
          candidate.includes(`${path.sep}node_modules${path.sep}openmux${path.sep}`) ||
          candidate.includes(`${path.sep}.npm${path.sep}`)
      )
    ) {
      return { type: 'npm', updateCommand: 'npm update -g openmux' };
    }

    if (path.basename(normalizedEntry) === 'bin') {
      const npmPackagePath = path.join(
        path.dirname(normalizedEntry),
        'lib',
        'node_modules',
        'openmux',
        'package.json'
      );
      if (fileExists(npmPackagePath)) {
        return { type: 'npm', updateCommand: 'npm update -g openmux' };
      }
    }
  }

  return null;
}

export function detectPackageManager(
  execPath: string,
  env: NodeJS.ProcessEnv
): PackageManagerInstall | null {
  if (execPath.includes(`${path.sep}.bun${path.sep}`) || execPath.includes('bun/install')) {
    return { type: 'bun', updateCommand: 'bun update -g openmux' };
  }

  if (
    execPath.includes(`${path.sep}node_modules${path.sep}`) ||
    execPath.includes(`${path.sep}.npm${path.sep}`) ||
    execPath.includes('/usr/local/lib/node_modules') ||
    execPath.includes('/usr/lib/node_modules')
  ) {
    return { type: 'npm', updateCommand: 'npm update -g openmux' };
  }

  const managedDir = getManagedInstallDir(env);
  if (managedDir && path.resolve(path.dirname(execPath)) === path.resolve(managedDir)) {
    const home = env.HOME ?? env.USERPROFILE ?? '';
    if (home) {
      const bunGlobalBin = path.join(home, '.bun', 'bin', 'openmux');
      if (fileExists(bunGlobalBin)) {
        return { type: 'bun', updateCommand: 'bun update -g openmux' };
      }

      const npmGlobalPrefix = path.join(home, '.npm-global');
      const npmGlobalWrapper = path.join(npmGlobalPrefix, 'bin', 'openmux');
      const npmGlobalPackage = path.join(
        npmGlobalPrefix,
        'lib',
        'node_modules',
        'openmux',
        'package.json'
      );
      if (fileExists(npmGlobalWrapper) && fileExists(npmGlobalPackage)) {
        return { type: 'npm', updateCommand: 'npm update -g openmux' };
      }
    }

    const fromPath = detectPackageManagerFromPath(env);
    if (fromPath) {
      return fromPath;
    }
  }

  return null;
}

export function suggestPackageManagerUpdate(io: UpdateIO, pmInstall: PackageManagerInstall): void {
  io.log(`openmux is installed via ${pmInstall.type}.`);
  io.log(`To update, run: ${pmInstall.updateCommand}`);
}
