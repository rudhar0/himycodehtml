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
  const appName = 'CodeViz';
  let fallbackBase = '';
  
  if (process.platform === 'win32') {
    fallbackBase = process.env.LOCALAPPDATA || process.env.APPDATA || os.tmpdir();
  } else {
    fallbackBase = process.env.HOME ? path.join(process.env.HOME, '.local', 'share') : os.tmpdir();
  }
  
  const fallbackDir = path.join(fallbackBase, appName, 'runtime');
  const localDir = path.join(backendRoot, '.runtime');

  // Logic for portable vs system installations:
  // 1. If explicitly forced to use local (e.g. by frontend), try local first.
  // 2. If NOT in a system directory (Program Files, etc.), try local first (Standard Portable behavior).
  // 3. Otherwise (System install), go straight to AppData/Home.

  const forceLocal = process.env.NEUTRALA_FORCE_LOCAL_RUNTIME === 'true';
  const isSystemDir = backendRoot.includes('Program Files') || 
                      backendRoot.includes('WindowsApps') || 
                      backendRoot.includes('snap') ||
                      backendRoot.startsWith('/usr/') ||
                      backendRoot.startsWith('/opt/');

  const shouldTryLocal = forceLocal || !isSystemDir;

  if (shouldTryLocal) {
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
