const fs = require('fs');
const path = require('path');

function exists(p) { try { return fs.existsSync(p); } catch(e){return false;} }

function detectPlatform() {
  const plat = process.platform;
  if (plat === 'win32') return 'windows';
  if (plat === 'darwin') return 'macos';
  return 'linux';
}

function toolchainRoot() {
  // workspace-relative path used by backend
  return path.resolve(__dirname, '../../..', 'resources', 'toolchain');
}

function validateToolchain() {
  const root = toolchainRoot();
  const plat = detectPlatform();
  const binDir = path.join(root, plat, 'bin');
  const libDir = path.join(root, plat, 'lib');
  const headers = path.join(root, 'headers');

  const checks = [];

  checks.push({name:'toolchain_root', ok: exists(root), path: root});
  checks.push({name:'platform_bin', ok: exists(binDir), path: binDir});
  checks.push({name:'platform_lib', ok: exists(libDir), path: libDir});
  checks.push({name:'headers', ok: exists(headers), path: headers});

  const clang = path.join(binDir, process.platform === 'win32' ? 'clang++.exe' : 'clang++');
  checks.push({name:'clang++', ok: exists(clang), path: clang});

  // simple library checks
  const libs = ['libc++.a','libc++abi.a','libunwind.a'];
  const foundLibs = libs.map(l => ({name:l, ok:exists(path.join(libDir,l)), path:path.join(libDir,l)}));
  checks.push(...foundLibs);

  // ABI quick check: run clang++ --version and parse
  let abiOk = false; let clangVersion = null;
  try {
    const cp = require('child_process').spawnSync(clang, ['--version'], {encoding:'utf8'});
    clangVersion = cp.stdout || cp.stderr;
    abiOk = !!clangVersion && clangVersion.length>0;
  } catch(e) {}

  checks.push({name:'clang_version_probe', ok: abiOk, out: clangVersion});

  const failed = checks.filter(c => !c.ok);
  return {ok: failed.length === 0, checks, failed};
}

module.exports = { validateToolchain, toolchainRoot, detectPlatform };
