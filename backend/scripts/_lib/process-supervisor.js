import fs from 'node:fs/promises';
import path from 'node:path';

const DEBUG = process.env.NEUTRALA_DEBUG === 'true';

/**
 * Global Process Supervisor
 * Tracks all spawned child processes and ensures graceful shutdown
 */
class ProcessSupervisor {
  constructor() {
    this.processes = []; // Array of { child, name, order, ownedLocks: [] }
    this.shutdownInProgress = false;
    this.isSetup = false;
  }

  /**
   * Setup global signal handlers
   */
  setup() {
    if (this.isSetup) return;
    this.isSetup = true;

    const handleSignal = async (signal) => {
      if (DEBUG) {
        console.log(`[debug] Supervisor: received ${signal}`);
      }
      await this.gracefulShutdown();
      process.exit(signal === 'SIGINT' ? 130 : 143);
    };

    process.on('SIGINT', () => handleSignal('SIGINT'));
    process.on('SIGTERM', () => handleSignal('SIGTERM'));

    // Catch uncaught exceptions
    process.on('uncaughtException', (err) => {
      console.error('Uncaught exception:', err);
      this.gracefulShutdown().finally(() => process.exit(1));
    });

    // Also catch unhandled rejections
    process.on('unhandledRejection', (reason) => {
      console.error('Unhandled rejection:', reason);
      this.gracefulShutdown().finally(() => process.exit(1));
    });
  }

  /**
   * Register a spawned child process for tracking
   * @param {ChildProcess} child - Node.js child process
   * @param {string} name - Friendly name for logging
   * @param {number} order - Shutdown order (lower = shut down first)
   * @param {string[]} ownedLocks - Lock file paths owned by this process
   */
  registerProcess(child, name, order = 10, ownedLocks = []) {
    if (!child) return;

    this.processes.push({
      child,
      name: String(name || 'unknown'),
      order: Number(order) || 10,
      ownedLocks: Array.isArray(ownedLocks) ? ownedLocks : [],
    });

    if (DEBUG) {
      console.log(`[debug] Supervisor: registered process "${name}" (order=${order}, pid=${child.pid})`);
    }
  }

  /**
   * Unregister a process
   */
  unregisterProcess(child) {
    if (!child) return;
    this.processes = this.processes.filter((p) => p.child !== child);
  }

  /**
   * Get all registered processes
   */
  getProcesses() {
    return this.processes.slice();
  }

  /**
   * Graceful shutdown: kill processes in reverse order of registration
   */
  async gracefulShutdown() {
    if (this.shutdownInProgress) return;
    this.shutdownInProgress = true;

    if (DEBUG) {
      console.log(`[debug] Supervisor: starting graceful shutdown (${this.processes.length} processes)`);
    }

    // Sort by order (ascending) so we kill in the right sequence
    const sorted = this.processes.sort((a, b) => a.order - b.order);

    for (const proc of sorted) {
      await this.stopProcess(proc);
    }

    // Clean up owned lock files
    for (const proc of sorted) {
      for (const lockFile of proc.ownedLocks) {
        await this.removeLockFile(lockFile);
      }
    }
  }

  /**
   * Stop a single process with SIGTERM, then SIGKILL if needed
   */
  async stopProcess(proc) {
    const { child, name } = proc;

    if (DEBUG) {
      console.log(`[debug] Supervisor: stopping process "${name}" (pid=${child.pid})`);
    }

    // Send SIGTERM first
    try {
      child.kill('SIGTERM');
    } catch (err) {
      if (DEBUG) {
        console.log(`[debug] Supervisor: failed to SIGTERM "${name}": ${err?.message}`);
      }
    }

    // Wait up to 3 seconds for graceful shutdown
    const waitStart = Date.now();
    while (Date.now() - waitStart < 3000) {
      if (child.killed) {
        if (DEBUG) {
          console.log(`[debug] Supervisor: process "${name}" exited gracefully`);
        }
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    // Force kill if still alive
    if (!child.killed) {
      try {
        child.kill('SIGKILL');
        if (DEBUG) {
          console.log(`[debug] Supervisor: force killed process "${name}" with SIGKILL`);
        }
      } catch (err) {
        if (DEBUG) {
          console.log(`[debug] Supervisor: failed to SIGKILL "${name}": ${err?.message}`);
        }
      }
    }
  }

  /**
   * Remove a lock file (only if this process owns it)
   */
  async removeLockFile(filePath) {
    if (!filePath) return;

    try {
      await fs.unlink(filePath);
      if (DEBUG) {
        console.log(`[debug] Supervisor: removed lock file ${filePath}`);
      }
    } catch (err) {
      // Lock file might be in use by another launcher instance
      if (DEBUG) {
        console.log(`[debug] Supervisor: could not remove lock ${filePath}: ${err?.message}`);
      }
    }
  }

  /**
   * Wait for a specific process to exit
   */
  waitForProcess(child) {
    return new Promise((resolve) => {
      child.once('close', (code) => resolve(code ?? 0));
      child.once('error', () => resolve(1));
    });
  }

  /**
   * Kill all processes immediately (don't wait for graceful shutdown)
   */
  async killAll() {
    for (const proc of this.processes) {
      try {
        proc.child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
  }
}

// Singleton instance
let supervisor = null;

/**
 * Get or create the global supervisor
 */
export function getSupervisor() {
  if (!supervisor) {
    supervisor = new ProcessSupervisor();
  }
  return supervisor;
}

/**
 * Convenience exports for supervisor operations
 */
export function setupSupervisor() {
  getSupervisor().setup();
}

export function registerProcess(child, name, order = 10, ownedLocks = []) {
  getSupervisor().registerProcess(child, name, order, ownedLocks);
}

export function unregisterProcess(child) {
  getSupervisor().unregisterProcess(child);
}

export function getRegisteredProcesses() {
  return getSupervisor().getProcesses();
}

export async function gracefulShutdown() {
  return getSupervisor().gracefulShutdown();
}

export async function killAll() {
  return getSupervisor().killAll();
}

export function waitForProcess(child) {
  return getSupervisor().waitForProcess(child);
}
