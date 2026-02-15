import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ResourceResolver {
  constructor() {
    // Resolve project root dynamically from this file location
    // In dev: backend/src/services -> backend/src -> backend
    // In pkg: projectRoot is where the executable is located
    if (process.pkg) {
      this.projectRoot = path.dirname(process.execPath);
    } else {
      this.projectRoot = path.resolve(__dirname, '..', '..', '..');
    }
    this.resourcesRoot = path.join(this.projectRoot, 'resources');
    this.toolchainRoot = path.join(this.resourcesRoot, 'toolchain');
    // FIX: Use user-writable directory (Program Files is read-only)
    this.runtimeRoot = this._resolveRuntimeRoot();

    // Ensure runtime/temp exists
    this.ensureDir(path.join(this.runtimeRoot, 'temp'));
  }

  _resolveRuntimeRoot() {
    const appName = 'CodeViz';
    // 1. Try LOCALAPPDATA (Windows standard for user data)
    if (process.env.LOCALAPPDATA) {
      return path.join(process.env.LOCALAPPDATA, appName, 'runtime');
    }
    // 2. Try APPDATA (Roaming)
    if (process.env.APPDATA) {
      return path.join(process.env.APPDATA, appName, 'runtime');
    }
    // 3. Fallback to OS temp dir
    return path.join(os.tmpdir(), appName, 'runtime');
  }

  ensureDir(p) {
    try {
      fs.mkdirSync(p, { recursive: true });
    } catch (e) {
      // ignore
    }
  }

  getProjectRoot() { return this.projectRoot; }
  getResourcesRoot() { return this.resourcesRoot; }
  getToolchainRoot() { return this.toolchainRoot; }
  getRuntimeRoot() { return this.runtimeRoot; }
  getTempRoot() { return path.join(this.runtimeRoot, 'temp'); }

  // Session folder path for a given session id
  getSessionPath(sessionId) {
    return path.join(this.getTempRoot(), `session_${sessionId}`);
  }
}

const resourceResolver = new ResourceResolver();
export default resourceResolver;
