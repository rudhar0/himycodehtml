import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { toolchainService } from '../src/services/toolchain.service.js';
import { detectRuntime } from '../src/utils/runtime-manager.js';
import {
  safeSpawn as safespawnUtil,
  spawnInteractive,
  locateCommand,
  getCommandVersion,
  shouldUseShell,
  normalizeArgs,
  formatSpawnDebug,
  getNpmCommand,
  getNpxCommand,
  getLocalBinPath,
} from './_lib/process-utils.js';
import { setupSupervisor, registerProcess, waitForProcess } from './_lib/process-supervisor.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');
const FRONTEND_ROOT = path.join(REPO_ROOT, 'frontend');
const DESKTOP_ROOT = path.join(REPO_ROOT, 'desktop');
const RUNTIME_DIR = path.join(BACKEND_ROOT, '.runtime');

const DEBUG = process.env.NEUTRALA_DEBUG === 'true';
const REQUIRED_TOOLS = ['node'];
const OPTIONAL_TOOLS = ['clang', 'neu'];

function isWindows() {
  return process.platform === 'win32';
}

function pathEnv() {
  return process.env.PATH || process.env.Path || '';
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseNodeMajor(v) {
  const major = Number(String(v || '').split('.')[0]);
  return Number.isFinite(major) ? major : null;
}

function logPhase(i, total, name) {
  // eslint-disable-next-line no-console
  console.log(`\n[Phase ${i}/${total}] ${name}`);
}

/**
 * Detect development mode based on NODE_ENV.
 */
function isDevMode() {
  return process.env.NODE_ENV !== 'production';
}

function bannerLine(text) {
  // eslint-disable-next-line no-console
  console.log(text);
}

async function safeSpawn(command, args = [], options = {}) {
  // Use the imported safeSpawn from process-utils
  // This ensures consistent Windows command resolution
  return safespawnUtil(command, args, options);
}

// Helper to check if a command works
async function commandWorks(command, args = [], options = {}) {
  const cmd = String(command || '').trim();
  if (!cmd) return false;
  const res = await safeSpawn(cmd, args, { ...options, timeoutMs: options.timeoutMs ?? 5000 });
  return res.success;
}

async function detectNeuCommand() {
  const candidate = process.env.NEUTRALA_NEU_BIN || 'neu';
  const loc = await locateCommand(candidate);
  if (!loc.found) return null;
  if (await commandWorks(candidate, ['--version'])) return candidate;
  if (await commandWorks(candidate, ['version'])) return candidate;
  return null;
}

async function detectNpxCommand() {
  const npx = 'npx';
  const loc = await locateCommand(npx);
  if (!loc.found) return null;
  if (await commandWorks(npx, ['--version'])) return npx;
  return null;
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
      if (!versions.length) continue;
      // Any installed version counts.
      return { ok: true, reason: `found-in-${base}` };
    } catch {
      // continue
    }
  }
  return { ok: false, reason: 'not-found' };
}

async function findNeutralinoRuntimeBinary() {
  const binDir = path.join(DESKTOP_ROOT, 'bin');
  if (!(await exists(binDir))) return null;
  const queue = [binDir];
  while (queue.length) {
    const dir = queue.shift();
    let ents = [];
    try {
      ents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) queue.push(p);
      else if (e.isFile()) {
        const n = e.name.toLowerCase();
        if (process.platform === 'win32' && n.startsWith('neutralino') && n.endsWith('.exe')) return p;
        if (process.platform !== 'win32' && n.startsWith('neutralino') && !n.endsWith('.dll')) return p;
      }
    }
  }
  return null;
}

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function fetchJson(url, timeoutMs = 1200) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchOk(url, timeoutMs = 800) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return !!res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function resolveHealthyBackend() {
  const portPath = path.join(RUNTIME_DIR, 'port.json');
  const info = await readJson(portPath);
  const port = Number(info?.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const baseUrl = `http://127.0.0.1:${port}`;
  const health = await fetchJson(`${baseUrl}/api/health`, 1200);
  if (health?.status === 'ok') return { baseUrl, port, portPath };
  return null;
}

async function waitForBackendHealth(timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const healthy = await resolveHealthyBackend();
    if (healthy) return healthy;
    await sleep(250);
  }
  return null;
}

async function isViteUp(customUrl = null) {
  const baseUrl = customUrl || process.env.NEUTRALA_DEV_URL || 'http://127.0.0.1:5173';
  // Try both client endpoint (Vite specific) and root
  const clientUp = await fetchOk(`${baseUrl}/@vite/client`, 800);
  if (clientUp) return true;
  return await fetchOk(baseUrl, 800);
}

function spawnTracked(command, args, opts = {}) {
  const cmd = String(command || '').trim();
  const argv = normalizeArgs(args);
  if (!cmd) {
    // Never crash the launcher on invalid spawn input.
    bannerLine('⚠ Attempted to spawn an empty command (skipping).');
    return null;
  }

  const shell = opts.shell ?? shouldUseShell(cmd);
  if (DEBUG) {
    bannerLine(`[debug] spawnTracked: ${formatSpawnDebug(cmd, argv)} (shell=${shell ? 'true' : 'false'})`);
  }

  const child = spawnInteractive(cmd, argv, {
    shell,
    ...opts,
  });

  if (child) {
    // Register with supervisor for graceful shutdown
    registerProcess(child, `started:${cmd}`, 50, []);
  }

  return child;
}



async function writeDiagnostics({ backendHealth, toolchain, webview2, phases, envDoctor, errors }) {
  try {
    await fs.mkdir(RUNTIME_DIR, { recursive: true });
    const portInfo = await readJson(path.join(RUNTIME_DIR, 'port.json'));
    const lockInfo = await readJson(path.join(RUNTIME_DIR, 'port.lock'));
    const runtime = await detectRuntime({
      resourcesDir: path.join(BACKEND_ROOT, 'resources'),
      supportedRange: process.env.NEUTRALA_RUNTIME_RANGE || undefined,
    });
    const payload = {
      timestamp: new Date().toISOString(),
      os: { platform: process.platform, release: os.release(), arch: process.arch },
      node: { version: process.versions.node, execPath: process.execPath },
      envDoctor: envDoctor || null,
      phases: Array.isArray(phases) ? phases : [],
      errors: Array.isArray(errors) ? errors : [],
      toolchain,
      webview2,
      runtime,
      backend: {
        healthy: !!backendHealth,
        ...backendHealth,
        portInfo,
        lockInfo,
      },
    };
    await fs.writeFile(
      path.join(RUNTIME_DIR, 'diagnostics.json'),
      `${JSON.stringify(payload, null, 2)}\n`,
      'utf8',
    );
  } catch {
    // ignore
  }
}

async function ensureWritableDirectory(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
    const testFile = path.join(dir, `.writetest-${process.pid}-${Date.now()}.tmp`);
    await fs.writeFile(testFile, 'ok', 'utf8');
    await fs.unlink(testFile);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

function printToolMissing(name) {
  bannerLine(`⚠ Tool missing: ${name}`);
  bannerLine('PATH:');
  bannerLine(pathEnv() || '(empty)');

  if (name === 'node' || name === 'npm') {
    bannerLine('Install suggestion: https://nodejs.org (Node.js >= 18)');
  }
  if (name === 'clang') {
    bannerLine('Install suggestion: https://llvm.org');
  }
  if (name === 'neu') {
    bannerLine('Run:');
    bannerLine('  npm install -g @neutralinojs/neu');
    bannerLine('If PowerShell blocks scripts:');
    bannerLine('  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned');
  }
}

async function legacyMain() {
  const TOTAL = 8;
  bannerLine('🚀 Starting NeutralaJS Desktop');

  logPhase(1, TOTAL, 'Toolchain Validation');
  const nodeMajor = parseNodeMajor(process.versions.node);
  if (!nodeMajor || nodeMajor < 18) {
    throw new Error(`Node.js ${process.versions.node} is unsupported. Require >= 18.`);
  }

  const npmOk = await commandWorks(npmBin(), ['--version']);
  if (!npmOk) throw new Error('npm is required but was not found in PATH.');

  const pkgBin = getLocalBinPath(BACKEND_ROOT, 'pkg');
  const pkgOk = await exists(pkgBin);
  if (!pkgOk) {
    bannerLine(`⚠ pkg not found at ${pkgBin} (builds will fail; run \`npm install\` in backend/)`);
  }

  const toolchainStatus = await toolchainService.verify();
  if (!toolchainStatus?.compiler) {
    throw new Error(
      'Bundled Clang toolchain is missing/invalid (resources/toolchain). Reinstall resources or rerun setup.',
    );
  }

  const webview2 = await detectWebView2();
  if (!webview2.ok && process.platform === 'win32') {
    bannerLine('⚠ WebView2 Runtime not detected (warn only). Installer/runtime will prompt for it.');
  }
  bannerLine('✔ Toolchain OK');

  logPhase(2, TOTAL, 'Neutralino Runtime Check');
  const runtimeBin = await findNeutralinoRuntimeBinary();
  const runtimeRequired = process.env.NEUTRALA_RUNTIME_REQUIRED === 'true';
  const noNeu = process.env.NEUTRALA_RUNTIME_NO_NEU === 'true';

  const neuCmd = await detectNeuCommand();
  const useNpx = !neuCmd;

  if (!runtimeBin) {
    if (noNeu) {
      if (runtimeRequired) {
        throw new Error(
          'Neutralino runtime is missing (desktop/bin) and NEUTRALA_RUNTIME_NO_NEU=true prevents auto-fetch.',
        );
      }
      bannerLine('⚠ Neutralino runtime missing; skipping neu update due to NEUTRALA_RUNTIME_NO_NEU=true');
    } else {
      const npxOk = await commandWorks(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--version']);
      if (!neuCmd && !npxOk) {
        if (runtimeRequired) throw new Error('neu (or npx) is required to fetch the Neutralino runtime.');
        bannerLine('⚠ neu not found; skipping runtime update (warn only)');
      } else {
        bannerLine('Downloading Neutralino runtime via `neu update`...');
        if (useNpx) {
          const npx = await detectNpxCommand();
          if (!npx) throw new Error('npx is required for fallback neu execution but was not found.');
          await runInherit(npx, ['--yes', '@neutralinojs/neu', 'update'], { cwd: DESKTOP_ROOT });
        } else {
          await runInherit(neuCmd, ['update'], { cwd: DESKTOP_ROOT });
        }
      }
    }
  }

  const runtimeBinAfter = await findNeutralinoRuntimeBinary();
  if (!runtimeBinAfter && runtimeRequired) {
    throw new Error(
      'Neutralino runtime is still missing after update. Ensure network access or provide an offline runtime.',
    );
  }
  bannerLine('✔ Runtime OK');

  logPhase(3, TOTAL, 'Sync neutralino.js');
  const neutralinoJsPath = path.join(FRONTEND_ROOT, 'public', 'neutralino.js');
  try {
    await runInherit(process.execPath, [path.join(DESKTOP_ROOT, 'scripts', 'sync-neutralino-js.mjs')], {
      cwd: REPO_ROOT,
    });
  } catch (e) {
    if (await exists(neutralinoJsPath)) {
      bannerLine(`⚠ neutralino.js sync failed; using existing ${neutralinoJsPath}`);
    } else {
      throw e;
    }
  }

  logPhase(4, TOTAL, 'Session Reuse');
  await fs.mkdir(RUNTIME_DIR, { recursive: true });
  let backendProc = null;
  let backendSpawned = false;

  const existingBackend = await resolveHealthyBackend();
  if (existingBackend) {
    bannerLine(`✔ Backend Ready (reused ${existingBackend.baseUrl})`);
  } else {
    bannerLine('No healthy backend detected; starting a new instance...');
    logPhase(5, TOTAL, 'Start Backend');
    const backendMode = (process.env.NEUTRALA_BACKEND_MODE || 'start').toLowerCase();
    if (backendMode === 'dev' && (await exists(path.join(BACKEND_ROOT, 'nodemon.json')))) {
      backendProc = spawnTracked(npmBin(), ['run', 'dev'], { cwd: BACKEND_ROOT });
    } else {
      backendProc = spawnTracked(process.execPath, [path.join(BACKEND_ROOT, 'src', 'server.js')], {
        cwd: BACKEND_ROOT,
      });
    }
    backendSpawned = true;

    const healthy = await waitForBackendHealth(25000);
    if (!healthy) throw new Error('Backend failed to become healthy (timeout waiting for /api/health).');
    bannerLine(`✔ Backend Ready (${healthy.baseUrl})`);
  }

  if (existingBackend) logPhase(5, TOTAL, 'Start Backend');
  logPhase(6, TOTAL, 'Start Frontend Dev Server');
  let frontendProc = null;
  let frontendSpawned = false;
  if (!(await exists(path.join(FRONTEND_ROOT, 'package.json')))) {
    throw new Error(`Missing frontend/package.json at ${FRONTEND_ROOT}`);
  }

  const viteAlreadyUp = await isViteUp();
  if (viteAlreadyUp) {
    bannerLine('✔ Frontend Ready (reused http://127.0.0.1:5173)');
  } else {
    frontendProc = spawnTracked(npmBin(), ['run', 'dev'], { cwd: FRONTEND_ROOT });
    frontendSpawned = true;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30000) {
      if (await isViteUp()) break;
      await sleep(250);
    }
    if (!(await isViteUp())) throw new Error('Frontend dev server did not start on http://127.0.0.1:5173');
    bannerLine('✔ Frontend Ready (http://127.0.0.1:5173)');
  }

  logPhase(7, TOTAL, 'Launch Desktop Shell');
  bannerLine('✔ Desktop Launching');

  const toolchain = {
    npm: (await runCapture(npmBin(), ['--version'])).output || null,
    pkg: pkgOk ? (await runCapture(pkgBin, ['--version'])).output || null : null,
    neu: neuCmd ? (await runCapture(neuCmd, ['--version'])).output || null : null,
    bundledClang: toolchainStatus?.details?.compiler || null,
  };
  const backendHealth = await resolveHealthyBackend();
  await writeDiagnostics({ backendHealth, toolchain, webview2 });

  const neuArgs = ['run'];
  const npx = await detectNpxCommand();
  if (useNpx && !npx) throw new Error('npx is required for fallback neu execution but was not found.');
  const neuRunProc = useNpx
    ? spawnTracked(npx, ['--yes', '@neutralinojs/neu', ...neuArgs], { cwd: DESKTOP_ROOT })
    : spawnTracked(neuCmd, neuArgs, { cwd: DESKTOP_ROOT });

  logPhase(8, TOTAL, 'Multi-window Support');
  bannerLine('✔ Multi-window API ready: window.neutrala.openWindow(url), window.neutrala.openNewWindow()');

  const stopAll = async () => {
    const procs = [
      { child: neuRunProc, name: 'desktop', kill: true },
      { child: frontendProc, name: 'frontend', kill: frontendSpawned },
      { child: backendProc, name: 'backend', kill: backendSpawned },
    ].filter((p) => p.child && p.kill);

    for (const p of procs) {
      try {
        p.child.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
  };

  process.once('SIGINT', async () => {
    await stopAll();
    process.exit(130);
  });
  process.once('SIGTERM', async () => {
    await stopAll();
    process.exit(143);
  });

  const exitCode = await new Promise((resolve) => {
    neuRunProc.on('close', (code) => resolve(code ?? 0));
    neuRunProc.on('error', () => resolve(1));
  });
  await stopAll();
  process.exit(exitCode);
}



async function main() {
  // Setup global process supervisor for graceful shutdown
  setupSupervisor();

  const TOTAL = 8; // phases are numbered 0..8
  bannerLine('🚀 Starting NeutralaJS Desktop');

  const phases = [];
  const errors = [];
  let envDoctor = null;
  let toolchainStatus = null;
  let webview2 = null;
  let neuCmd = null;
  let useNpx = false;
  let pkgOk = false;
  let pkgBin = null;
  let existingBackend = null;

  let backendProc = null;
  let frontendProc = null;
  let desktopProc = null;
  let backendSpawned = false;
  let frontendSpawned = false;

  const runtimeRequired = process.env.NEUTRALA_RUNTIME_REQUIRED === 'true';
  const noNeu = process.env.NEUTRALA_RUNTIME_NO_NEU === 'true';

  const flushDiagnostics = async (toolchain = null) => {
    await writeDiagnostics({
      backendHealth: await resolveHealthyBackend(),
      toolchain,
      webview2,
      phases,
      envDoctor,
      errors,
    });
  };

  const stopAll = async () => {
    const procs = [
      { child: desktopProc, kill: true },
      { child: frontendProc, kill: frontendSpawned },
      { child: backendProc, kill: backendSpawned },
    ].filter((p) => p.child && p.kill);

    for (const p of procs) {
      try {
        p.child.kill();
      } catch {
        // ignore
      }
    }

    if (backendSpawned && backendProc?.pid) {
      // Best-effort lock cleanup if we started the backend and it died.
      try {
        const portInfo = await readJson(path.join(RUNTIME_DIR, 'port.json'));
        const lockInfo = await readJson(path.join(RUNTIME_DIR, 'port.lock'));
        const pid = backendProc.pid;
        if (Number(portInfo?.pid) === pid) await fs.rm(path.join(RUNTIME_DIR, 'port.json'), { force: true });
        if (Number(lockInfo?.pid) === pid) await fs.rm(path.join(RUNTIME_DIR, 'port.lock'), { force: true });
      } catch {
        // ignore
      }
    }
  };

  const trackChild = (child, name) => {
    if (!child) return;
    child.on('error', (err) => {
      const msg = err?.message || String(err);
      errors.push({ phase: 'spawn', name, message: msg, stack: err?.stack || null });
      bannerLine(`✖ ${name} spawn error: ${msg}`);
    });
  };

  const phase = async (i, name, fn, { fatal = true } = {}) => {
    logPhase(i, TOTAL, name);
    const startedAt = Date.now();
    try {
      const result = await fn();
      phases.push({ i, name, ok: true, durationMs: Date.now() - startedAt });
      await flushDiagnostics();
      return result;
    } catch (e) {
      const msg = e?.message || String(e);
      phases.push({ i, name, ok: false, durationMs: Date.now() - startedAt, error: msg });
      errors.push({ phase: i, name, message: msg, stack: e?.stack || null });
      bannerLine(`✖ ${name} failed: ${msg}`);
      await flushDiagnostics();
      if (fatal) throw e;
      return null;
    }
  };

  process.once('SIGINT', async () => {
    await stopAll();
    process.exit(130);
  });
  process.once('SIGTERM', async () => {
    await stopAll();
    process.exit(143);
  });

  try {
    await phase(0, 'Environment Doctor', async () => {
      const nodeMajor = parseNodeMajor(process.versions.node);
      if (!nodeMajor || nodeMajor < 18) {
        throw new Error(`Node.js ${process.versions.node} is unsupported. Require >= 18.`);
      }
      bannerLine(`✔ Node ${process.versions.node} detected`);

      if (DEBUG) {
        bannerLine(`[debug] cwd: ${process.cwd()}`);
        bannerLine('[debug] PATH:');
        bannerLine(pathEnv() || '(empty)');
      }

      envDoctor = {
        path: pathEnv(),
        tools: {},
        runtimeDir: { path: RUNTIME_DIR, writable: false, error: null },
      };

      const writable = await ensureWritableDirectory(RUNTIME_DIR);
      envDoctor.runtimeDir.writable = writable.ok;
      envDoctor.runtimeDir.error = writable.error;
      if (!writable.ok) bannerLine(`⚠ Runtime dir not writable: ${RUNTIME_DIR} (${writable.error})`);
      else bannerLine(`✔ Runtime dir writable: ${RUNTIME_DIR}`);

      const checks = ['node', 'npm', 'neu', 'clang'];
      for (const t of checks) {
        const loc = await locateCommand(t);
        envDoctor.tools[t] = { found: loc.found, paths: loc.paths, via: loc.via };

        if (loc.found) {
          bannerLine(`✔ ${t} found`);
          continue;
        }

        if (REQUIRED_TOOLS.includes(t)) {
          throw new Error(`Required tool missing: ${t}`);
        }
        printToolMissing(t);
      }
    });

    await phase(1, 'Toolchain Validation', async () => {
      pkgBin = getLocalBinPath(BACKEND_ROOT, 'pkg');
      pkgOk = await exists(pkgBin);
      if (!pkgOk) bannerLine(`⚠ pkg not found at ${pkgBin} (builds may fail; run \`npm install\` in backend/)`);

      toolchainStatus = await toolchainService.verify();
      if (!toolchainStatus?.compiler) {
        bannerLine('⚠ Bundled Clang toolchain missing/invalid (resources/toolchain) (warn only).');
      } else {
        bannerLine('✔ Bundled toolchain present');
      }

      webview2 = await detectWebView2();
      if (!webview2.ok && process.platform === 'win32') {
        bannerLine('⚠ WebView2 Runtime not detected (warn only).');
      }

      bannerLine('✔ Toolchain validation complete');
    });

    await phase(2, 'Runtime Validation', async () => {
      const runtimeBin = await findNeutralinoRuntimeBinary();

      neuCmd = await detectNeuCommand();
      useNpx = !neuCmd;

      if (!runtimeBin) {
        if (noNeu) {
          if (runtimeRequired) {
            throw new Error(
              'Neutralino runtime is missing (desktop/bin) and NEUTRALA_RUNTIME_NO_NEU=true prevents auto-fetch.',
            );
          }
          bannerLine('⚠ Neutralino runtime missing; skipping neu update due to NEUTRALA_RUNTIME_NO_NEU=true');
        } else {
          const npx = await detectNpxCommand();
          if (!neuCmd && !npx) {
            if (runtimeRequired) throw new Error('neu (or npx) is required to fetch the Neutralino runtime.');
            bannerLine('⚠ neu not found; skipping runtime update (warn only)');
          } else {
            bannerLine('Downloading Neutralino runtime via `neu update`...');
            const updateRes = useNpx
              ? await safeSpawn(npx, ['--yes', '@neutralinojs/neu', 'update'], {
                cwd: DESKTOP_ROOT,
                passthrough: true,
                timeoutMs: 10 * 60 * 1000,
              })
              : await safeSpawn(neuCmd, ['update'], {
                cwd: DESKTOP_ROOT,
                passthrough: true,
                timeoutMs: 10 * 60 * 1000,
              });

            if (!updateRes.success && runtimeRequired) {
              throw new Error(`neu update failed (code=${updateRes.code ?? 'null'}): ${updateRes.stderr || 'unknown'}`);
            }
            if (!updateRes.success) bannerLine(`⚠ neu update failed (warn only): ${updateRes.stderr || 'unknown'}`);
          }
        }
      }

      const runtimeBinAfter = await findNeutralinoRuntimeBinary();
      if (!runtimeBinAfter && runtimeRequired) {
        throw new Error('Neutralino runtime missing after update. Ensure network access or provide offline runtime.');
      }
      if (runtimeBinAfter) bannerLine('✔ Neutralino runtime ready');
      else bannerLine('⚠ Neutralino runtime not found (warn only)');
    });

    await phase(3, 'Sync Assets', async () => {
      const neutralinoJsPath = path.join(FRONTEND_ROOT, 'public', 'neutralino.js');

      // 1. Sync neutralino.js
      const res1 = await safeSpawn(process.execPath, [path.join(DESKTOP_ROOT, 'scripts', 'sync-neutralino-js.mjs')], {
        cwd: REPO_ROOT,
        passthrough: DEBUG,
        timeoutMs: 60 * 1000,
        shell: false,
      });

      if (!res1.success) {
        if (!await exists(neutralinoJsPath)) {
          throw new Error(res1.stderr || 'neutralino.js sync failed');
        }
        bannerLine(`⚠ neutralino.js sync failed; using existing ${neutralinoJsPath}`);
      }

      // 2. Sync built assets and icons
      bannerLine('Building frontend and syncing assets to desktop/resources...');
      const res2 = await safeSpawn(process.execPath, [path.join(DESKTOP_ROOT, 'scripts', 'sync-assets.mjs')], {
        cwd: REPO_ROOT,
        passthrough: true, // Show frontend build progress
        timeoutMs: 300 * 1000,
        shell: false,
      });

      if (!res2.success) {
        throw new Error(res2.stderr || 'Asset synchronization failed');
      }

      bannerLine('✔ Assets and icons synchronized');
    });

    existingBackend = await phase(4, 'Backend Reuse Check', async () => {
      await fs.mkdir(RUNTIME_DIR, { recursive: true });
      const healthy = await resolveHealthyBackend();
      if (healthy) {
        bannerLine(`✔ Existing backend reused (${healthy.baseUrl})`);
        return healthy;
      }
      bannerLine('No healthy backend detected; starting a new instance...');
      return null;
    });

    await phase(5, 'Start Backend', async () => {
      if (existingBackend) {
        bannerLine('✔ Backend already running');
        return;
      }

      const backendMode = (process.env.NEUTRALA_BACKEND_MODE || 'start').toLowerCase();
      if (backendMode === 'dev' && (await exists(path.join(BACKEND_ROOT, 'nodemon.json')))) {
        backendProc = spawnTracked('npm', ['run', 'dev'], { cwd: BACKEND_ROOT });
      } else {
        backendProc = spawnTracked(process.execPath, [path.join(BACKEND_ROOT, 'src', 'server.js')], {
          cwd: BACKEND_ROOT,
          shell: false,
        });
      }

      backendSpawned = !!backendProc;
      trackChild(backendProc, 'backend');

      const healthy = await waitForBackendHealth(25000);
      if (!healthy) throw new Error('Backend failed to become healthy (timeout waiting for /api/health).');
      bannerLine(`✔ Backend Ready (${healthy.baseUrl})`);
    });

    await phase(6, 'Frontend Dev Server', async () => {
      const devUrl = process.env.NEUTRALA_DEV_URL || 'http://localhost:5173';

      if (!(await exists(path.join(FRONTEND_ROOT, 'package.json')))) {
        throw new Error(`Missing frontend/package.json at ${FRONTEND_ROOT}`);
      }

      const viteAlreadyUp = await isViteUp(devUrl);
      if (viteAlreadyUp) {
        bannerLine(`✔ Frontend Ready (reused ${devUrl})`);
        return;
      }

      const npmLoc = await locateCommand('npm');
      if (npmLoc.found) {
        frontendProc = spawnTracked('npm', ['run', 'dev'], { cwd: FRONTEND_ROOT });
      } else {
        const viteEntrypoint = path.join(FRONTEND_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
        if (!(await exists(viteEntrypoint))) {
          throw new Error('Cannot start frontend: npm is missing and vite is not installed in frontend/node_modules.');
        }
        frontendProc = spawnTracked(process.execPath, [viteEntrypoint], { cwd: FRONTEND_ROOT, shell: false });
      }

      frontendSpawned = !!frontendProc;
      trackChild(frontendProc, 'frontend');

      const startedAt = Date.now();
      while (Date.now() - startedAt < 30000) {
        if (await isViteUp(devUrl)) break;
        await sleep(250);
      }
      if (!(await isViteUp(devUrl))) throw new Error(`Frontend dev server did not start on ${devUrl}`);
      bannerLine(`✔ Frontend Ready (${devUrl})`);
    });

    await phase(7, 'Desktop Shell', async () => {
      const npx = await detectNpxCommand();
      const runtimeBin = await findNeutralinoRuntimeBinary();

      bannerLine('✔ Desktop Launching');

      const devUrl = process.env.NEUTRALA_DEV_URL || 'http://localhost:5173';
      let urlArgs = [];

      if (isDevMode()) {
        const viteUp = await isViteUp(devUrl);
        if (viteUp) {
          bannerLine(`✔ Development mode: Overriding URL to ${devUrl}`);
          urlArgs = [`--url=${devUrl}`];
        } else {
          bannerLine(`⚠ Dev server (${devUrl}) unreachable; falling back to packaged /index.html`);
        }
      }

      if (!neuCmd && !npx) {
        if (!runtimeBin) {
          throw new Error('neu is required to launch the desktop shell. Install with: npm install -g @neutralinojs/neu');
        }
        bannerLine('⚠ neu not found; launching Neutralino runtime directly (best-effort)');
        desktopProc = spawnTracked(runtimeBin, urlArgs, { cwd: DESKTOP_ROOT, shell: false });
      } else {
        const runArgs = ['run'];
        if (urlArgs.length > 0) runArgs.push('--', ...urlArgs);

        desktopProc = useNpx
          ? spawnTracked(npx, ['--yes', '@neutralinojs/neu', ...runArgs], { cwd: DESKTOP_ROOT })
          : spawnTracked(neuCmd, runArgs, { cwd: DESKTOP_ROOT });
      }

      trackChild(desktopProc, 'desktop');

      const toolchain = {
        npm: (await safeSpawn('npm', ['--version'], { timeoutMs: 3000 })).stdout || null,
        pkg: pkgOk ? (await safeSpawn(pkgBin, ['--version'], { timeoutMs: 5000 })).stdout || null : null,
        neu: neuCmd ? (await safeSpawn(neuCmd, ['--version'], { timeoutMs: 3000 })).stdout || null : null,
        bundledClang: toolchainStatus?.details?.compiler || null,
      };
      await flushDiagnostics(toolchain);
    });

    await phase(
      8,
      'Multi-window Support',
      async () => {
        bannerLine('✔ Multi-window API ready: window.neutrala.openWindow(url), window.neutrala.openNewWindow()');
      },
      { fatal: false },
    );

    const exitCode = await new Promise((resolve) => {
      if (!desktopProc) return resolve(1);
      desktopProc.on('close', (code) => resolve(code ?? 0));
      desktopProc.on('error', () => resolve(1));
    });

    await stopAll();
    process.exit(exitCode);
  } catch (e) {
    await stopAll();
    await flushDiagnostics();
    throw e;
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.stack || err?.message || String(err));
  process.exitCode = 1;
});
