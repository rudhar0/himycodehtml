/**
 * Port Wait Manager Module
 * Polls the .runtime/port.json file and verifies backend health before resolving.
 * 
 * Refactored to be deterministic:
 * - Reads port.json
 * - Validates port
 * - Checks /api/health
 * - NO fallback to 5000
 */

/* global Neutralino */

import { isBackendAlive } from './backendSpawner';

const LOG_PREFIX = '[bootstrap:port]';

export interface PortWaitOptions {
  portJsonPath: string;
  timeoutMs?: number;
  initialDelayMs?: number;
  maxRetryDelayMs?: number;
}

/**
 * Waits for the backend to be healthy and returns its base URL.
 * Throws if timeout or process death.
 */
export async function waitForBackendReady(options: PortWaitOptions): Promise<string> {
  const timeoutMs = options.timeoutMs || 20000;
  const maxDelay = options.maxRetryDelayMs || 1000;
  const startTime = Date.now();
  
  let currentDelay = options.initialDelayMs || 100;

  console.log(LOG_PREFIX, 'Waiting for backend readiness at:', options.portJsonPath);

  while (Date.now() - startTime < timeoutMs) {
    // 1. Abort if the process we spawned is already dead
    if (!isBackendAlive()) {
      throw new Error('Backend process exited unexpectedly during startup.');
    }

    try {
      // 2. Attempt to read port.json
      // Neutralino.filesystem.readFile throws if file not found
      const raw = await (globalThis as any).Neutralino.filesystem.readFile(options.portJsonPath);
      
      let info;
      try {
        info = JSON.parse(raw);
      } catch (e) {
        // partial write or invalid json, wait
      }

      if (info && info.port) {
        const port = Number(info.port);
        if (port > 0) {
          const baseUrl = `http://127.0.0.1:${port}`;
          
          // 3. Verify health
          // We found the port, now ensure it's actually responding
          const isHealthy = await checkHealth(baseUrl);
          if (isHealthy) {
            console.log(LOG_PREFIX, 'Backend is healthy:', baseUrl);
            return baseUrl;
          } else {
             console.log(LOG_PREFIX, 'Port found but health check failed, retrying...');
          }
        }
      }
    } catch (e) {
      // File likely doesn't exist yet, ignore and retry
    }

    // 4. Exponential backoff
    await new Promise(r => setTimeout(r, currentDelay));
    currentDelay = Math.min(currentDelay * 1.5, maxDelay);
  }

  // 5. Hard failure on timeout - NO fallback to 5000
  throw new Error(`Timed out waiting for backend after ${timeoutMs}ms. Check backend logs.`);
}

/**
 * Performs a lightweight health check using fetch.
 */
async function checkHealth(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    
    const res = await fetch(`${baseUrl}/api/health`, {
      signal: controller.signal,
      cache: 'no-store'
    });
    
    clearTimeout(timeout);
    
    if (!res.ok) return false;
    const data = await res.json();
    return data?.status === 'ok';
  } catch {
    return false;
  }
}
