import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import readline from 'node:readline/promises';
import { pipeline } from 'node:stream/promises';
import { validateToolchain } from './_lib/toolchain-validator.js';
import { writeDiagnostics } from './_lib/diagnostics.js';
import {
  safeSpawn,
  spawnInteractive,
  getNpmCommand,
  getCommandVersion,
  normalizeArgs,
  formatSpawnDebug,
  shouldUseShell,
} from './_lib/process-utils.js';
import { setupSupervisor, registerProcess } from './_lib/process-supervisor.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(SCRIPT_DIR, '..');
const BUILD_ROOT = path.join(BACKEND_ROOT, 'build');
const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');
const FRONTEND_ROOT = path.join(REPO_ROOT, 'frontend');
const DESKTOP_ROOT = path.join(REPO_ROOT, 'desktop');
const DEFAULT_NODE_RUNTIME_VERSION = process.env.NODE_RUNTIME_VERSION || '18.20.8';
const NODE_DIST_BASE = process.env.NODE_DIST_BASE || 'https://nodejs.org/download/release/';

function binPath(name) {
  const ext = process.platform === 'win32' ? '.cmd' : '';
  return path.join(BACKEND_ROOT, 'node_modules', '.bin', `${name}${ext}`);
}

function npmBin() {
  return getNpmCommand();
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function sanitizeName(input) {
  return String(input || '')
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'app';
}

function sanitizePkgName(input) {
  return sanitizeName(input).toLowerCase();
}

/**
 * Run a command interactively (stdio: 'inherit')
 * Registers process with supervisor and handles errors gracefully
 */
async function run(cmd, args, opts = {}) {
  const child = spawnInteractive(cmd, args, {
    shell: shouldUseShell(cmd),
    ...opts,
  });

  if (!child) {
    throw new Error(`Failed to spawn: ${formatSpawnDebug(cmd, args)}`);
  }

  registerProcess(child, `build:${cmd}`, 50, []);
  return new Promise((resolve, reject) => {
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
    child.on('error', (err) => {
      reject(err);
    });
  });
}

async function ensureBuildDependencies() {
  const requiredBins = [binPath('pkg')];
  const missing = [];
  for (const b of requiredBins) {
    if (!(await exists(b))) missing.push(b);
  }
  if (!missing.length) return;

  console.log('\nInstalling build dependencies (local)...');
  const lockPath = path.join(BACKEND_ROOT, 'package-lock.json');
  const hasLock = await exists(lockPath);
  try {
    if (hasLock) await run(npmBin(), ['ci'], { cwd: BACKEND_ROOT });
    else await run(npmBin(), ['install'], { cwd: BACKEND_ROOT });
  } catch (err) {
    // Fallback for environments where lockfile is out-of-date.
    await run(npmBin(), ['install'], { cwd: BACKEND_ROOT });
  }

  for (const b of requiredBins) {
    if (!(await exists(b))) {
      throw new Error(`Missing required build tool after npm install: ${b}`);
    }
  }
}

function downloadToFile(url, filePath) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        res.resume();
        resolve(downloadToFile(res.headers.location, filePath));
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Download failed (${res.statusCode}) for ${url}`));
        return;
      }

      pipeline(res, fssync.createWriteStream(filePath))
        .then(resolve)
        .catch(reject);
    });
    req.on('error', reject);
  });
}

function downloadText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        res.resume();
        resolve(downloadText(res.headers.location));
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Download failed (${res.statusCode}) for ${url}`));
        return;
      }

      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
  });
}

async function sha256File(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const s = fssync.createReadStream(filePath);
    s.on('error', reject);
    s.on('data', (d) => hash.update(d));
    s.on('end', () => resolve(hash.digest('hex')));
  });
}

function resolveUserPath(p) {
  let raw = String(p || '').trim();
  // Strip quotes if user pasted path with quotes
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1);
  }
  if (!raw) return '';
  return path.isAbsolute(raw) ? raw : path.resolve(REPO_ROOT, raw);
}

async function readMagic(filePath, n) {
  const fh = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(n);
    await fh.read(buf, 0, n, 0);
    return buf;
  } finally {
    await fh.close();
  }
}

async function validateIconFile(filePath, kind) {
  const p = resolveUserPath(filePath);
  if (!p) return '';
  if (!(await exists(p))) {
    throw new Error(`Icon file not found: ${p}`);
  }

  const k = String(kind || '').toLowerCase();
  if (k === 'png') {
    if (!p.toLowerCase().endsWith('.png')) throw new Error(`Expected a .png icon but got: ${p}`);
    const magic = await readMagic(p, 8);
    const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!magic.equals(pngSig)) throw new Error(`Invalid PNG signature: ${p}`);
    return p;
  }
  if (k === 'icns') {
    if (!p.toLowerCase().endsWith('.icns')) throw new Error(`Expected a .icns icon but got: ${p}`);
    const magic = await readMagic(p, 4);
    if (magic.toString('ascii') !== 'icns') throw new Error(`Invalid ICNS signature: ${p}`);
    return p;
  }
  if (k === 'ico') {
    if (!p.toLowerCase().endsWith('.ico')) throw new Error(`Expected a .ico icon but got: ${p}`);
    const magic = await readMagic(p, 4);
    const reserved = magic.readUInt16LE(0);
    const type = magic.readUInt16LE(2);
    if (reserved !== 0 || type !== 1) throw new Error(`Invalid ICO header: ${p}`);
    return p;
  }

  throw new Error(`Unknown icon kind: ${kind}`);
}

function parseShasums256(text) {
  const map = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line.trim());
    if (!m) continue;
    map.set(m[2], m[1].toLowerCase());
  }
  return map;
}

async function copyDir(src, dst) {
  await ensureDir(dst);
  let entries = [];
  try {
    entries = await fs.readdir(src, { withFileTypes: true });
  } catch (err) {
    console.warn(`Warning: failed to read directory ${src}: ${err.message}`);
    return;
  }

  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.runtime') continue;
      await copyDir(s, d);
    } else {
      try {
        await ensureDir(path.dirname(d));
        await fs.copyFile(s, d);
      } catch (err) {
        if (err && err.code === 'ENOENT') {
          console.warn(`Skipping missing file during copy: ${s}`);
          continue;
        }
        throw err;
      }
    }
  }
}

async function ensureFrontendDependencies() {
  if (!(await exists(FRONTEND_ROOT))) return;
  const nodeModules = path.join(FRONTEND_ROOT, 'node_modules');
  if (await exists(nodeModules)) return;

  console.log('\nInstalling frontend dependencies (local)...');
  const lockPath = path.join(FRONTEND_ROOT, 'package-lock.json');
  const hasLock = await exists(lockPath);
  try {
    if (hasLock) await run(npmBin(), ['ci'], { cwd: FRONTEND_ROOT });
    else await run(npmBin(), ['install'], { cwd: FRONTEND_ROOT });
  } catch {
    await run(npmBin(), ['install'], { cwd: FRONTEND_ROOT });
  }
}

async function buildFrontend() {
  if (!(await exists(FRONTEND_ROOT))) {
    throw new Error(`Missing frontend folder: ${FRONTEND_ROOT}`);
  }
  await ensureFrontendDependencies();
  console.log('\nBuilding frontend (vite)...');
  const distDir = path.join(FRONTEND_ROOT, 'dist');

  if (process.env.NEUTRALA_SKIP_FRONTEND_BUILD === 'true') {
    if (!(await exists(distDir))) {
      throw new Error(
        `NEUTRALA_SKIP_FRONTEND_BUILD=true but dist/ is missing: ${distDir}`,
      );
    }
    return distDir;
  }

  try {
    await run(npmBin(), ['run', 'build:ui'], { cwd: FRONTEND_ROOT });
  } catch (err1) {
    try {
      // Fallback for older frontends without the lighter script.
      await run(npmBin(), ['run', 'build'], { cwd: FRONTEND_ROOT });
    } catch (err2) {
      if (await exists(distDir)) {
        console.warn(
          `Warning: frontend build failed; using existing dist/ at ${distDir}. ${err2?.message || err2}`,
        );
        return distDir;
      }
      throw err2 || err1;
    }
  }

  if (!(await exists(distDir))) throw new Error(`Frontend build did not produce dist/: ${distDir}`);
  return distDir;
}

async function findFileRecursive(rootDir, fileName, maxDepth = 4) {
  const target = String(fileName).toLowerCase();
  async function walk(dir, depth) {
    if (depth > maxDepth) return null;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const found = await walk(full, depth + 1);
        if (found) return found;
      } else if (e.isFile() && e.name.toLowerCase() === target) {
        return full;
      }
    }
    return null;
  }
  return await walk(rootDir, 0);
}

async function findNeutralinoBinaryPath(rootDir, targetOs, maxDepth = 4) {
  async function walk(dir, depth) {
    if (depth > maxDepth) return null;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    const lower = files.map((f) => f.toLowerCase());

    if (targetOs === 'windows') {
      const exact = files.find((f) => f.toLowerCase() === 'neutralino.exe');
      if (exact) return path.join(dir, exact);
      const idx = lower.findIndex((n) => n.includes('neutralino') && n.endsWith('.exe'));
      if (idx >= 0) return path.join(dir, files[idx]);
    } else {
      const exact = files.find((f) => f === 'neutralino');
      if (exact) return path.join(dir, exact);
      const idx = lower.findIndex(
        (n) => n.includes('neutralino') && !n.endsWith('.json') && !n.endsWith('.js'),
      );
      if (idx >= 0) return path.join(dir, files[idx]);
    }

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const found = await walk(path.join(dir, e.name), depth + 1);
      if (found) return found;
    }
    return null;
  }

  return await walk(rootDir, 0);
}

async function buildDesktopPortable({
  desktopTemplateConfigPath,
  backendBundleDir,
  backendBinaryPath,
  outDir,
  safeName,
  appName,
  version,
  targetOs,
  appIconIco,
  appIconPng,
  uninstallIcon,
  distDir,
}) {
  if (!appIconPng) {
    const defaultPng = path.join(DESKTOP_ROOT, 'app.png');
    if (await exists(defaultPng)) {
      appIconPng = defaultPng;
      console.log(`Using default app icon: ${appIconPng}`);
    }
  }

  if (!(await exists(desktopTemplateConfigPath))) {
    throw new Error(`Missing Neutralino config template: ${desktopTemplateConfigPath}`);
  }

  const portableDir = path.join(outDir, `${safeName}-${version}-${targetOs}-desktop-portable`);
  await fs.rm(portableDir, { recursive: true, force: true });
  await ensureDir(portableDir);

  const backendDir = path.join(portableDir, 'backend');
  const desktopDir = path.join(portableDir, 'desktop');
  await ensureDir(backendDir);
  await ensureDir(desktopDir);

  // Backend bundle: copy everything, then add a stable backend binary name used by the desktop bootstrap.
  await copyDir(backendBundleDir, backendDir);
  const backendExt = targetOs === 'windows' ? '.exe' : '';
  const stableBackendName = `${safeName}-backend${backendExt}`;
  await fs.copyFile(backendBinaryPath, path.join(backendDir, stableBackendName));

  // Neutralino runtime pack is downloaded into backend/resources/neutrala-runtime/<platform>/ by runtime-manager.
  const runtimeInstallDir = path.join(backendDir, 'resources', 'neutrala-runtime', targetOs);
  if (!(await exists(runtimeInstallDir))) {
    throw new Error(
      `Neutralino runtime pack missing at ${runtimeInstallDir}. Install neu (npm i -g @neutralinojs/neu) and rerun the build, or configure NEUTRALA_RUNTIME_BASE_URL/NEUTRALA_RUNTIME_URL_*.`,
    );
  }
  await copyDir(runtimeInstallDir, desktopDir);

  // Rename Neutralino binary to a stable app name.
  let srcBin = await findNeutralinoBinaryPath(desktopDir, targetOs);
  if (!srcBin) {
    throw new Error(`Could not locate Neutralino runtime binary in ${desktopDir}`);
  }
  const desktopExt = targetOs === 'windows' ? '.exe' : '';
  const desktopBaseName =
    targetOs === 'windows'
      ? (String(appName || '').replace(/[^\w.-]+/g, '').trim() || safeName)
      : safeName;
  const desktopExeName = `${desktopBaseName}${desktopExt}`;
  const dstBin = path.join(desktopDir, desktopExeName);

  // If the binary is nested (e.g., under bin/), flatten that folder into desktopDir so sibling libs stay colocated.
  const binDir = path.dirname(srcBin);
  if (path.resolve(binDir) !== path.resolve(desktopDir)) {
    await copyDir(binDir, desktopDir);
    const flattened = path.join(desktopDir, path.basename(srcBin));
    if (await exists(flattened)) srcBin = flattened;
  }

  try {
    await fs.unlink(dstBin);
  } catch {
    // ignore
  }
  await fs.rename(srcBin, dstBin);
  if (targetOs !== 'windows') {
    try {
      await fs.chmod(dstBin, 0o755);
    } catch {
      // ignore
    }
  }

  // Copy frontend dist into desktop/resources.
  // Important: do not remove the entire runtime-provided resources folder because it may
  // contain runtime metadata (e.g. resources.neu) required by the Neutralino binary.
  // Instead, merge the frontend `dist` contents into the existing resources directory,
  // overwriting individual files when necessary.
  const resolvedDistDir = distDir || (await buildFrontend());
  const desktopResourcesDir = path.join(desktopDir, 'resources');
  await ensureDir(desktopResourcesDir);
  await copyDir(resolvedDistDir, desktopResourcesDir);

  // Ensure neutralino.js is available at /neutralino.js in the UI (Vite index.html references it).
  const neutralinoJs = (await findFileRecursive(desktopDir, 'neutralino.js', 3)) || null;
  if (neutralinoJs) {
    await fs.copyFile(neutralinoJs, path.join(desktopResourcesDir, 'neutralino.js'));
  }

  // Copy and pin app icons to stable names so config/shortcuts can reliably reference them.
  const copied = { ico: false, png: false };

  if (appIconIco && (await exists(appIconIco))) {
    const dest = path.join(desktopResourcesDir, 'app.ico');
    await fs.copyFile(appIconIco, dest);
    copied.ico = true;
    console.log(`Copied app.ico to ${dest}`);
  }

  if (appIconPng && (await exists(appIconPng))) {
    const dest = path.join(desktopResourcesDir, 'app.png');
    await fs.copyFile(appIconPng, dest);
    copied.png = true;
    console.log(`Copied app.png to ${dest}`);
  }
  try {
    const embedded = [
      neutralinoJs ? 'neutralino.js' : null,
      copied.ico ? 'app.ico' : null,
      copied.png ? 'app.png' : null,
    ].filter(Boolean);
    // eslint-disable-next-line no-console
    console.log(`Embedded desktop UI assets: ${embedded.length ? embedded.join(', ') : '(none)'}`);
  } catch {
    // ignore
  }

  if (appIconPng && (await exists(appIconPng))) {
    await fs.copyFile(appIconPng, path.join(desktopResourcesDir, path.basename(appIconPng)));
  }
  if (uninstallIcon && (await exists(uninstallIcon))) {
    await fs.copyFile(uninstallIcon, path.join(portableDir, path.basename(uninstallIcon)));
  }

  // Write packaged Neutralino config.
  const baseCfg = await readJson(desktopTemplateConfigPath);
  baseCfg.url = '/index.html';
  baseCfg.documentRoot = 'resources';
  baseCfg.version = version;
  baseCfg.nativeAllowList = Array.from(
    new Set([...(baseCfg.nativeAllowList || []), 'filesystem.', 'window.', 'events.']),
  );
  baseCfg.modes = baseCfg.modes || {};
  baseCfg.modes.window = baseCfg.modes.window || {};
  baseCfg.modes.window.title = appName || baseCfg.modes.window.title || 'CodeViz';
  baseCfg.modes.window.enableInspector = true;
  // Best-effort: set window/taskbar icon (Neutralino may ignore unknown keys on some platforms).
  // We keep this non-fatal; OS-level icon embedding is handled by installers/.app/.desktop.
  if (targetOs === 'windows') {
    if (copied.ico) baseCfg.modes.window.icon = '/app.ico';
    else if (copied.png) baseCfg.modes.window.icon = '/app.png';
  } else if (copied.png) {
    baseCfg.modes.window.icon = '/app.png';
  }
  baseCfg.cli = baseCfg.cli || {};
  // Port 0 is fine, it will pick a random one for the frontend.
  // Ensure we don't accidentally hit the backend port by explicitly setting a range if needed,
  // but random is usually safer.

  baseCfg.cli.resourcesPath = 'resources';
  baseCfg.cli.binaryName = desktopExeName;
  await fs.writeFile(
    path.join(desktopDir, 'neutralino.config.json'),
    `${JSON.stringify(baseCfg, null, 2)}\n`,
    'utf8',
  );

  // Convenience launchers.
  if (targetOs === 'windows') {
    await fs.writeFile(
      path.join(portableDir, 'run-desktop.bat'),
      `@echo off\r\npushd \"%~dp0desktop\"\r\nstart \"\" \"${desktopExeName}\"\r\npopd\r\n`,
      'utf8',
    );
  } else {
    const sh = `#!/bin/sh\nset -e\nDIR=\"$(cd \"$(dirname \"$0\")\" && pwd)\"\nexec \"$DIR/desktop/${desktopExeName}\" \"$@\"\n`;
    const shPath = path.join(portableDir, 'run-desktop.sh');
    await fs.writeFile(shPath, sh, 'utf8');
    try {
      await fs.chmod(shPath, 0o755);
    } catch {
      // ignore
    }
  }

  return { portableDir, backendDir, desktopDir, desktopExeName };
}

async function buildNsiInstaller({ pkgName, appName, srcDir, outFile, iconIco, desktopExeName, version }) {
  // Fix 7: Icon Reliability check
  if (iconIco && !fssync.existsSync(iconIco)) {
    throw new Error(`Critical Error: NSIS icon not found at ${iconIco}. Build aborted.`);
  }

  const exeName = desktopExeName || `${pkgName}.exe`;
  const nsi = [];
  nsi.push('!include "MUI2.nsh"');
  nsi.push('');
  nsi.push('Function .onInit');
  nsi.push('  ; WebView2 is required by the Windows WebView host.');
  nsi.push('  IfFileExists "$PROGRAMFILES64\\\\Microsoft\\\\EdgeWebView\\\\Application\\\\*\\\\msedgewebview2.exe" webview_ok 0');
  nsi.push('  IfFileExists "$PROGRAMFILES32\\\\Microsoft\\\\EdgeWebView\\\\Application\\\\*\\\\msedgewebview2.exe" webview_ok 0');
  nsi.push('  IfFileExists "$PROGRAMFILES\\\\Microsoft\\\\EdgeWebView\\\\Application\\\\*\\\\msedgewebview2.exe" webview_ok 0');
  nsi.push('  ; Check if bundled WebView2 runtime (fixed version) exists');
  nsi.push('  IfFileExists "$INSTDIR\\\\resources\\\\webview2\\\\*.*" webview_ok 0');
  nsi.push('  ; Check if bundled WebView2 setup exists');
  nsi.push('  IfFileExists "$INSTDIR\\\\resources\\\\webview2_setup.exe" 0 webview_ok');
  nsi.push('  DetailPrint "WebView2 Runtime not found. Installing bundled WebView2 setup..."');
  nsi.push('  ExecWait \'"$INSTDIR\\\\resources\\\\webview2_setup.exe" /silent /install\'');
  nsi.push('webview_ok:');
  nsi.push('FunctionEnd');
  nsi.push(`Name "${appName}"`);
  nsi.push(`OutFile "${outFile.replace(/\\/g, '\\\\')}"`);
  nsi.push(`InstallDir "$PROGRAMFILES\\\\${appName}"`);
  nsi.push('RequestExecutionLevel admin');
  if (iconIco) {
    nsi.push(`Icon "${iconIco.replace(/\\/g, '\\\\')}"`);
    nsi.push(`UninstallIcon "${iconIco.replace(/\\/g, '\\\\')}"`);
  }
  nsi.push('');
  nsi.push('!define MUI_ABORTWARNING');
  nsi.push(`!define MUI_FINISHPAGE_RUN`);
  nsi.push(`!define MUI_FINISHPAGE_RUN_TEXT "Launch ${appName}"`);
  nsi.push('');
  nsi.push('!insertmacro MUI_PAGE_DIRECTORY');
  nsi.push('!insertmacro MUI_PAGE_INSTFILES');
  nsi.push('  ; Setup working directory for the finish page "Launch" feature');
  nsi.push('  !define MUI_FINISHPAGE_RUN_FUNCTION "LaunchApp"');
  nsi.push('!insertmacro MUI_PAGE_FINISH');
  nsi.push('!insertmacro MUI_UNPAGE_CONFIRM');
  nsi.push('!insertmacro MUI_UNPAGE_INSTFILES');
  nsi.push('!insertmacro MUI_LANGUAGE "English"');
  nsi.push('');
  nsi.push('Function LaunchApp');
  nsi.push('  SetOutPath "$INSTDIR\\\\desktop"');
  nsi.push(`  Exec '"$INSTDIR\\\\desktop\\\\${exeName}"'`);
  nsi.push('FunctionEnd');
  nsi.push('');
  nsi.push('; Version Information');
  nsi.push(`VIProductVersion "${version}.0"`);
  nsi.push(`VIAddVersionKey "ProductName" "${appName}"`);
  nsi.push(`VIAddVersionKey "CompanyName" "${appName} Team"`);
  nsi.push(`VIAddVersionKey "PublisherName" "${appName} Team"`);
  nsi.push(`VIAddVersionKey "FileDescription" "${appName} Installer"`);
  nsi.push(`VIAddVersionKey "FileVersion" "${version}"`);
  nsi.push(`VIAddVersionKey "ProductVersion" "${version}"`);
  nsi.push(`VIAddVersionKey "InternalName" "${pkgName}"`);
  nsi.push(`VIAddVersionKey "OriginalFilename" "${path.basename(outFile)}"`);
  nsi.push(`VIAddVersionKey "LegalCopyright" "Copyright (c) 2024 ${appName} Team"`);
  nsi.push('');
  nsi.push('Section "Install"');
  nsi.push('  SetOutPath "$INSTDIR"');
  nsi.push(`  File /r "${srcDir.replace(/\\/g, '\\\\')}\\\\*"`);
  nsi.push(`  CreateDirectory "$SMPROGRAMS\\\\${appName}"`);
  const installedIcon = iconIco ? '$INSTDIR\\\\desktop\\\\resources\\\\app.ico' : null;
  nsi.push('  SetOutPath "$INSTDIR\\\\desktop"');
  if (installedIcon) {
    nsi.push(
      `  CreateShortCut "$SMPROGRAMS\\\\${appName}\\\\${appName}.lnk" "$INSTDIR\\\\desktop\\\\${exeName}" "" "${installedIcon}" 0`,
    );
    nsi.push(`  CreateShortCut "$DESKTOP\\\\${appName}.lnk" "$INSTDIR\\\\desktop\\\\${exeName}" "" "${installedIcon}" 0`);
  } else {
    nsi.push(
      `  CreateShortCut "$SMPROGRAMS\\\\${appName}\\\\${appName}.lnk" "$INSTDIR\\\\desktop\\\\${exeName}"`,
    );
    nsi.push(`  CreateShortCut "$DESKTOP\\\\${appName}.lnk" "$INSTDIR\\\\desktop\\\\${exeName}"`);
  }
  nsi.push('  ; Add WebView2 loopback exemption');
  nsi.push('  ExecWait \'\"$SYSDIR\\\\CheckNetIsolation.exe\" LoopbackExempt -a -n=\"Microsoft.Win32WebViewHost_cw5n1h2txyewy\"\'');
  nsi.push('');
  nsi.push('  ; Add uninstaller information to registry');
  nsi.push(`  WriteRegStr HKLM "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\${appName}" "DisplayName" "${appName}"`);
  nsi.push(`  WriteRegStr HKLM "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\${appName}" "UninstallString" "$\\"$INSTDIR\\\\Uninstall.exe$\\""`);
  nsi.push(`  WriteRegStr HKLM "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\${appName}" "DisplayIcon" "$\\"${installedIcon || '$INSTDIR\\\\desktop\\\\' + exeName}$\\""`);
  nsi.push(`  WriteRegStr HKLM "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\${appName}" "Publisher" "${appName} Team"`);
  nsi.push(`  WriteRegStr HKLM "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\${appName}" "DisplayVersion" "${version}"`);
  nsi.push('  WriteUninstaller "$INSTDIR\\\\Uninstall.exe"');
  nsi.push('SectionEnd');
  nsi.push('');
  nsi.push('Section "Uninstall"');
  nsi.push('  ; Check if app is running by trying to open the binary for writing');
  nsi.push('  window_check:');
  nsi.push('  ClearErrors');
  nsi.push(`  FileOpen $0 "$INSTDIR\\\\desktop\\\\${exeName}" "a"`);
  nsi.push('  IfErrors 0 window_ok');
  nsi.push(`  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${appName} is still running. Please close it before uninstalling." IDRETRY window_check IDCANCEL window_cancel`);
  nsi.push('  window_cancel:');
  nsi.push('  Quit');
  nsi.push('  window_ok:');
  nsi.push('  FileClose $0');
  nsi.push('');
  nsi.push(`  Delete "$DESKTOP\\\\${appName}.lnk"`);
  nsi.push(`  Delete "$SMPROGRAMS\\\\${appName}\\\\${appName}.lnk"`);
  nsi.push(`  RMDir /r "$SMPROGRAMS\\\\${appName}"`);
  nsi.push('  RMDir /r "$INSTDIR"');
  nsi.push(`  DeleteRegKey HKLM "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\${appName}"`);
  nsi.push('SectionEnd');
  nsi.push('');

  const nsiPath = path.join(path.dirname(outFile), `${pkgName}-installer.nsi`);
  await fs.writeFile(nsiPath, `${nsi.join('\r\n')}\r\n`, 'utf8');
  return nsiPath;
}

function nodeRuntimeFileName({ targetOs, arch, version }) {
  if (targetOs === 'windows') {
    const a = arch === 'arm64' ? 'arm64' : 'x64';
    return `node-v${version}-win-${a}.zip`;
  }
  if (targetOs === 'mac') {
    const a = arch === 'arm64' ? 'arm64' : 'x64';
    return `node-v${version}-darwin-${a}.tar.gz`;
  }
  const a = arch === 'arm64' ? 'arm64' : 'x64';
  return `node-v${version}-linux-${a}.tar.gz`;
}

async function extractArchive(archivePath, destDir) {
  await ensureDir(destDir);
  if (archivePath.endsWith('.zip')) {
    const extractZip = (await import('extract-zip')).default;
    await extractZip(archivePath, { dir: destDir });
    return;
  }
  if (archivePath.endsWith('.tar.gz')) {
    const tarMod = await import('tar');
    const tar = tarMod.default ?? tarMod;
    await tar.x({ file: archivePath, cwd: destDir });
    return;
  }
  throw new Error(`Unsupported archive format: ${archivePath}`);
}

async function downloadNodeRuntime({ targetOs, arch, version, cacheDir }) {
  const v = String(version).replace(/^v/, '');
  const fileName = nodeRuntimeFileName({ targetOs, arch, version: v });
  const baseUrl = `${NODE_DIST_BASE}v${v}/`;
  const shasumsUrl = `${baseUrl}SHASUMS256.txt`;

  await ensureDir(cacheDir);
  const archivePath = path.join(cacheDir, fileName);
  const tmpArchivePath = `${archivePath}.${process.pid}.tmp`;

  const shasums = parseShasums256(await downloadText(shasumsUrl));
  const expected = shasums.get(fileName);
  if (!expected) throw new Error(`SHA256 not found for ${fileName} in SHASUMS256.txt`);

  if (!(await exists(archivePath))) {
    await downloadToFile(`${baseUrl}${fileName}`, tmpArchivePath);
    await fs.rename(tmpArchivePath, archivePath);
  }

  const actual = await sha256File(archivePath);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    await fs.rm(archivePath, { force: true });
    throw new Error(`Node runtime checksum mismatch for ${fileName}`);
  }

  return { version: v, fileName, archivePath, sha256: actual, baseUrl };
}

async function stageNodeRuntime({ nodeDownload, targetOs, outDir }) {
  const stageRoot = path.join(outDir, 'node-runtime');
  await fs.rm(stageRoot, { recursive: true, force: true });
  await ensureDir(stageRoot);

  const tmpExtract = await fs.mkdtemp(path.join(os.tmpdir(), 'neutrala-node-'));
  await extractArchive(nodeDownload.archivePath, tmpExtract);

  // Locate the node binary inside the extracted tree.
  const findNodeBinary = async () => {
    const queue = [tmpExtract];
    while (queue.length) {
      const dir = queue.shift();
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) queue.push(p);
        else if (targetOs === 'windows' && e.name.toLowerCase() === 'node.exe') return p;
        else if (targetOs !== 'windows' && e.name === 'node') return p;
      }
    }
    return null;
  };

  const nodeBin = await findNodeBinary();
  if (!nodeBin) throw new Error('Failed to locate node binary in downloaded runtime.');

  const destName = targetOs === 'windows' ? 'node.exe' : 'node';
  const destBin = path.join(stageRoot, destName);
  await fs.copyFile(nodeBin, destBin);
  if (targetOs !== 'windows') {
    try {
      await fs.chmod(destBin, 0o755);
    } catch {
      // ignore
    }
  }

  await fs.rm(tmpExtract, { recursive: true, force: true });
  return { dir: stageRoot, nodePath: destBin };
}

async function obfuscateJsTree(stageRoot) {
  const terser = await import('terser');

  async function* walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) yield* walk(full);
      else yield full;
    }
  }

  for await (const filePath of walk(stageRoot)) {
    if (!filePath.endsWith('.js')) continue;
    const code = await fs.readFile(filePath, 'utf8');

    // Conservative "obfuscation": compress only (no mangling) to avoid breaking runtime reflection.
    const result = await terser.minify(code, {
      compress: true,
      mangle: false,
      format: { comments: false },
    });
    if (result.code) {
      await fs.writeFile(filePath, result.code, 'utf8');
    }
  }
}

function buildTargetTriple(targetOs) {
  // Default to x64 for determinism.
  if (targetOs === 'windows') return 'node18-win-x64';
  if (targetOs === 'mac') return process.arch === 'arm64' ? 'node18-macos-arm64' : 'node18-macos-x64';
  return 'node18-linux-x64';
}

async function buildBinary({ entryFile, outFile, target }) {
  const pkgBin = binPath('pkg');
  if (!(await exists(pkgBin))) {
    throw new Error(
      `Missing build dependency: pkg. Run \`npm install\` in ${BACKEND_ROOT} first.`,
    );
  }
  await run(pkgBin, ['-t', target, '--output', outFile, entryFile], {
    cwd: BACKEND_ROOT,
  });
}

async function buildDmg({ appName, srcFolder, outFile }) {
  if (process.platform !== 'darwin') {
    throw new Error('DMG creation requires macOS (hdiutil).');
  }
  await run('hdiutil', [
    'create',
    '-volname',
    appName,
    '-srcfolder',
    srcFolder,
    '-ov',
    '-format',
    'UDZO',
    outFile,
  ]);
}

async function buildMacAppBundle({ appName, bundleId, version, portableDir, outDir, iconIcns }) {
  const safeAppName = String(appName || 'CodeViz').replace(/[^\w .-]/g, '').trim() || 'CodeViz';
  const appDir = path.join(outDir, `${safeAppName}.app`);
  const contentsDir = path.join(appDir, 'Contents');
  const macosDir = path.join(contentsDir, 'MacOS');
  const resourcesDir = path.join(contentsDir, 'Resources');
  const payloadDir = path.join(resourcesDir, 'app');

  await fs.rm(appDir, { recursive: true, force: true });
  await ensureDir(macosDir);
  await ensureDir(resourcesDir);
  await ensureDir(payloadDir);

  await copyDir(portableDir, payloadDir);

  const launcherPath = path.join(macosDir, safeAppName);
  const launcher = `#!/bin/sh\nset -e\nDIR=\"$(cd \"$(dirname \"$0\")\" && pwd)\"\nexec \"$DIR/../Resources/app/desktop/${sanitizePkgName(appName)}\" \"$@\"\n`;
  await fs.writeFile(launcherPath, launcher, 'utf8');
  try {
    await fs.chmod(launcherPath, 0o755);
  } catch {
    // ignore
  }

  const plist = [];
  plist.push('<?xml version="1.0" encoding="UTF-8"?>');
  plist.push('<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">');
  plist.push('<plist version="1.0"><dict>');
  plist.push('<key>CFBundleDevelopmentRegion</key><string>en</string>');
  plist.push(`<key>CFBundleExecutable</key><string>${safeAppName}</string>`);
  plist.push(`<key>CFBundleIdentifier</key><string>${bundleId || 'com.codeviz.desktop'}</string>`);
  plist.push(`<key>CFBundleName</key><string>${safeAppName}</string>`);
  plist.push(`<key>CFBundleShortVersionString</key><string>${version}</string>`);
  plist.push(`<key>CFBundleVersion</key><string>${version}</string>`);
  plist.push('<key>LSMinimumSystemVersion</key><string>10.13</string>');
  if (iconIcns) {
    const iconName = 'app.icns';
    try {
      await fs.copyFile(iconIcns, path.join(resourcesDir, iconName));
      plist.push(`<key>CFBundleIconFile</key><string>${iconName}</string>`);
    } catch {
      // ignore
    }
  }
  plist.push('</dict></plist>');
  await fs.writeFile(path.join(contentsDir, 'Info.plist'), `${plist.join('\n')}\n`, 'utf8');

  return appDir;
}

async function validateMacAppBundle({ appDir, appName, iconExpected }) {
  const safeAppName = String(appName || 'CodeViz').replace(/[^\w .-]/g, '').trim() || 'CodeViz';
  const contentsDir = path.join(appDir, 'Contents');
  const plistPath = path.join(contentsDir, 'Info.plist');
  const launcherPath = path.join(contentsDir, 'MacOS', safeAppName);
  const payloadExe = path.join(contentsDir, 'Resources', 'app', 'desktop', sanitizePkgName(appName));
  const iconPath = path.join(contentsDir, 'Resources', 'app.icns');

  if (!(await exists(plistPath))) throw new Error(`Invalid .app bundle (missing Info.plist): ${plistPath}`);
  if (!(await exists(launcherPath))) throw new Error(`Invalid .app bundle (missing launcher): ${launcherPath}`);
  if (!(await exists(payloadExe))) throw new Error(`Invalid .app bundle (missing desktop binary): ${payloadExe}`);
  if (iconExpected && !(await exists(iconPath))) {
    throw new Error(`Icon embedding failed (missing ${iconPath}). Provide a valid .icns icon.`);
  }
}

function arHeader(name, size, mtime = Math.floor(Date.now() / 1000), uid = 0, gid = 0, mode = 0o100644) {
  const n = (name.endsWith('/') ? name : `${name}/`).slice(0, 16).padEnd(16, ' ');
  const d = String(mtime).padEnd(12, ' ');
  const u = String(uid).padEnd(6, ' ');
  const g = String(gid).padEnd(6, ' ');
  const m = mode.toString(8).padEnd(8, ' ');
  const s = String(size).padEnd(10, ' ');
  return Buffer.from(`${n}${d}${u}${g}${m}${s}\`\n`, 'ascii');
}

async function buildDeb({ pkgName, version, arch, maintainer, license, description, binaryPath, outFile }) {
  // .deb = ar archive of:
  // - debian-binary (2.0\n)
  // - control.tar.gz (control metadata)
  // - data.tar.gz (payload)
  const tarMod = await import('tar');
  const tar = tarMod.default ?? tarMod;

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neutrala-deb-'));
  const controlDir = path.join(workDir, 'control');
  const dataDir = path.join(workDir, 'data');
  await ensureDir(controlDir);
  await ensureDir(path.join(dataDir, 'usr', 'local', 'bin'));
  await ensureDir(path.join(dataDir, 'opt', pkgName));

  const controlText = [
    `Package: ${pkgName}`,
    `Version: ${version}`,
    `Section: utils`,
    `Priority: optional`,
    `Architecture: ${arch}`,
    `Maintainer: ${maintainer || 'unknown'}`,
    `Description: ${description || pkgName}`,
    `License: ${license || 'UNLICENSED'}`,
    '',
  ].join('\n');
  await fs.writeFile(path.join(controlDir, 'control'), controlText, 'utf8');

  // Install full bundle to /opt/<pkgName>/ and provide a tiny launcher in /usr/local/bin/<pkgName>
  const optDir = path.join(dataDir, 'opt', pkgName);
  await copyDir(path.dirname(binaryPath), optDir);

  const launcherPath = path.join(dataDir, 'usr', 'local', 'bin', pkgName);
  const launcher = `#!/bin/sh\nset -e\nDIR=\"/opt/${pkgName}\"\nexec \"$DIR/${path.basename(binaryPath)}\" \"$@\"\n`;
  await fs.writeFile(launcherPath, launcher, 'utf8');
  try {
    await fs.chmod(launcherPath, 0o755);
  } catch {
    // ignore
  }

  const controlTar = path.join(workDir, 'control.tar.gz');
  const dataTar = path.join(workDir, 'data.tar.gz');

  await tar.c({ gzip: true, cwd: controlDir, file: controlTar }, ['.']);
  await tar.c({ gzip: true, cwd: dataDir, file: dataTar }, ['.']);

  const debianBinary = Buffer.from('2.0\n', 'ascii');
  const controlBuf = await fs.readFile(controlTar);
  const dataBuf = await fs.readFile(dataTar);

  const chunks = [Buffer.from('!<arch>\n', 'ascii')];
  const pushFile = (name, buf) => {
    chunks.push(arHeader(name, buf.length));
    chunks.push(buf);
    if (buf.length % 2 === 1) chunks.push(Buffer.from('\n', 'ascii'));
  };

  pushFile('debian-binary', debianBinary);
  pushFile('control.tar.gz', controlBuf);
  pushFile('data.tar.gz', dataBuf);

  await fs.writeFile(outFile, Buffer.concat(chunks));
}

async function buildDebDesktop({
  pkgName,
  appName,
  desktopExeName,
  version,
  arch,
  maintainer,
  license,
  description,
  bundleDir,
  outFile,
  iconPng,
}) {
  const tarMod = await import('tar');
  const tar = tarMod.default ?? tarMod;

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neutrala-deb-gui-'));
  const controlDir = path.join(workDir, 'control');
  const dataDir = path.join(workDir, 'data');
  await ensureDir(controlDir);
  await ensureDir(dataDir);

  await ensureDir(path.join(dataDir, 'opt', pkgName));
  await ensureDir(path.join(dataDir, 'usr', 'local', 'bin'));
  await ensureDir(path.join(dataDir, 'usr', 'share', 'applications'));
  await ensureDir(path.join(dataDir, 'usr', 'share', 'icons', 'hicolor', '256x256', 'apps'));

  const controlText = [
    `Package: ${pkgName}`,
    `Version: ${version}`,
    `Section: utils`,
    `Priority: optional`,
    `Architecture: ${arch}`,
    `Maintainer: ${maintainer || 'unknown'}`,
    `Description: ${description || pkgName}`,
    `License: ${license || 'UNLICENSED'}`,
    '',
  ].join('\n');
  await fs.writeFile(path.join(controlDir, 'control'), controlText, 'utf8');

  // Payload: /opt/<pkgName>/ contains the full desktop portable folder.
  await copyDir(bundleDir, path.join(dataDir, 'opt', pkgName));

  // Launcher: runs the Neutralino desktop binary.
  const launcherPath = path.join(dataDir, 'usr', 'local', 'bin', pkgName);
  const launcher = `#!/bin/sh\nset -e\nDIR=\"/opt/${pkgName}\"\nexec \"$DIR/desktop/${desktopExeName}\" \"$@\"\n`;
  await fs.writeFile(launcherPath, launcher, 'utf8');
  try {
    await fs.chmod(launcherPath, 0o755);
  } catch {
    // ignore
  }

  // Desktop entry.
  const desktopEntry = [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${appName || pkgName}`,
    `Exec=${pkgName}`,
    `Icon=${pkgName}`,
    'Terminal=false',
    'Categories=Development;Utility;',
    '',
  ].join('\n');
  await fs.writeFile(
    path.join(dataDir, 'usr', 'share', 'applications', `${pkgName}.desktop`),
    desktopEntry,
    'utf8',
  );

  if (iconPng) {
    try {
      await fs.copyFile(
        iconPng,
        path.join(dataDir, 'usr', 'share', 'icons', 'hicolor', '256x256', 'apps', `${pkgName}.png`),
      );
    } catch {
      // ignore
    }
  }

  // Uninstall helper (deb is managed by dpkg/apt; this is a convenience script).
  const uninstallPath = path.join(dataDir, 'opt', pkgName, 'uninstall.sh');
  const uninstall = `#!/bin/sh\nset -e\necho \"This app was installed via a .deb package.\"\necho \"To uninstall:\" \necho \"  sudo apt remove ${pkgName}\"\n`;
  await fs.writeFile(uninstallPath, uninstall, 'utf8');
  try {
    await fs.chmod(uninstallPath, 0o755);
  } catch {
    // ignore
  }

  const controlTar = path.join(workDir, 'control.tar.gz');
  const dataTar = path.join(workDir, 'data.tar.gz');
  await tar.c({ gzip: true, cwd: controlDir, file: controlTar }, ['.']);
  await tar.c({ gzip: true, cwd: dataDir, file: dataTar }, ['.']);

  const debianBinary = Buffer.from('2.0\n', 'ascii');
  const controlBuf = await fs.readFile(controlTar);
  const dataBuf = await fs.readFile(dataTar);

  const chunks = [Buffer.from('!<arch>\n', 'ascii')];
  const pushFile = (name, buf) => {
    chunks.push(arHeader(name, buf.length));
    chunks.push(buf);
    if (buf.length % 2 === 1) chunks.push(Buffer.from('\n', 'ascii'));
  };

  pushFile('debian-binary', debianBinary);
  pushFile('control.tar.gz', controlBuf);
  pushFile('data.tar.gz', dataBuf);

  await fs.writeFile(outFile, Buffer.concat(chunks));
}

async function main() {
  // Setup global process supervisor for clean shutdown
  setupSupervisor();

  const PHASE_TOTAL = 9;
  let phaseIndex = 0;
  const phase = (name) => {
    phaseIndex += 1;
    // eslint-disable-next-line no-console
    console.log(`\n[Phase ${phaseIndex}/${PHASE_TOTAL}] ${name}`);
  };

  await ensureDir(BUILD_ROOT);
  const outDir = path.join(BUILD_ROOT, 'out');
  const stageDir = path.join(BUILD_ROOT, 'stage');
  const cacheDir = path.join(BUILD_ROOT, 'cache');
  console.log(`Cleaning build directory: ${outDir}`);
  await fs.rm(outDir, { recursive: true, force: true });
  await ensureDir(outDir);

  phase('Validating Toolchain');
  const toolchain = await validateToolchain({
    backendRoot: BACKEND_ROOT,
    requirePkg: false, // ensureBuildDependencies may install it
    requireNeu: false,
    requireFrontend: false,
    requireDesktop: false,
  });
  for (const w of toolchain.warnings || []) console.warn(`Warning: ${w}`);
  if (!toolchain.ok) {
    throw new Error(`Toolchain validation failed:\n- ${(toolchain.errors || []).join('\n- ')}`);
  }

  await ensureBuildDependencies();
  // Re-check pkg after local installs.
  const toolchainAfterDeps = await validateToolchain({
    backendRoot: BACKEND_ROOT,
    requirePkg: true,
    requireNeu: false,
  });
  for (const w of toolchainAfterDeps.warnings || []) console.warn(`Warning: ${w}`);
  if (!toolchainAfterDeps.ok) {
    throw new Error(
      `Toolchain validation failed after dependencies install:\n- ${(toolchainAfterDeps.errors || []).join('\n- ')}`,
    );
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q, dflt) => {
    const suffix = dflt ? ` (${dflt})` : '';
    const ans = (await rl.question(`${q}${suffix}: `)).trim();
    return ans || dflt || '';
  };

  const targetOsRaw = (await ask('Target OS [windows/mac/linux]', process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux')).toLowerCase();
  const targetOs = targetOsRaw === 'win' ? 'windows' : targetOsRaw;
  if (!['windows', 'mac', 'linux'].includes(targetOs)) {
    throw new Error(`Invalid target OS: ${targetOsRaw}`);
  }

  const appName = await ask('App name', 'CodeViz');
  const author = await ask('Author', '');
  const license = await ask('License', 'MIT');
  const version = await ask('Version', '1.0.0');
  const defaultIcon = path.join(FRONTEND_ROOT, 'public', 'codeviz.png');
  const hasDefaultIcon = await exists(defaultIcon);
  const appIcon = await ask('App icon path (optional)', hasDefaultIcon ? defaultIcon : '');
  const appIconPng = await ask('App icon PNG path (optional; Linux .desktop)', appIcon);
  const appIconIco = await ask('App icon ICO path (optional; Windows NSIS)', appIcon.endsWith('.png') ? appIcon : '');
  const uninstallIcon = await ask('Uninstall icon path (optional)', appIcon);
  const buildDesktopRaw = (await ask('Build Neutralino desktop portable bundle? [y/N]', 'N')).toLowerCase();
  const buildDesktop = ['y', 'yes', 'true', '1'].includes(buildDesktopRaw);
  const buildWindowsInstallerRaw =
    targetOs === 'windows'
      ? (await ask('Build NSIS installer (requires makensis in PATH)? [y/N]', 'N')).toLowerCase()
      : 'n';
  const buildWindowsInstaller = ['y', 'yes', 'true', '1'].includes(buildWindowsInstallerRaw);

  if (buildDesktop && !process.env.NEUTRALA_RUNTIME_VERSION) {
    const v = await ask('Neutralino runtime version (NEUTRALA_RUNTIME_VERSION)', '');
    if (v) process.env.NEUTRALA_RUNTIME_VERSION = v;
  }

  if (buildDesktop) {
    const hostOs = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
    if (hostOs !== targetOs) {
      throw new Error(
        `Desktop bundles must be built on the target OS (host=${hostOs}, target=${targetOs}). Run this build on ${targetOs}.`,
      );
    }
  }

  if (buildDesktop) {
    const hasNeu = !!toolchain?.versions?.neu;
    const hasNpx = !!toolchain?.versions?.npx;
    if (!hasNeu && !hasNpx) {
      throw new Error('Desktop bundles require `neu` (preferred) or `npx` (fallback) in PATH.');
    }
  }

  // Validate optional icons up-front (fail fast if user supplies the wrong type).
  const resolvedUninstallIcon = resolveUserPath(uninstallIcon);
  if (resolvedUninstallIcon && !(await exists(resolvedUninstallIcon))) {
    throw new Error(`Uninstall icon not found: ${resolvedUninstallIcon}`);
  }

  const resolvedAppIconPng = appIconPng ? await validateIconFile(appIconPng, 'png') : '';
  const resolvedAppIconIco = appIconIco ? await validateIconFile(appIconIco, 'ico') : '';

  let resolvedAppIconIcns = '';
  if (appIcon) {
    if (String(appIcon).toLowerCase().endsWith('.icns')) {
      resolvedAppIconIcns = await validateIconFile(appIcon, 'icns');
    } else if (targetOs === 'mac') {
      throw new Error(`macOS app icon must be a .icns file (got: ${resolveUserPath(appIcon)})`);
    }
  }

  let frontendDistDir = null;
  phase('Building Frontend');
  if (buildDesktop) {
    const syncScript = path.join(DESKTOP_ROOT, 'scripts', 'sync-assets.mjs');
    console.log('Synchronizing assets and icons for build...');
    try {
      await run(process.execPath, [syncScript], { cwd: REPO_ROOT });
    } catch (err) {
      console.warn(
        `Warning: asset synchronization failed; attempting to continue with existing assets. ${err?.message || err}`,
      );
    }
    frontendDistDir = await buildFrontend();
  } else {
    console.log('Skipping frontend build (desktop bundle disabled).');
  }

  const formatDefault = targetOs === 'windows' ? 'exe' : targetOs === 'mac' ? 'dmg' : 'deb';
  const outputFormatRaw = (await ask('Output format [exe/dmg/deb]', formatDefault)).toLowerCase();
  const outputFormat = outputFormatRaw;

  rl.close();

  if (targetOs === 'windows' && outputFormat !== 'exe') {
    throw new Error('Windows builds must use output format exe.');
  }
  if (targetOs === 'mac' && outputFormat !== 'dmg') {
    throw new Error('macOS builds must use output format dmg.');
  }
  if (targetOs === 'linux' && outputFormat !== 'deb') {
    throw new Error('Linux builds must use output format deb.');
  }

  const safeName = sanitizePkgName(appName);
  const buildId = crypto.randomBytes(6).toString('hex');
  const bundleDir = path.join(outDir, `${safeName}-${version}-${targetOs}`);
  await fs.rm(bundleDir, { recursive: true, force: true });
  await ensureDir(bundleDir);

  const metadata = {
    appName,
    safeName,
    author,
    license,
    version,
    targetOs,
    outputFormat,
    appIcon: appIcon || null,
    appIconPng: appIconPng || null,
    appIconIco: appIconIco || null,
    uninstallIcon: uninstallIcon || null,
    buildDesktop,
    buildWindowsInstaller,
    buildId,
    builtAt: new Date().toISOString(),
    nodeRuntime: {
      version: DEFAULT_NODE_RUNTIME_VERSION,
      distBase: NODE_DIST_BASE,
    },
  };

  phase('Packaging Backend');
  await fs.writeFile(path.join(BUILD_ROOT, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

  // Stage sources for bundling.
  await fs.rm(stageDir, { recursive: true, force: true });
  await ensureDir(stageDir);
  await copyDir(path.join(BACKEND_ROOT, 'src'), path.join(stageDir, 'src'));
  await fs.copyFile(path.join(BACKEND_ROOT, 'package.json'), path.join(stageDir, 'package.json'));

  const entryFile = path.join(stageDir, 'src', 'server.js');
  if (!(await exists(entryFile))) throw new Error(`Missing entry file: ${entryFile}`);

  // Transpile ESM to CJS for pkg compatibility.
  // We do this BEFORE obfuscation for better reliability.
  console.log('Transpiling backend to CommonJS (esbuild)...');
  const cjsOutDir = path.join(stageDir, 'dist-backend');
  await ensureDir(cjsOutDir);
  const cjsEntry = path.join(cjsOutDir, 'server.cjs');

  try {
    const esbuildCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    await run(esbuildCmd, [
      'esbuild',
      entryFile,
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--outfile=' + cjsEntry,
      '--external:fsevents',
      '--external:pino-pretty',
      '--banner:js=var/**/__im_url=require(\'url\').pathToFileURL(__filename).href;',
      '--define:import.meta.url=__im_url',
    ]);
  } catch (err) {
    throw new Error(`Failed to bundle backend with esbuild: ${err.message}`);
  }

  // Obfuscate the resulting bundle (basic + safe).
  try {
    await obfuscateJsTree(cjsOutDir);
  } catch (err) {
    console.warn(`Warning: Obfuscation failed (non-fatal): ${err.message}`);
  }


  const target = buildTargetTriple(targetOs);
  const backendExeName = targetOs === 'windows' ? `${safeName}-server.exe` : `${safeName}-server`;
  const binaryOut = path.join(bundleDir, backendExeName);

  console.log(`\nBuilding backend binary with pkg target=${target}...`);
  await buildBinary({ entryFile: cjsEntry, outFile: binaryOut, target });

  // Bundle runtime assets alongside the binary.
  // Bundle runtime assets alongside the binary.
  // Prefer repository-level resources (top-level `resources/`) so that toolchains
  // and other global assets are included even when backend/resources is minimal.
  const repoResources = path.join(REPO_ROOT, 'resources');
  const backendResources = path.join(BACKEND_ROOT, 'resources');
  const targetResources = path.join(bundleDir, 'resources');
  await ensureDir(targetResources);

  // Copy repo-level resources first (contains toolchain, runtime packs, etc.).
  if (await exists(repoResources)) {
    await copyDir(repoResources, targetResources);
  }

  // Then overlay backend-level resources so backend can override repo defaults.
  if (await exists(backendResources)) {
    await copyDir(backendResources, targetResources);
  }
  const envExample = path.join(BACKEND_ROOT, '.env.example');
  if (await exists(envExample)) {
    await fs.copyFile(envExample, path.join(bundleDir, '.env.example'));
  }

  // Download + stage Node runtime beside the artifact (no global Node required).
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const nodeDownload = await downloadNodeRuntime({
    targetOs,
    arch,
    version: DEFAULT_NODE_RUNTIME_VERSION,
    cacheDir,
  });
  const stagedNode = await stageNodeRuntime({ nodeDownload, targetOs, outDir: bundleDir });

  phase('Preparing Neutralino Runtime');
  // Ensure Neutralino runtime is present in bundled resources (auto-download if configured).
  try {
    const { ensureRuntime } = await import('../src/utils/runtime-manager.js');
    const resourcesDir = path.join(bundleDir, 'resources');
    await ensureRuntime({
      resourcesDir,
      supportedRange: process.env.NEUTRALA_RUNTIME_RANGE || undefined,
    });
  } catch (err) {
    const msg = `Neutralino runtime was not bundled (download/verify failed). ${err?.message || err}`;
    if (process.env.NEUTRALA_RUNTIME_OPTIONAL === 'true') {
      console.warn(`Warning: ${msg}`);
    } else {
      if (buildDesktop) {
        throw new Error(
          `${msg}\nDesktop bundles require the Neutralino runtime. Set NEUTRALA_RUNTIME_VERSION and rerun (recommended), or set NEUTRALA_RUNTIME_OPTIONAL=true to bypass.`,
        );
      }
      throw new Error(`${msg}\nSet NEUTRALA_RUNTIME_OPTIONAL=true to bypass.`);
    }
  }

  const outMetadata = {
    ...metadata,
    outputs: {
      binary: {
        path: binaryOut,
      },
      stagedNode: {
        dir: stagedNode.dir,
        nodePath: stagedNode.nodePath,
        archive: nodeDownload.fileName,
        sha256: nodeDownload.sha256,
      },
    },
  };

  phase('Creating Desktop Bundle');
  let desktopPortable = null;
  if (buildDesktop) {
    console.log('\nBuilding Neutralino desktop portable bundle...');
    const desktopTemplateConfigPath = path.join(DESKTOP_ROOT, 'neutralino.config.json');
    desktopPortable = await buildDesktopPortable({
      desktopTemplateConfigPath,
      backendBundleDir: bundleDir,
      backendBinaryPath: binaryOut,
      outDir,
      safeName,
      appName,
      version,
      targetOs,
      appIconIco: resolvedAppIconIco || '',
      appIconPng: resolvedAppIconPng || '',
      uninstallIcon: resolvedUninstallIcon || '',
      distDir: frontendDistDir,
    });

    // Copy bundled WebView2 if present
    const webview2Res = path.join(REPO_ROOT, 'resources', 'webview2');
    if (await exists(webview2Res)) {
      console.log('Bundling WebView2 Fixed Version Runtime...');
      const dst = path.join(desktopPortable.desktopDir, 'resources', 'webview2');
      await ensureDir(dst);
      await copyDir(webview2Res, dst);
    }

    // Copy bundled WebView2 setup if present
    const webview2Setup = path.join(REPO_ROOT, 'resources', 'webview2_setup.exe');
    if (await exists(webview2Setup)) {
      console.log('Bundling WebView2 Setup Executable...');
      const dst = path.join(desktopPortable.desktopDir, 'resources', 'webview2_setup.exe');
      await fs.copyFile(webview2Setup, dst);
    }

    if (frontendDistDir) {
      console.log('Copying frontend assets to backend resources for static serving...');
      const backendResources = path.join(desktopPortable.backendDir, 'resources');
      await ensureDir(backendResources);
      await copyDir(frontendDistDir, backendResources);

      // Verification: Check if clang/resources exist in backend
      const expectedClang = targetOs === 'windows' ? 'clang.exe' : 'clang';
      const clangPath = path.join(backendResources, expectedClang);
      // Also check for libc++ headers/libs if possible, but clang is the main one.
      if (await exists(clangPath)) {
        console.log(`Verified bundled clang at: ${clangPath}`);
      } else {
        console.warn(`WARNING: Clang not found in backend bundle at ${clangPath}. Toolchain might be incomplete.`);
        // List contents to help debugging
        try {
          const files = await fs.readdir(backendResources);
          console.log(`Contents of ${backendResources}:`, files.slice(0, 10));
        } catch (e) { console.log(`Could not list ${backendResources}: ${e.message}`); }
      }
    }

    console.log(`Desktop portable bundle: ${desktopPortable.portableDir}`);
  } else {
    console.log('Skipping desktop bundle (disabled).');
  }

  phase('Creating Installer');
  let installerOutFile = null;
  if (outputFormat === 'exe') {
    console.log(`\nBuild complete: ${binaryOut}`);
    if (desktopPortable && buildWindowsInstaller) {
      const fileBase = String(appName || '').replace(/[^\w.-]+/g, '').trim() || safeName;
      const installerOut = path.join(outDir, `${fileBase}-${version}-setup.exe`);
      const nsiPath = await buildNsiInstaller({
        pkgName: safeName,
        appName,
        srcDir: desktopPortable.portableDir,
        outFile: installerOut,
        iconIco: resolvedAppIconIco || null,
        desktopExeName: desktopPortable.desktopExeName,
        version,
      });
      console.log(`NSIS script generated: ${nsiPath}`);

      // Resolve makensis command: prefer local portable version if available.
      const localNsisBin = path.join(REPO_ROOT, 'resources', 'nsis', 'nsis-3.11', 'Bin', 'makensis.exe');
      let makensisCmd = 'makensis';
      try {
        await fs.access(localNsisBin);
        makensisCmd = localNsisBin;
        console.log(`Using local NSIS: ${makensisCmd}`);
      } catch {
        // use default 'makensis' from PATH
      }

      try {
        await run(makensisCmd, [nsiPath]);
        console.log(`NSIS installer generated: ${installerOut}`);
        installerOutFile = installerOut;
      } catch {
        console.log('\nWarning: `makensis` is missing or failed. Creating a portable ZIP archive instead...');
        const zipOut = path.join(outDir, `${fileBase}-${version}-portable.zip`);
        try {
          // Use powershell to create a zip of the portable directory.
          const zipCmd = `Compress-Archive -Path '${desktopPortable.portableDir}\\*' -DestinationPath '${zipOut}' -Force`;
          await run('powershell', ['-NoProfile', '-Command', zipCmd]);
          console.log(`Portable ZIP generated: ${zipOut}`);
          installerOutFile = zipOut; // Use ZIP as the primary "installer" output if EXE failed.
        } catch (zipErr) {
          console.error(`Failed to create portable ZIP: ${zipErr.message}`);
          console.log('Run `makensis` to produce the EXE installer (NSIS is not bundled).');
        }
      }
    }
  }

  let dmgOutFile = null;
  if (outputFormat === 'dmg') {
    const fileBase = String(appName || '').replace(/[^\w.-]+/g, '').trim() || safeName;
    const dmgOut = path.join(outDir, `${fileBase}-${version}.dmg`);
    dmgOutFile = dmgOut;
    const dmgFolder = path.join(stageDir, 'dmg');
    await fs.rm(dmgFolder, { recursive: true, force: true });
    await ensureDir(dmgFolder);

    // For desktop builds, create a proper .app bundle and place it on the DMG.
    if (desktopPortable) {
      const appBundle = await buildMacAppBundle({
        appName,
        bundleId: 'com.codeviz.desktop',
        version,
        portableDir: desktopPortable.portableDir,
        outDir: stageDir,
        iconIcns: resolvedAppIconIcns || null,
      });
      await validateMacAppBundle({ appDir: appBundle, appName, iconExpected: !!resolvedAppIconIcns });
      await copyDir(appBundle, path.join(dmgFolder, path.basename(appBundle)));
    } else {
      // Backend-only: put the entire backend bundle on the DMG.
      await copyDir(bundleDir, dmgFolder);
      if (resolvedAppIconIcns && (await exists(resolvedAppIconIcns))) {
        await fs.copyFile(resolvedAppIconIcns, path.join(dmgFolder, path.basename(resolvedAppIconIcns)));
      }
    }
    console.log(`\nCreating DMG...`);
    await buildDmg({ appName, srcFolder: dmgFolder, outFile: dmgOut });
    console.log(`\nBuild complete: ${dmgOut}`);
  }

  let debOutFile = null;
  if (outputFormat === 'deb') {
    const debOut = path.join(outDir, `${safeName}-${version}.deb`);
    debOutFile = debOut;
    console.log(`\nCreating DEB...`);
    if (desktopPortable) {
      await buildDebDesktop({
        pkgName: safeName,
        appName,
        desktopExeName: desktopPortable.desktopExeName,
        version,
        arch: 'amd64',
        maintainer: author,
        license,
        description: `${appName} desktop`,
        bundleDir: desktopPortable.portableDir,
        outFile: debOut,
        iconPng: resolvedAppIconPng || null,
      });
    } else {
      await buildDeb({
        pkgName: safeName,
        version,
        arch: 'amd64',
        maintainer: author,
        license,
        description: `${appName} backend`,
        binaryPath: binaryOut,
        outFile: debOut,
      });
    }
    console.log(`\nBuild complete: ${debOut}`);
  }

  phase('Hash Verification');
  outMetadata.outputs.binary.sha256 = await sha256File(binaryOut);
  if (installerOutFile) outMetadata.outputs.installer = { path: installerOutFile, sha256: await sha256File(installerOutFile) };
  if (dmgOutFile) outMetadata.outputs.dmg = { path: dmgOutFile, sha256: await sha256File(dmgOutFile) };
  if (debOutFile) outMetadata.outputs.deb = { path: debOutFile, sha256: await sha256File(debOutFile) };

  phase('Writing Metadata');
  await fs.writeFile(path.join(bundleDir, 'metadata.json'), `${JSON.stringify(outMetadata, null, 2)}\n`, 'utf8');

  phase('Finalizing Build');
  try {
    const diagPath = await writeDiagnostics({
      backendRoot: BACKEND_ROOT,
      build: {
        metadata,
        outputs: outMetadata.outputs,
        bundleDir,
        outDir,
      },
    });
    console.log(`Diagnostics: ${diagPath}`);
  } catch {
    // ignore
  }

  console.log('\nRun instructions:');
  if (targetOs === 'windows') {
    if (desktopPortable) {
      console.log(`- Portable desktop: ${path.join(desktopPortable.portableDir, 'run-desktop.bat')}`);
      console.log(`- Desktop binary: ${path.join(desktopPortable.portableDir, 'desktop', desktopPortable.desktopExeName)}`);
    }
    console.log(`- Backend binary: ${binaryOut}`);
    if (installerOutFile) console.log(`- Installer: ${installerOutFile}`);
  } else if (targetOs === 'mac') {
    if (dmgOutFile) console.log(`- Open DMG: ${dmgOutFile}`);
    if (desktopPortable) console.log(`- Desktop portable folder (inside build stage): ${desktopPortable.portableDir}`);
    console.log(`- Backend binary: ${binaryOut}`);
  } else if (targetOs === 'linux') {
    if (debOutFile) {
      console.log(`- Install: sudo apt install ./${path.basename(debOutFile)}`);
      console.log(`- Run: ${safeName}`);
    }
    if (desktopPortable) console.log(`- Desktop portable folder: ${desktopPortable.portableDir}`);
    console.log(`- Backend binary: ${binaryOut}`);
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
