import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { toolchainService } from '../../src/services/toolchain.service.js';
import {
  safeSpawn,
  locateCommand,
  getCommandVersion,
  getNpmCommand,
  getNpxCommand,
  getLocalBinPath,
} from './process-utils.js';

function npmBin() {
  return getNpmCommand();
}

function npxBin() {
  return getNpxCommand();
}

function parseNodeMajor(v) {
  const major = Number(String(v || '').split('.')[0]);
  return Number.isFinite(major) ? major : null;
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function detectWebView2() {
  if (process.platform !== 'win32') return { ok: true, reason: 'not-windows' };
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'EdgeWebView', 'Application'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'EdgeWebView', 'Application'),
  ];
  for (const base of candidates) {
    try {
      const entries = await fs.readdir(base, { withFileTypes: true });
      const versions = entries.filter((e) => e.isDirectory()).map((e) => e.name);
      if (versions.length) return { ok: true, reason: `found-in-${base}` };
    } catch {
      // ignore
    }
  }
  return { ok: false, reason: 'not-found' };
}

export async function validateToolchain({
  backendRoot,
  requirePkg = false,
  requireNeu = false,
  requireFrontend = false,
  requireDesktop = false,
  allowNeuViaNpx = true,
} = {}) {
  const errors = [];
  const warnings = [];
  const versions = {};
  const details = {};

  const nodeMajor = parseNodeMajor(process.versions.node);
  versions.node = process.versions.node;
  if (!nodeMajor || nodeMajor < 18) errors.push(`Node.js ${process.versions.node} unsupported (require >= 18).`);

  const npmV = await getCommandVersion(npmBin(), ['--version']);
  versions.npm = npmV;
  if (!npmV) errors.push('npm not found in PATH.');

  const npxV = await getCommandVersion(npxBin(), ['--version']);
  versions.npx = npxV;
  if (!npxV) warnings.push('npx not found in PATH (neu fallback may not work).');

  const neuCmd = process.env.NEUTRALA_NEU_BIN || 'neu';
  let neuV = await getCommandVersion(neuCmd, ['--version']);
  if (!neuV) {
    neuV = await getCommandVersion(neuCmd, ['version']);
  }
  versions.neu = neuV;
  if (!neuV) {
    if (requireNeu && (!allowNeuViaNpx || !npxV)) errors.push('neu not found (and npx fallback unavailable).');
    else warnings.push('neu not found (will fallback to npx when needed).');
  }

  if (backendRoot) {
    const pkgBin = getLocalBinPath(backendRoot, 'pkg');
    details.pkgBin = pkgBin;
    const pkgExists = await exists(pkgBin);
    if (pkgExists) {
      versions.pkg = await getCommandVersion(pkgBin, ['--version']);
    } else if (requirePkg) {
      errors.push(`pkg not found at ${pkgBin}. Run \`npm install\` in backend/.`);
    } else {
      warnings.push(`pkg not found at ${pkgBin} (builds may fail).`);
    }
  }

  // Compilation toolchain (bundled Clang).
  const bundled = await toolchainService.verify();
  details.bundledToolchain = bundled;
  if (!bundled?.compiler) errors.push('Bundled Clang toolchain missing/invalid (resources/toolchain).');

  // Optional: WebView2 presence (warn only).
  const webview2 = await detectWebView2();
  details.webview2 = webview2;
  if (process.platform === 'win32' && !webview2.ok) {
    warnings.push('WebView2 Runtime not detected (warn only).');
  }

  // Optional build/packaging tools.
  if (process.platform === 'win32') {
    const makensis = await getCommandVersion('makensis', ['/VERSION']);
    versions.makensis = makensis;
    if (!makensis) warnings.push('makensis not found (NSIS installer builds will be skipped).');
  }
  if (process.platform === 'darwin') {
    const hdiutil = await getCommandVersion('hdiutil', ['help']);
    versions.hdiutil = hdiutil ? 'present' : null;
    if (!hdiutil) warnings.push('hdiutil not found (DMG builds will fail).');
  }

  if (requireFrontend && backendRoot) {
    const repoRoot = path.resolve(backendRoot, '..');
    const frontendPkg = path.join(repoRoot, 'frontend', 'package.json');
    if (!(await exists(frontendPkg))) errors.push(`Missing frontend/package.json at ${frontendPkg}`);
  }
  if (requireDesktop && backendRoot) {
    const repoRoot = path.resolve(backendRoot, '..');
    const desktopCfg = path.join(repoRoot, 'desktop', 'neutralino.config.json');
    if (!(await exists(desktopCfg))) errors.push(`Missing desktop/neutralino.config.json at ${desktopCfg}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    versions,
    details,
    env: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
    },
  };
}

