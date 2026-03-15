import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import { detectRuntime } from './runtime-manager.js';

function parseMajor(version) {
  const major = Number(String(version).split('.')[0]);
  return Number.isFinite(major) ? major : null;
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}. Must be an integer 1-65535.`);
  }
  return port;
}

export async function validateStartupEnvironment({ backendRoot, runtimeDir }) {
  const warnings = [];

  const nodeMajor = parseMajor(process.versions.node);
  if (!nodeMajor || nodeMajor < 18) {
    throw new Error(
      `Unsupported Node.js version ${process.versions.node}. Require >= 18.0.0.`,
    );
  }

  if (!path.isAbsolute(backendRoot)) {
    warnings.push(`Backend root is not absolute: ${backendRoot}`);
  }

  // Node runtime integrity (works for both `node` and `pkg` builds).
  try {
    await fs.access(process.execPath);
    if (process.platform !== 'win32') {
      await fs.access(process.execPath, fssync.constants.X_OK);
    }
  } catch (err) {
    throw new Error(
      `Node runtime executable is not accessible/executable: ${process.execPath}. ${err?.message || err}`,
    );
  }

  // If a staged node runtime exists beside the app, warn when not running under it (unless `pkg`).
  try {
    const stagedNode = path.join(
      backendRoot,
      'node-runtime',
      process.platform === 'win32' ? 'node.exe' : 'node',
    );
    const stagedExists = await (async () => {
      try {
        await fs.access(stagedNode);
        return true;
      } catch {
        return false;
      }
    })();

    if (!process.pkg && stagedExists && !process.execPath.includes('node-runtime')) {
      warnings.push(
        `Staged Node runtime detected at ${stagedNode}, but current execPath is ${process.execPath}.`,
      );
    }
  } catch {
    // ignore
  }

  try {
    await fs.mkdir(runtimeDir, { recursive: true });
    const probe = path.join(runtimeDir, `.write-test-${process.pid}.tmp`);
    await fs.writeFile(probe, 'ok', 'utf8');
    await fs.unlink(probe);
  } catch (err) {
    throw new Error(
      `Runtime directory is not writable: ${runtimeDir}. ${err?.message || err}`,
    );
  }

  const platform = process.platform;
  const shell =
    platform === 'win32'
      ? process.env.ComSpec || 'cmd.exe'
      : process.env.SHELL || 'unknown';

  if (platform === 'win32' && runtimeDir.includes('/')) {
    warnings.push(
      `Detected POSIX separators on Windows in runtimeDir: ${runtimeDir}`,
    );
  }

  const likelyPathEnvVars = [
    'GDB_PATH',
    'DAP_ADAPTER_PATH',
    'DOCKER_SOCKET_PATH',
    'GCC_INSTALL_DIR',
  ];
  for (const key of likelyPathEnvVars) {
    const value = process.env[key];
    if (!value) continue;

    const looksWindows = /^[a-zA-Z]:\\/.test(value);
    const looksPosix = value.startsWith('/') || value.includes('/');

    if (platform === 'win32' && looksPosix) {
      warnings.push(
        `${key} looks like a POSIX path on Windows: ${value}. Consider using Windows-style paths or leaving it unset.`,
      );
    }
    if (platform !== 'win32' && looksWindows) {
      warnings.push(
        `${key} looks like a Windows path on ${platform}: ${value}. Consider using POSIX-style paths or leaving it unset.`,
      );
    }
  }

  if (platform === 'win32' && os.EOL !== '\r\n') {
    warnings.push(`Unexpected EOL for Windows: ${JSON.stringify(os.EOL)}`);
  }
  if (platform !== 'win32' && os.EOL !== '\n') {
    warnings.push(`Unexpected EOL for ${platform}: ${JSON.stringify(os.EOL)}`);
  }

  // Port availability sanity check (full binding handled by port-manager).
  if (process.env.PORT && String(process.env.PORT).trim() !== '') {
    parsePort(process.env.PORT);
  }
  try {
    const lockPath = path.join(runtimeDir, 'port.lock');
    const raw = await fs.readFile(lockPath, 'utf8');
    const lock = JSON.parse(raw);
    const pid = Number(lock?.pid);
    const last = Number(lock?.lastHeartbeat || 0);
    const ttlMs = Number(process.env.PORT_LOCK_TTL_MS || 15000);
    const alive = Number.isInteger(pid) && pid > 0 ? (() => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    })() : false;

    if (alive && last && Date.now() - last <= ttlMs) {
      warnings.push(
        `Port lock active: pid=${pid} port=${lock?.port}. Another backend instance may already be running.`,
      );
    }
  } catch {
    // ignore
  }

  // Neutrala runtime presence/compatibility (download happens in runtime-manager on demand).
  const runtimeRequired = process.env.NEUTRALA_RUNTIME_REQUIRED === 'true' || !!process.pkg;
  const runtimeAuto = process.env.NEUTRALA_RUNTIME_AUTO === 'true';
  if (runtimeRequired || runtimeAuto) {
    const resourcesDir = path.join(backendRoot, 'resources');
    const runtimeStatus = await detectRuntime({
      resourcesDir,
      supportedRange: process.env.NEUTRALA_RUNTIME_RANGE || undefined,
    });
    if (!runtimeStatus.ok) {
      warnings.push(
        `Neutrala runtime not ready (${runtimeStatus.reason}). It will be downloaded on startup if configured.`,
      );
    }
  }

  warnings.push(
    `Platform: ${platform} (${os.release()}), arch: ${process.arch}, shell: ${shell}`,
  );

  return { warnings };
}
