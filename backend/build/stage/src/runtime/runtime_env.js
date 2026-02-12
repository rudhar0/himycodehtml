import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function detectPlatform() {
  const plat = process.platform;
  if (plat === 'win32') return 'windows';
  if (plat === 'darwin') return 'macos';
  return 'linux';
}

function toolchainRoot() {
  return path.resolve(__dirname, '../../resources/toolchain');
}

function prepareRuntimeEnv(overrides = {}){
  const root = overrides.toolchainRoot || toolchainRoot();
  const plat = overrides.platform || detectPlatform();
  const env = Object.assign({}, process.env);
  const bin = path.join(root, plat, 'bin');
  const lib = path.join(root, plat, 'lib');

  // Prepend toolchain bin
  env.PATH = bin + path.delimiter + (env.PATH || '');

  // Library search paths by platform
  if (process.platform === 'linux') {
    env.LD_LIBRARY_PATH = lib + (env.LD_LIBRARY_PATH ? (path.delimiter + env.LD_LIBRARY_PATH) : '');
  } else if (process.platform === 'darwin') {
    env.DYLD_LIBRARY_PATH = lib + (env.DYLD_LIBRARY_PATH ? (path.delimiter + env.DYLD_LIBRARY_PATH) : '');
  } else if (process.platform === 'win32') {
    // ensure lib (DLL) resolution on Windows by adding lib dir to PATH
    env.PATH = lib + path.delimiter + env.PATH;
  }

  // Minimal predictable environment
  env.TZ = env.TZ || 'UTC';

  return {env, root, plat, bin, lib};
}

export { detectPlatform, toolchainRoot, prepareRuntimeEnv };
