import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function getBackendRoot(fromImportMetaUrl) {
  if (process.env.NEUTRALA_APP_ROOT) return path.resolve(process.env.NEUTRALA_APP_ROOT);

  // When packaged with `pkg`, sources live in a virtual snapshot. Use the executable
  // directory so `.runtime/` and `resources/` resolve next to the binary.
  if (process.pkg) return path.dirname(process.execPath);

  const here = path.dirname(fileURLToPath(fromImportMetaUrl));
  return path.resolve(here, '..'); // backend/src -> backend
}

export function getRuntimeDir(backendRoot) {
  return path.join(backendRoot, '.runtime');
}

export function getBuildDir(backendRoot) {
  return path.join(backendRoot, 'build');
}
