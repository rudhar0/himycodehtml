
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import fssync from 'fs';
import resourceResolver from './resource-resolver.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOOLCHAIN_ROOT = resourceResolver.getToolchainRoot();

let MANIFEST = null;
async function loadManifest() {
  if (MANIFEST) return MANIFEST;
  try {
    const raw = await fs.readFile(path.join(TOOLCHAIN_ROOT, 'manifest.json'), 'utf-8');
    MANIFEST = JSON.parse(raw);
  } catch (e) {
    MANIFEST = null;
  }
  return MANIFEST;
}

class ToolchainService {
  constructor() {
    this.platform = os.platform();
    this.arch = os.arch();
    this.toolchainPath = this._resolveToolchainPath();
    this.headersPath = path.join(TOOLCHAIN_ROOT, 'headers');
    this.llvmVersion = this._detectClangVersion();
    this.internalHeadersPath = this._resolveInternalHeadersPath();

    console.log(`[ToolchainService] Initialized for platform: ${this.platform}, arch: ${this.arch}`);
    console.log(`[ToolchainService] Toolchain Root: ${TOOLCHAIN_ROOT}`);
    console.log(`[ToolchainService] Internal Headers: ${this.internalHeadersPath}`);
  }

  _resolveToolchainPath() {
    switch (this.platform) {
      case 'win32':
        return path.join(TOOLCHAIN_ROOT, 'windows', 'bin');
      case 'darwin':
        return path.join(TOOLCHAIN_ROOT, 'macos', 'bin');
      case 'linux':
        return path.join(TOOLCHAIN_ROOT, 'linux', 'bin');
      default:
        console.warn(`[ToolchainService] Unsupported platform: ${this.platform}.`);
        return null;
    }
  }

  _resolveInternalHeadersPath() {
    const platformMap = {
      'win32': 'windows',
      'darwin': 'macos',
      'linux': 'linux'
    };
    const platformDir = platformMap[this.platform];
    if (!platformDir) return null;

    // Pattern: resources/toolchain/{platform}/lib/clang/{major}/include
    const major = (this.llvmVersion || '18.1.8').split('.')[0];
    return path.join(TOOLCHAIN_ROOT, platformDir, 'lib', 'clang', major, 'include');
  }

  _detectClangVersion() {
    const platformMap = { 'win32': 'windows', 'darwin': 'macos', 'linux': 'linux' };
    const platformDir = platformMap[this.platform];
    if (!platformDir) return null;
    const base = path.join(TOOLCHAIN_ROOT, platformDir, 'lib', 'clang');
    try {
      if (!fssync.existsSync(base)) return null;
      const entries = fssync.readdirSync(base, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort((a, b) => {
          const pa = a.split('.').map(n => parseInt(n, 10));
          const pb = b.split('.').map(n => parseInt(n, 10));
          for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const da = pa[i] || 0;
            const db = pb[i] || 0;
            if (da !== db) return db - da;
          }
          return 0;
        });
      return entries[0] || null;
    } catch (_) {
      return null;
    }
  }

  _resolveWindowsTriple() {
    if (this.arch === 'x64') return 'x86_64-w64-mingw32';
    if (this.arch === 'ia32') return 'i686-w64-mingw32';
    if (this.arch === 'arm64') return 'aarch64-w64-mingw32';
    return 'x86_64-w64-mingw32';
  }

  _resolveLibDirs() {
    const dirs = [];
    if (this.platform === 'win32') {
      const triple = this._resolveWindowsTriple();
      dirs.push(path.join(TOOLCHAIN_ROOT, 'windows', triple, 'lib'));
      dirs.push(path.join(TOOLCHAIN_ROOT, 'windows', 'lib'));
      if (this.llvmVersion) {
        dirs.push(path.join(TOOLCHAIN_ROOT, 'windows', 'lib', 'clang', this.llvmVersion, 'lib', 'windows'));
      }
    } else if (this.platform === 'linux') {
      dirs.push(path.join(TOOLCHAIN_ROOT, 'linux', 'lib'));
      if (this.llvmVersion) {
        dirs.push(path.join(TOOLCHAIN_ROOT, 'linux', 'lib', 'clang', this.llvmVersion, 'lib', 'linux'));
      }
    } else if (this.platform === 'darwin') {
      dirs.push(path.join(TOOLCHAIN_ROOT, 'macos', 'lib'));
      if (this.llvmVersion) {
        dirs.push(path.join(TOOLCHAIN_ROOT, 'macos', 'lib', 'clang', this.llvmVersion, 'lib', 'darwin'));
      }
    }
    return dirs.filter(d => d && fssync.existsSync(d));
  }

  getCompiler(language = 'c') {
    const isCpp = language === 'cpp' || language === 'c++';
    const binaryName = isCpp ? 'clang++' : 'clang';

    const executable = this.platform === 'win32' ? `${binaryName}.exe` : binaryName;
    if (!this.toolchainPath) {
      throw new Error('Bundled toolchain not available for this platform');
    }
    return path.join(this.toolchainPath, executable);
  }

  getIncludeFlags(language = 'cpp') {
    const flags = [];

    // Bundled header paths
    const absLibCxx = path.resolve(path.join(this.headersPath, 'c++', 'v1'));
    const absInternal = path.resolve(this.internalHeadersPath || '');
    const absCHeaders = path.resolve(this.headersPath);  // C standard library headers (stdlib.h, string.h, etc.)
    const platformDirMap = {
      'win32': 'windows',
      'darwin': 'macos',
      'linux': 'linux'
    };
    const platDir = platformDirMap[this.platform];
    const absPlatformInclude = platDir ? path.resolve(path.join(TOOLCHAIN_ROOT, platDir, 'include')) : null;

    // Hard isolate: never use host headers
    flags.push('-nostdinc');
    if (language === 'cpp' || language === 'c++') flags.push('-nostdinc++');

    // Validate internal headers path gracefully
    if (!this.internalHeadersPath || !fssync.existsSync(this.internalHeadersPath)) {
      console.warn('[ToolchainService] internal headers not found; continuing with best-effort includes');
    }

    // 1) libc++ C++ headers first (includes #include_next)
    flags.push('-isystem', absLibCxx);

    // 2) libc++ C wrappers + platform C headers
    flags.push('-isystem', absCHeaders);

    // 4) Clang builtin headers (__stddef_size_t.h, __limits.h, etc.)
    if (this.internalHeadersPath) flags.push('-isystem', absInternal);

    // 5) Explicitly add the common headers root (user confirmed location)
    // This contains stdio.h, string.h, etc. for MinGW/Windows.
    flags.push('-isystem', absCHeaders);

    // 6) Platform specific include (only if it exists)
    if (absPlatformInclude && fssync.existsSync(absPlatformInclude)) {
      flags.push('-isystem', absPlatformInclude);
    }

    return flags;
  }



  getLinkerFlags() {
    const flags = [];
    const libDirs = this._resolveLibDirs();
    // Use clang's stdlib/rtlib flags to guide proper linking
    flags.push('-stdlib=libc++');
    flags.push('-rtlib=compiler-rt');
    flags.push('-unwindlib=libunwind');
    flags.push('-fuse-ld=lld');

    // Disable ASLR on Windows for deterministic address resolution
    if (this.platform === 'win32') {
      flags.push('-Wl,--no-dynamicbase');
    }

    for (const d of libDirs) {
      flags.push('-L' + d);
      // rpath so runtime loader picks bundled libs first on POSIX
      if (this.platform !== 'win32') flags.push('-Wl,-rpath,' + d);
    }

    if (this.platform === 'linux') {
      flags.push('-lm');
      flags.push('-pthread');
    }

    return flags;
  }

  /**
   * Get flags for deterministic/reproducible builds.
   * These flags eliminate sources of non-determinism in object files.
   */
  getDeterministicFlags() {
    return [
      // Remove timestamps and paths from debug info
      '-Wdate-time',
      '-ffile-prefix-map=' + path.resolve('.') + '=.',
      // Disable __FILE__ and __DATE__ macros from embedding absolute paths
      '-fmacro-prefix-map=' + path.resolve('.') + '=.',
      // Reproducible build ID
      '-fno-ident'
    ];
  }

  /**
   * Get all compilation flags combined (include + linker + deterministic).
   */
  getAllFlags(language = 'cpp') {
    return [
      ...this.getIncludeFlags(),
      ...this.getDeterministicFlags(),
      ...this.getLinkerFlags()
    ];
  }



  _resolveLibPath() {
    switch (this.platform) {
      case 'win32':
        return path.join(TOOLCHAIN_ROOT, 'windows', 'lib');
      case 'darwin':
        return path.join(TOOLCHAIN_ROOT, 'macos', 'lib');
      case 'linux':
        return path.join(TOOLCHAIN_ROOT, 'linux', 'lib');
      default:
        return null;
    }
  }

  getCompileFlags(language = 'cpp', extra = []) {
    const stdFlag = language === 'c' ? '-std=c11' : '-std=c++17';
    return [
      stdFlag,
      '-O0',
      '-g',
      '-fno-omit-frame-pointer',
      ...this.getIncludeFlags(language),
      ...extra
    ];
  }

  getRuntimeEnv() {
    const platformMap = { 'win32': 'windows', 'darwin': 'macos', 'linux': 'linux' };
    const platformDir = platformMap[this.platform] || 'linux';
    const env = { ...process.env };
    const bin = path.join(TOOLCHAIN_ROOT, platformDir, 'bin');
    const lib = path.join(TOOLCHAIN_ROOT, platformDir, 'lib');
    env.PATH = bin + path.delimiter + env.PATH;
    if (this.platform === 'linux') {
      env.LD_LIBRARY_PATH = lib + (env.LD_LIBRARY_PATH ? path.delimiter + env.LD_LIBRARY_PATH : '');
    } else if (this.platform === 'darwin') {
      env.DYLD_LIBRARY_PATH = lib + (env.DYLD_LIBRARY_PATH ? path.delimiter + env.DYLD_LIBRARY_PATH : '');
    } else if (this.platform === 'win32') {
      env.PATH = lib + path.delimiter + env.PATH;
    }
    return env;
  }

  getRuntimeDlls() {
    if (this.platform !== 'win32') return [];
    const platformDir = 'windows';
    const bin = path.join(TOOLCHAIN_ROOT, platformDir, 'bin');
    const dlls = [
      'libc++.dll',
      'libunwind.dll',
      'libwinpthread-1.dll'
    ];
    return dlls
      .map(d => path.join(bin, d))
      .filter(p => fssync.existsSync(p));
  }

  async stageRuntimeDependencies(targetDir) {
    if (!targetDir) return [];
    if (this.platform !== 'win32') return [];

    const dlls = this.getRuntimeDlls();
    if (!dlls || dlls.length === 0) {
      throw new Error('[ToolchainService] Missing bundled runtime DLLs for Windows runtime staging');
    }

    const staged = [];
    for (const dll of dlls) {
      const name = path.basename(dll);
      const dest = path.join(targetDir, name);
      try {
        await fs.copyFile(dll, dest);
        staged.push(dest);
      } catch (e) {
        throw new Error(`[ToolchainService] Failed to stage runtime DLL ${name}: ${e.message}`);
      }
    }
    return staged;
  }

  async verify() {
    const fs = await import('fs/promises');
    const results = {
      compiler: false,
      headers: false,
      internal: false,
      libs: false,
      runtime: false,
      details: {}
    };

    try {
      const compilerPath = this.getCompiler('c');
      if (this.toolchainPath) {
        await fs.access(compilerPath);
        results.compiler = true;
        results.details.compiler = compilerPath;
      }

      await fs.access(this.headersPath);
      results.headers = true;
      results.details.headers = this.headersPath;

      if (this.internalHeadersPath) {
        await fs.access(this.internalHeadersPath);
        results.internal = true;
        results.details.internal = this.internalHeadersPath;
      }

      const libDirs = this._resolveLibDirs();
      if (libDirs.length > 0) {
        results.libs = true;
        results.details.libDirs = libDirs;
      }

      if (this.platform === 'win32') {
        const dlls = this.getRuntimeDlls();
        results.runtime = dlls.length > 0;
        results.details.runtimeDlls = dlls;
      } else {
        results.runtime = true;
      }
    } catch (e) {
      console.error(`[ToolchainService] Verification failed: ${e.message}`);
    }

    return results;
  }

}

export const toolchainService = new ToolchainService();
export default ToolchainService;