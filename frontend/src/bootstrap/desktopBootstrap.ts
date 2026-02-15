/**
 * Desktop Bootstrap Orchestrator
 * The entry point for the desktop-specific runtime initialization.
 */

/* global globalThis */

import { initRuntimeLifecycle } from './runtimeLifecycle';

const LOG_PREFIX = '[bootstrap:main]';

export interface BootstrapResult {
  ok: boolean;
  apiUrl: string | null;
  error?: string;
}

/**
 * Main bootstrap function called by the UI entry point.
 */
export async function bootstrapDesktop(): Promise<BootstrapResult> {
  console.log(LOG_PREFIX, 'Starting desktop bootstrap...');
  
  try {
    // 1. Initialize lifecycle (resolves paths, spawns backend, waits for port)
    // This now strictly throws on failure (spawn error or port timeout)
    const baseUrl = await initRuntimeLifecycle();
    
    // 2. Inject runtime globals for the application
    (globalThis as any).__NEUTRALA_API_URL = baseUrl;
    (globalThis as any).__NEUTRALA_SOCKET_URL = baseUrl;
    
    console.log(LOG_PREFIX, 'Bootstrap successful. Backend at:', baseUrl);
    
    return {
      ok: true,
      apiUrl: baseUrl
    };
  } catch (error: any) {
    console.error(LOG_PREFIX, 'Bootstrap failed:', error);
    
    // Ensure we don't proceed with a broken state
    // Return structured error for the UI to display a fatal error screen
    return {
      ok: false,
      apiUrl: null,
      error: error?.message || String(error)
    };
  }
}

/**
 * Expose as a global for the React application to await before mounting.
 */
(globalThis as any).runDesktopBootstrap = bootstrapDesktop;
