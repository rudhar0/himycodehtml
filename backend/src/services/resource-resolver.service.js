import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'node:url';
import { getBackendRoot, getRuntimeDir } from '../utils/project-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ResourceResolver {
  constructor() {
    // Resolve project root dynamically from this file location
    const backendRoot = getBackendRoot(import.meta.url);
    this.projectRoot = path.resolve(backendRoot, '..');
    
    // Check for resources in both sibling (dev) and child (portable) locations
    const siblingResources = path.join(this.projectRoot, 'resources');
    const childResources = path.join(backendRoot, 'resources');
    
    // HEURISTIC: In Dev, backend/resources might exist as a build artifact but be incomplete.
    // In Portable, backend/resources is the source of truth and MUST contain the toolchain.
    const isChildValid = fs.existsSync(path.join(childResources, 'toolchain', 'headers')) || 
                         fs.existsSync(path.join(childResources, 'toolchain', 'windows')) ||
                         fs.existsSync(path.join(childResources, 'toolchain', 'macos')) ||
                         fs.existsSync(path.join(childResources, 'toolchain', 'linux'));

    this.resourcesRoot = isChildValid ? childResources : siblingResources;
    this.toolchainRoot = path.join(this.resourcesRoot, 'toolchain');

    // FIX trace.h resolution: ensure we have a fallback for source-based resources
    this.cppRoot = path.join(this.resourcesRoot, 'cpp');
    
    // FIX: Use user-writable directory (Program Files is read-only) via unified helper
    this.runtimeRoot = getRuntimeDir(backendRoot);

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
  getCppRoot() { return this.cppRoot; }
  getRuntimeRoot() { return this.runtimeRoot; }
  getTempRoot() { return path.join(this.runtimeRoot, 'temp'); }

  // Session folder path for a given session id
  getSessionPath(sessionId) {
    return path.join(this.getTempRoot(), `session_${sessionId}`);
  }
}

const resourceResolver = new ResourceResolver();
export default resourceResolver;
