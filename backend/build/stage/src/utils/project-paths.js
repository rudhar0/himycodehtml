import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fs from 'node:fs';
import os from 'node:os';

export function getBackendRoot(fromImportMetaUrl) {
  if (process.env.NEUTRALA_APP_ROOT) return path.resolve(process.env.NEUTRALA_APP_ROOT);

  if (process.pkg) return path.dirname(process.execPath);

  let current = fileURLToPath(fromImportMetaUrl);
  // Walk up until we find a directory containing 'package.json' and 'src'
  while (current !== path.dirname(current)) {
    const dir = path.dirname(current);
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'src'))) {
      return dir;
    }
    current = dir;
  }

  // Fallback to previous logic if search fails
  const here = path.dirname(fileURLToPath(fromImportMetaUrl));
  if (here.endsWith('utils')) return path.resolve(here, '..', '..');
  if (here.endsWith('services') || here.endsWith('routes') || here.endsWith('sockets')) return path.resolve(here, '..', '..');
  return path.resolve(here, '..');
}

export function getRuntimeDir(backendRoot) {
  // Priority 1: Frontend explicitly told us where to write (EXE installer flow).
  // When the desktop frontend spawns us, it computes a writable path and passes it
  // via RUNTIME_DIR so both sides agree without guessing.
  if (process.env.RUNTIME_DIR) {
    const explicitDir = path.resolve(process.env.RUNTIME_DIR);
    try {
      if (!fs.existsSync(explicitDir)) {
        fs.mkdirSync(explicitDir, { recursive: true });
      }
      return explicitDir;
    } catch (e) {
      // Fall through to auto-detection if mkdir fails
    }
  }

  const appName = 'CodeViz';
  let fallbackBase = '';
  
  if (process.platform === 'win32') {
    fallbackBase = process.env.LOCALAPPDATA || process.env.APPDATA || os.tmpdir();
  } else {
    fallbackBase = process.env.HOME ? path.join(process.env.HOME, '.local', 'share') : os.tmpdir();
  }
  
  const fallbackDir = path.join(fallbackBase, appName, 'runtime');
  const localDir = path.join(backendRoot, '.runtime');

  // Priority 2: Non-system path (portable layout) — try local first.
  // Priority 3: System install — skip directly to AppData/Home.
  const isSystemDir = backendRoot.includes('Program Files') || 
                      backendRoot.includes('WindowsApps') || 
                      backendRoot.includes('snap') ||
                      backendRoot.startsWith('/usr/') ||
                      backendRoot.startsWith('/opt/');

  if (!isSystemDir) {
    try {
      if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
      }
      // Check writability
      const testFile = path.join(localDir, `.write_test_${process.pid}`);
      fs.writeFileSync(testFile, '');
      fs.unlinkSync(testFile);
      return localDir;
    } catch (e) {
      // Local dir is read-only or inaccessible, proceed to fallback
    }
  }

  // Fallback to a user-writable directory (AppData/Home)
  if (!fs.existsSync(fallbackDir)) {
    fs.mkdirSync(fallbackDir, { recursive: true });
  }
  return fallbackDir;
}

export function getBuildDir(backendRoot) {
  return path.join(backendRoot, 'build');
}
