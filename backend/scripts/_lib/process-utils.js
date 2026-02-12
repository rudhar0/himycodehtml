import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const DEBUG = process.env.NEUTRALA_DEBUG === 'true';
const isWindows = () => process.platform === 'win32';

/**
 * Normalize arguments for spawn()
 */
export function normalizeArgs(args) {
  if (!args) return [];
  if (Array.isArray(args)) return args.map((x) => String(x));
  return [String(args)];
}

/**
 * Determine if a command should use shell mode
 * Windows cmd/bat/powershell scripts need shell: true
 */
export function shouldUseShell(command) {
  if (!isWindows()) return false;
  const base = path.basename(String(command || '')).toLowerCase();
  const ext = path.extname(base);
  if (ext === '.cmd' || ext === '.bat' || ext === '.ps1') return true;
  if (!ext) return true; // Allow PATHEXT and node/npm shims
  return false;
}

/**
 * Format a command + args for debug output
 */
export function formatSpawnDebug(command, args) {
  const a = normalizeArgs(args);
  const joined = [command, ...a]
    .map((s) => (String(s).includes(' ') ? JSON.stringify(String(s)) : String(s)))
    .join(' ');
  return joined.trim();
}

/**
 * Normalize Windows paths to forward slashes (optional utility)
 */
export function normalizePath(p) {
  if (!p) return p;
  return String(p).replace(/\\/g, '/');
}

/**
 * Locate a command in the system PATH
 * Returns { found, paths, via } where via is 'where' (win32) or 'which' (unix)
 */
export async function locateCommand(tool) {
  const name = String(tool || '').trim();
  if (!name) return { found: false, paths: [], via: null };

  const hasSep = name.includes('/') || name.includes('\\');
  if (hasSep || path.isAbsolute(name)) {
    // Absolute path check
    try {
      const stat = await import('node:fs/promises').then((m) => m.access(name));
      return { found: true, paths: [name], via: 'fs' };
    } catch {
      return { found: false, paths: [], via: 'fs' };
    }
  }

  const via = isWindows() ? 'where' : 'which';
  const candidates = isWindows() ? [name, `${name}.cmd`, `${name}.exe`, `${name}.bat`] : [name];

  for (const c of candidates) {
    try {
      const result = await safeSpawn(via, [c], { timeoutMs: 2500 });
      const out = (result.stdout || '').trim();
      if (result.success && out) {
        const paths = out
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (paths.length) return { found: true, paths, via };
      }
    } catch {
      // Continue to next candidate
    }
  }

  return { found: false, paths: [], via };
}

/**
 * Safe spawn wrapper - never throws, always returns structured result
 * Handles EINVAL, ENOENT, and other spawn errors gracefully
 * @param {string} command - Command to spawn
 * @param {string[]|string} args - Arguments
 * @param {object} options - { cwd, env, timeoutMs, passthrough, shell }
 * @returns {Promise<{success: boolean, stdout: string, stderr: string, code: number|null, pid?: number}>}
 */
export async function safeSpawn(command, args = [], options = {}) {
  const cmd = String(command || '').trim();
  if (!cmd) {
    return { success: false, stdout: '', stderr: 'Empty command', code: null };
  }

  const argv = normalizeArgs(args);
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : null;
  const passthrough = options.passthrough === true;
  const cwd = options.cwd;
  const env = options.env;
  const shell = options.shell ?? shouldUseShell(cmd);

  if (DEBUG) {
    console.log(`[debug] safeSpawn: ${formatSpawnDebug(cmd, argv)} (shell=${shell}, cwd=${cwd || process.cwd()})`);
  }

  try {
    return await new Promise((resolve) => {
      let child;
      try {
        child = spawn(cmd, argv, {
          cwd,
          env: env || process.env,
          shell,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (spawnErr) {
        // spawn() itself threw (rare but handle it)
        return resolve({
          success: false,
          stdout: '',
          stderr: `spawn() error: ${spawnErr?.message || String(spawnErr)}`,
          code: null,
          pid: null,
        });
      }

      let stdout = '';
      let stderr = '';
      let resolved = false;
      let timeout = null;
      const pid = child?.pid || null;

      const finish = (payload) => {
        if (resolved) return;
        resolved = true;
        if (timeout) clearTimeout(timeout);
        if (child && !child.killed) {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
        }
        resolve(payload);
      };

      if (timeoutMs && timeoutMs > 0) {
        timeout = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
          finish({
            success: false,
            stdout,
            stderr: `${stderr}\nTimeout after ${timeoutMs}ms`.trim(),
            code: null,
            pid,
          });
        }, timeoutMs);
      }

      child.stdout?.on('data', (d) => {
        const s = d.toString();
        stdout += s;
        if (passthrough) process.stdout.write(s);
      });

      child.stderr?.on('data', (d) => {
        const s = d.toString();
        stderr += s;
        if (passthrough) process.stderr.write(s);
      });

      // Catch spawn errors (EINVAL, ENOENT, etc.)
      child.on('error', (err) => {
        const msg = err?.message || String(err);
        finish({
          success: false,
          stdout,
          stderr: `${stderr}\nprocess error: ${msg}`.trim(),
          code: null,
          pid,
        });
      });

      child.on('close', (code) => {
        finish({
          success: code === 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          code: typeof code === 'number' ? code : null,
          pid,
        });
      });
    });
  } catch (err) {
    // Outer catch for any unexpected errors
    return {
      success: false,
      stdout: '',
      stderr: `Unexpected error: ${err?.message || String(err)}`,
      code: null,
    };
  }
}

/**
 * Run a command and capture its output - convenience wrapper for safeSpawn
 */
export async function runCaptureSafe(command, args = [], options = {}) {
  return safeSpawn(command, args, options);
}

/**
 * Check if a command exists in PATH
 */
export async function commandExists(command, args = [], options = {}) {
  const result = await safeSpawn(command, args, { ...options, timeoutMs: options.timeoutMs ?? 5000 });
  return result.success;
}

/**
 * Get version string from a command
 */
export async function getCommandVersion(command, versionArgs = ['--version']) {
  const result = await safeSpawn(command, versionArgs, { timeoutMs: 5000 });
  if (result.success && result.stdout) {
    return result.stdout.split('\n')[0]?.trim() || null;
  }
  return null;
}

/**
 * Spawn a process that inherits stdio (for interactive commands like npm start)
 * This version doesn't wait for completion, returns the child process
 */
export function spawnInteractive(command, args = [], options = {}) {
  const cmd = String(command || '').trim();
  const argv = normalizeArgs(args);

  if (!cmd) {
    if (process.env.NEUTRALA_DEBUG) {
      console.log('⚠ Attempted to spawnInteractive with empty command');
    }
    return null;
  }

  const shell = options.shell ?? shouldUseShell(cmd);

  if (DEBUG) {
    console.log(`[debug] spawnInteractive: ${formatSpawnDebug(cmd, argv)} (shell=${shell})`);
  }

  try {
    const child = spawn(cmd, argv, {
      stdio: 'inherit',
      windowsHide: true,
      shell,
      ...options,
    });

    // Prevent unhandled error events from crashing the launcher
    child.on('error', (err) => {
      if (process.env.NEUTRALA_DEBUG) {
        console.log(`[debug] spawnInteractive error: ${err?.message || String(err)}`);
      }
    });

    return child;
  } catch (err) {
    if (process.env.NEUTRALA_DEBUG) {
      console.log(`[debug] spawnInteractive spawn() failed: ${err?.message || String(err)}`);
    }
    return null;
  }
}

/**
 * Resolve the path to a local npm bin script
 */
export function getLocalBinPath(backendRoot, name) {
  const ext = isWindows() ? '.cmd' : '';
  return path.join(backendRoot, 'node_modules', '.bin', `${name}${ext}`);
}

/**
 * Get the npm/npx command for the platform
 */
export function getNpmCommand() {
  return isWindows() ? 'npm.cmd' : 'npm';
}

export function getNpxCommand() {
  return isWindows() ? 'npx.cmd' : 'npx';
}
