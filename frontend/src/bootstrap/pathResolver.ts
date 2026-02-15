/**
 * Path Resolver Module
 * Handles cross-platform path construction and dynamic binary resolution.
 * Assumes strict portable layout:
 *   root/
 *     desktop/ (NL_PATH)
 *     backend/
 */

/* global Neutralino */

const LOG_PREFIX = '[bootstrap:path]';

export interface RuntimePaths {
  appDir: string;
  backendDir: string;
  runtimeDir: string;
  resourcesDir: string;
  executablePath: string;
}

/**
 * Detects the correct directory separator for the current OS.
 */
function getSeparator(): string {
  const os = (globalThis as any).NL_OS || 'Windows';
  return os.toLowerCase().includes('win') ? '\\' : '/';
}

/**
 * Normalizes a path by fixing separators and removing trailing slashes.
 */
function normalizePath(p: string): string {
  if (!p) return '';
  const sep = getSeparator();
  // Replace mixed separators with OS specific one
  let normalized = p.replace(/[\\/]+/g, sep);
  // Remove trailing separator unless it's root (e.g. C:\)
  if (normalized.length > 1 && normalized.endsWith(sep) && !normalized.endsWith(`:${sep}`)) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * Joins path segments using OS separator.
 */
function joinPaths(...parts: string[]): string {
  const sep = getSeparator();
  return normalizePath(parts.join(sep));
}

/**
 * Resolves the root application directory based on Neutralino environment.
 */
export async function resolveAppDir(): Promise<string> {
  // NL_PATH is provided by Neutralino at runtime (usually points to the directory of resources)
  let nlPath = (globalThis as any).NL_PATH || '';
  
  if (!nlPath && (globalThis as any).Neutralino) {
    try {
      const config = await (globalThis as any).Neutralino.app.getConfig();
      // dataPath typically points to where the app is running
      nlPath = config.dataPath || '';
    } catch (e) {
      console.warn(LOG_PREFIX, 'Failed to get config for path resolution:', e);
    }
  }
  
  // If still empty (e.g. dev mode without NL_PATH), fallback to current location or empty
  if (!nlPath) {
    // Check if we are in a dev environment (Vite sets import.meta.env)
    const isDev = import.meta.env?.DEV;
    if (!isDev) {
      console.warn(LOG_PREFIX, 'NL_PATH is undefined, using ".". This may fail in portable mode.');
    } else {
      console.debug(LOG_PREFIX, 'NL_PATH undefined in dev mode, defaulting to "."');
    }
    nlPath = '.';
  }
  
  const resolved = normalizePath(nlPath);
  console.log(LOG_PREFIX, 'Resolved appDir:', resolved);
  return resolved;
}

/**
 * Finds the backend executable wrapper.
 * Scans the backend directory for a file ending in '-server' or '-server.exe'.
 */
async function findBackendBinary(backendDir: string): Promise<string> {
  try {
    if (!(globalThis as any).Neutralino) {
       console.warn(LOG_PREFIX, 'Neutralino global not found, cannot scan for backend binary.');
       throw new Error('Neutralino not available');
    }
    const entries = await (globalThis as any).Neutralino.filesystem.readDirectory(backendDir);
    const isWindows = getSeparator() === '\\';
    
    // Look for generated server binary
    const binary = entries.find((e: any) => {
      if (e.type !== 'FILE') return false;
      const name = e.entry.toLowerCase();
      // Match build.js output: ${safeName}-server(.exe)
      if (isWindows) {
        return name.endsWith('-server.exe');
      } else {
        return name.endsWith('-server') && !name.includes('.');
      }
    });

    if (binary) {
      const fullPath = joinPaths(backendDir, binary.entry);
      console.log(LOG_PREFIX, 'Found backend binary:', fullPath);
      return fullPath;
    }
  } catch (error) {
    console.warn(LOG_PREFIX, 'Failed to scan backend dir:', error);
  }

  // Fallback (should be caught by validation later)
  const defaultName = getSeparator() === '\\' ? 'codeviz-server.exe' : 'codeviz-server';
  console.warn(LOG_PREFIX, 'Could not dynamically find binary, falling back to default:', defaultName);
  return joinPaths(backendDir, defaultName);
}

/**
 * Resolves the backend directory by scanning parent directories relative to appDir.
 * This is more resilient than a fixed "../backend" relationship.
 */
async function resolveBackendDir(appDir: string): Promise<string> {
  const sep = getSeparator();
  const dirNames = ['backend', 'CodeViz-Backend']; // Potential names
  
  // Start from appDir and go up to 3 levels
  let current = appDir;
  for (let i = 0; i < 3; i++) {
    for (const name of dirNames) {
      const candidate = joinPaths(current, '..', name);
      try {
        if ((globalThis as any).Neutralino) {
          const stats = await (globalThis as any).Neutralino.filesystem.getStats(candidate);
          if (stats) {
            console.log(LOG_PREFIX, `Found backend directory at level ${i+1}:`, candidate);
            return normalizePath(candidate);
          }
        }
      } catch (e) {
        // ignore
      }
    }
    current = joinPaths(current, '..');
  }

  // Fallback to strict layout
  const fallback = joinPaths(appDir, '..', 'backend');
  console.warn(LOG_PREFIX, 'Could not find backend dir by scanning, falling back to:', fallback);
  return fallback;
}

/**
 * Resolves all critical runtime paths.
 */
export async function resolveAllPaths(): Promise<RuntimePaths> {
  const appDir = await resolveAppDir();
  const backendDir = await resolveBackendDir(appDir);
  
  const runtimeDir = joinPaths(backendDir, '.runtime');
  const resourcesDir = joinPaths(backendDir, 'resources');
  
  const executablePath = await findBackendBinary(backendDir);

  const paths = {
    appDir,
    backendDir,
    runtimeDir,
    resourcesDir,
    executablePath
  };

  console.log(LOG_PREFIX, 'Runtime paths resolved:', paths);
  return paths;
}
