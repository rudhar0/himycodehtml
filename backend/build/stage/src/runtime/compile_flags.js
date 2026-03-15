import path from 'path';
import fs from 'fs';
import os from 'os';

function findClangBuiltinIncludes(toolchainRoot, platform) {
  // look for lib/clang/<version>/include under platform lib dir
  const candidates = [];
  const base = path.join(toolchainRoot, platform, 'lib', 'clang');
  try {
    if (fs.existsSync(base)) {
      const vers = fs.readdirSync(base);
      for (const v of vers) {
        const p = path.join(base, v, 'include');
        if (fs.existsSync(p)) candidates.push(p);
      }
    }
  } catch(e) {}
  return candidates;
}

function resolveWindowsTriple() {
  const arch = os.arch();
  if (arch === 'x64') return 'x86_64-w64-mingw32';
  if (arch === 'ia32') return 'i686-w64-mingw32';
  if (arch === 'arm64') return 'aarch64-w64-mingw32';
  return 'x86_64-w64-mingw32';
}

function resolveLibDirs(toolchainRoot, platform) {
  const dirs = [];
  if (platform === 'windows') {
    const triple = resolveWindowsTriple();
    dirs.push(path.join(toolchainRoot, platform, triple, 'lib'));
    dirs.push(path.join(toolchainRoot, platform, 'lib'));
    const clangLib = path.join(toolchainRoot, platform, 'lib', 'clang');
    if (fs.existsSync(clangLib)) {
      const vers = fs.readdirSync(clangLib, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort()
        .reverse();
      const ver = vers[0];
      if (ver) dirs.push(path.join(toolchainRoot, platform, 'lib', 'clang', ver, 'lib', 'windows'));
    }
  } else if (platform === 'linux') {
    dirs.push(path.join(toolchainRoot, platform, 'lib'));
    const clangLib = path.join(toolchainRoot, platform, 'lib', 'clang');
    if (fs.existsSync(clangLib)) {
      const vers = fs.readdirSync(clangLib, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort()
        .reverse();
      const ver = vers[0];
      if (ver) dirs.push(path.join(toolchainRoot, platform, 'lib', 'clang', ver, 'lib', 'linux'));
    }
  } else if (platform === 'macos') {
    dirs.push(path.join(toolchainRoot, platform, 'lib'));
    const clangLib = path.join(toolchainRoot, platform, 'lib', 'clang');
    if (fs.existsSync(clangLib)) {
      const vers = fs.readdirSync(clangLib, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort()
        .reverse();
      const ver = vers[0];
      if (ver) dirs.push(path.join(toolchainRoot, platform, 'lib', 'clang', ver, 'lib', 'darwin'));
    }
  }
  return dirs.filter(d => d && fs.existsSync(d));
}

function getCompileFlags(toolchainRoot, platform, srcPath, outPath) {
  const flags = [];

  // hard isolate: no host headers
  flags.push('-nostdinc');
  flags.push('-nostdinc++');

  // include ordering: libc++ headers, libc wrappers / headers, platform includes, clang builtin
  flags.push('-isystem', path.join(toolchainRoot, 'headers', 'c++', 'v1'));
  flags.push('-isystem', path.join(toolchainRoot, 'headers'));
  flags.push('-isystem', path.join(toolchainRoot, platform, 'include'));

  // add clang builtin include(s) if found
  const builtin = findClangBuiltinIncludes(toolchainRoot, platform);
  for (const b of builtin) flags.push('-isystem', b);

  // standard flags (required)
  flags.push('-std=c++17');
  flags.push('-O0');
  flags.push('-g');
  flags.push('-fno-omit-frame-pointer');
  flags.push('-finstrument-functions');

  // output and source
  flags.push('-o', outPath);
  flags.push(srcPath);

  // link/runtime selection
  const libDirs = resolveLibDirs(toolchainRoot, platform);
  for (const libDir of libDirs) {
    flags.push('-L', libDir);
    if (platform !== 'windows') flags.push('-Wl,-rpath,' + libDir);
  }
  flags.push('-stdlib=libc++');
  flags.push('-rtlib=compiler-rt');
  flags.push('-unwindlib=libunwind');
  flags.push('-fuse-ld=lld');

  return flags;
}

export { getCompileFlags };
