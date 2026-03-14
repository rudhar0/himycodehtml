/**
 * Runtime Lifecycle Module
 * Manages the high-level start/stop cycles and prevents orphan processes.
 */

/* global Neutralino */

import { spawnBackend, stopBackend, isBackendAlive } from './backendSpawner';
import { resolveAllPaths } from './pathResolver';
import { waitForBackendReady } from './portWaitManager';

const LOG_PREFIX = '[bootstrap:lifecycle]';

/**
 * Initializes the full runtime lifecycle.
 * Sets up exit handlers to ensure backend is killed.
 */
export async function initRuntimeLifecycle(): Promise<string> {
  console.log(LOG_PREFIX, 'Initializing runtime lifecycle...');
  
  // 1. Setup exit handlers immediately
  setupExitHandlers();

  // 2. Resolve paths
  const paths = await resolveAllPaths();

  // 3. Proactive cleanup: Check if a backend is already running and kill it (or reuse if healthy)
  try {
    const N = (globalThis as any).Neutralino;
    if (N) {
      const portJsonPath = paths.runtimeDir + '/port.json';
      const portDataRaw = await N.filesystem.readFile(portJsonPath).catch(() => null);
      
      if (portDataRaw) {
        const portData = JSON.parse(portDataRaw);
        const oldPid = portData.pid;
        const oldPort = portData.port;
        
        if (oldPid && oldPid > 0 && oldPort > 0) {
          const baseUrl = `http://127.0.0.1:${oldPort}`;
          console.log(LOG_PREFIX, 'Found existing backend info. Checking health at:', baseUrl);
          
          // Verify if it's already healthy
          const isHealthy = await fetch(`${baseUrl}/api/health`)
            .then(res => res.ok)
            .catch(() => false);

          if (isHealthy) {
            console.log(LOG_PREFIX, 'Existing backend is already healthy. Reusing it.', baseUrl);
            return baseUrl;
          }

          console.log(LOG_PREFIX, 'Existing backend PID:', oldPid, 'is not healthy or unreachable. Cleaning up...');
          
          const isWindows = (globalThis as any).NL_OS === 'Windows';
          const killCmd = isWindows 
            ? `taskkill /F /T /PID ${oldPid}`
            : `kill -9 ${oldPid}`;
          
          try {
            await N.os.execCommand(killCmd);
            console.log(LOG_PREFIX, 'Existing backend killed.');
          } catch (e) {
            console.warn(LOG_PREFIX, 'Failed to kill existing backend (might already be dead):', e);
          }
        }
      }
      
      // Always try to remove the stale port file if we are about to start a new one
      await N.filesystem.remove(portJsonPath).catch(() => null);
    }
  } catch (error) {
    console.warn(LOG_PREFIX, 'Proactive cleanup failed (non-critical):', error);
  }

  // 4. Spawn backend
  await spawnBackend({
    executablePath: paths.executablePath,
    cwd: paths.backendDir,
    env: {
      NODE_ENV: 'production',
      PORT_RANGE: '3000-3999',
      NEUTRALA_FORCE_LOCAL_RUNTIME: 'true'
    }
  });

  // 5. Wait for readiness
  try {
    const baseUrl = await waitForBackendReady({
      portJsonPath: paths.runtimeDir + '/port.json',
      timeoutMs: 25000
    });
    
    return baseUrl;
  } catch (error) {
    console.error(LOG_PREFIX, 'Lifecycle initialization failed during port wait:', error);
    await stopBackend();
    throw error;
  }
}

/**
 * Sets up Neutralino event listeners for clean shutdown.
 */
function setupExitHandlers() {
  const N = (globalThis as any).Neutralino;
  if (!N || !N.events) {
    console.warn(LOG_PREFIX, 'Neutralino events API not available, skipping exit handlers.');
    return;
  }

  // Listen for window close (user clicks X)
  N.events.on('windowClose', async () => {
    console.log(LOG_PREFIX, '📣 [windowClose] Window closing, cleaning up...');
    await shutdownApp();
  });

  // Neutralino global exit / client disconnection
  N.events.on('appClientDisconnected', async () => {
    console.log(LOG_PREFIX, '📣 [appClientDisconnected] Client disconnected, cleaning up...');
    await stopBackend();
  });
}

/**
 * Emergency cleanup for stale locks or zombified state.
 */
export async function emergencyCleanup() {
  console.log(LOG_PREFIX, 'Running emergency cleanup...');
  await stopBackend();
}

/**
 * Robust shutdown sequence ensuring backend termination.
 */
async function shutdownApp() {
  try {
    await stopBackend();

    // verify backend stopped
    const timeout = Date.now() + 3000;
    while (Date.now() < timeout) {
      const running = isBackendAlive();
      if (!running) break;
      await new Promise(r => setTimeout(r, 200));
    }

  } catch (e) {
    console.warn(LOG_PREFIX, "Backend shutdown error", e);
  }

  const N = (globalThis as any).Neutralino;
  await N.app.exit();
}
