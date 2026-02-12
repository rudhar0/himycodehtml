import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ResourceResolver {
  constructor() {
    // Resolve project root dynamically from this file location
    // backend/src/services -> backend/src -> backend -> project root
    this.projectRoot = path.resolve(__dirname, '..', '..', '..');
    this.resourcesRoot = path.join(this.projectRoot, 'resources');
    this.toolchainRoot = path.join(this.resourcesRoot, 'toolchain');
    this.runtimeRoot = path.join(this.resourcesRoot, 'runtime');

    // Ensure runtime/temp exists
    this.ensureDir(path.join(this.runtimeRoot, 'temp'));
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
