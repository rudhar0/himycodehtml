/**
 * Runtime Lifecycle Module
 * Manages the high-level start/stop cycles and prevents orphan processes.
 */

/* global Neutralino */

import { spawnBackend, stopBackend } from './backendSpawner';
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

  // 3. Clean stale port files if any (best effort)
  try {
    if ((globalThis as any).Neutralino) {
      const portJson = paths.runtimeDir + '/port.json';
      await (globalThis as any).Neutralino.filesystem.removeFile(portJson);
    }
  } catch {
    // ignore if doesn't exist
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
    try {
      await stopBackend();
    } catch (e) {
      console.error(LOG_PREFIX, 'Cleanup failed on windowClose:', e);
    }
    N.app.exit();
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
