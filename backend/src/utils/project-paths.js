import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fs from 'node:fs';
import os from 'node:os';

export function getBackendRoot(fromImportMetaUrl) {
  if (process.env.NEUTRALA_APP_ROOT) return path.resolve(process.env.NEUTRALA_APP_ROOT);

  // When packaged with `pkg`, sources live in a virtual snapshot. Use the executable
  // directory so `.runtime/` and `resources/` resolve next to the binary.
  if (process.pkg) return path.dirname(process.execPath);

  const here = path.dirname(fileURLToPath(fromImportMetaUrl));
  return path.resolve(here, '..'); // backend/src -> backend
}

export function getRuntimeDir(backendRoot) {
  const localDir = path.join(backendRoot, '.runtime');
  
  // Logic:
  // 1. If localDir exists, check if it's writable.
  // 2. If it doesn't exist, try to create it. If create fails, use fallback.
  // 3. Fallback to a user-writable directory if local is read-only.
  
  try {
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }
    // Check writability by attempting to write a tiny temp file
    const testFile = path.join(localDir, `.write_test_${process.pid}`);
    fs.writeFileSync(testFile, '');
    fs.unlinkSync(testFile);
    return localDir;
  } catch (e) {
    // Fallback required
    const appName = 'CodeViz';
    let fallbackBase = '';
    
    if (process.platform === 'win32') {
      fallbackBase = process.env.LOCALAPPDATA || process.env.APPDATA || os.tmpdir();
    } else {
      fallbackBase = process.env.HOME ? path.join(process.env.HOME, '.local', 'share') : os.tmpdir();
    }
    
    const fallbackDir = path.join(fallbackBase, appName, 'runtime');
    if (!fs.existsSync(fallbackDir)) {
      fs.mkdirSync(fallbackDir, { recursive: true });
    }
    return fallbackDir;
  }
}

export function getBuildDir(backendRoot) {
  return path.join(backendRoot, 'build');
}
