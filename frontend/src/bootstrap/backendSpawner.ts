/**
 * Backend Spawner Module
 * Manages the lifecycle of the Node.js backend process using Neutralino.os.spawnProcess.
 * 
 * Refactored to use object signature for spawnProcess (Neutralino 6+).
 */

/* global Neutralino */

const LOG_PREFIX = '[bootstrap:spawn]';

export interface SpawnOptions {
  executablePath: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

interface BackendProcess {
  id: number;
  pid: number;
}

let activeProcess: BackendProcess | null = null;

/**
 * Spawns the backend process.
 */
export async function spawnBackend(options: SpawnOptions): Promise<number> {
  if (activeProcess) {
    console.warn(LOG_PREFIX, 'Backend already running with PID:', activeProcess.pid);
    return activeProcess.pid;
  }

  console.log(LOG_PREFIX, 'Spawning backend with options:', {
    cmd: options.executablePath,
    cwd: options.cwd,
    args: options.args
  });
  
  try {
    // Fix: Neutralino.os.spawnProcess replaces the entire environment if 'env' is provided.
    // We must fetch and merge the current environment to avoid scrubbing critical Windows variables (SystemRoot, PATH, etc.)
    // which are required by the pkg binary and its bundled Node runtime to load system DLLs.
    let hostEnv: Record<string, string> = {};
    try {
      const N = (globalThis as any).Neutralino;
      if (N && N.os && N.os.getEnvs) {
        hostEnv = await N.os.getEnvs();
        console.log(LOG_PREFIX, `Fetched ${Object.keys(hostEnv).length} environment variables.`);
      }

      // Critical fallback: if getEnvs is empty or missing, try to fetch critical Windows variables individually.
      const criticalKeys = ['SystemRoot', 'SystemDrive', 'TEMP', 'PATH', 'USERNAME', 'USERPROFILE'];
      for (const key of criticalKeys) {
        if (!hostEnv[key]) {
          try {
            const val = await (globalThis as any).Neutralino.os.getEnv(key);
            if (val) hostEnv[key] = val;
          } catch (e) { /* ignore */ }
        }
      }
      
      if (Object.keys(hostEnv).length === 0) {
        console.warn(LOG_PREFIX, 'Warning: Modern environment retrieval failed. Backend might crash due to missing system variables.');
      } else {
        console.log(LOG_PREFIX, 'Critical environment check:', {
          SystemRoot: hostEnv['SystemRoot'] ? 'FOUND' : 'MISSING',
          PATH: hostEnv['PATH'] ? 'FOUND' : 'MISSING'
        });
      }
    } catch (e) {
      console.warn(LOG_PREFIX, 'Failed to fetch host environment variables:', e);
    }

    // Neutralino 5.x/6.x requires (command, options) signature
    const proc = await (globalThis as any).Neutralino.os.spawnProcess(options.executablePath, {
      args: options.args || [],
      cwd: options.cwd,
      env: {
        ...hostEnv,
        ...options.env,
        NEUTRALA_FORCE_LOCAL_RUNTIME: 'true'
      }, // Pass merged environment + force local runtime matches frontend expectation
      background: false, // Attach process to parent (critical for cleanup)
      stdIn: '',      // Optional: empty stdin
      stdOut: '',     // Optional: handle stdout via events if needed
      stdErr: ''      // Optional: handle stderr via events if needed
    });

    activeProcess = {
      id: proc.id,
      pid: proc.pid
    };

    console.log(LOG_PREFIX, 'Backend spawned successfully. ID:', proc.id, 'PID:', proc.pid);

    // Listen for exit to cleanup local state
    // Note: Neutralino events are global, so we check ID match
    const onExit = (event: any) => {
      if (activeProcess && event.detail.id === activeProcess.id) {
        console.log(LOG_PREFIX, 'Backend process exited unexpectedly:', event.detail);
        activeProcess = null;
        (globalThis as any).Neutralino.events.off('spawnedProcessExited', onExit);
      }
    };
    
    (globalThis as any).Neutralino.events.on('spawnedProcessExited', onExit);

    // 4. Capture and log backend output (stdout/stderr) for debugging
    const onStdout = (event: any) => {
      if (activeProcess && event.detail.id === activeProcess.id) {
        console.log(`[backend:stdout] ${event.detail.data}`);
      }
    };
    const onStderr = (event: any) => {
      if (activeProcess && event.detail.id === activeProcess.id) {
        console.warn(`[backend:stderr] ${event.detail.data}`);
      }
    };
    
    (globalThis as any).Neutralino.events.on('spawnedProcessStdout', onStdout);
    (globalThis as any).Neutralino.events.on('spawnedProcessStderr', onStderr);

    return proc.pid;
  } catch (error) {
    console.error(LOG_PREFIX, 'Failed to spawn backend:', error);
    // Include context in error for debugging
    throw new Error(`Spawn failed for ${options.executablePath}: ${String(error)}`);
  }
}

let isStopping = false;

/**
 * Stops the backend process with graceful shutdown + forced kill fallback.
 * Resilience: Handles PID validation and prevents concurrent stop races.
 */
export async function stopBackend(): Promise<void> {
  if (!activeProcess) {
    console.log(LOG_PREFIX, 'No active backend process to stop.');
    return;
  }

  if (isStopping) {
    console.log(LOG_PREFIX, 'Stop already in progress, skipping...');
    return;
  }

  isStopping = true;
  
  // Prefer PID (must be a positive integer)
  const targetPid = activeProcess.pid;
  
  if (!targetPid || targetPid <= 0) {
    console.warn(LOG_PREFIX, 'Invalid PID for backend process, clearing state.');
    activeProcess = null;
    isStopping = false;
    return;
  }

  console.log(LOG_PREFIX, 'Stopping backend PID:', targetPid);
  
  try {
    const isWindows = (globalThis as any).NL_OS === 'Windows';
    
    // Try graceful SIGTERM first
    const gracefulCmd = isWindows 
      ? `taskkill /PID ${targetPid} /T` 
      : `kill -TERM ${targetPid}`;
    
    // Force kill fallback
    const forceCmd = isWindows 
      ? `taskkill /F /T /PID ${targetPid}`
      : `kill -9 ${targetPid}`;

    console.log(LOG_PREFIX, `Graceful kill attempt: ${gracefulCmd}`);
    let gracefulSucceeded = false;

    try {
      await Promise.race([
        (globalThis as any).Neutralino.os.execCommand(gracefulCmd),
        new Promise((_, r) => setTimeout(() => r(null), 2500))
      ]);
      gracefulSucceeded = true;
      console.log(LOG_PREFIX, 'Graceful kill command sent');
    } catch (graceErr) {
      console.warn(LOG_PREFIX, 'Graceful kill failed or timed out:', graceErr);
    }

    if (!gracefulSucceeded) {
      try {
        console.log(LOG_PREFIX, `Force kill attempt: ${forceCmd}`);
        await Promise.race([
          (globalThis as any).Neutralino.os.execCommand(forceCmd),
          new Promise((_, r) => setTimeout(() => r(null), 1500))
        ]);
        console.log(LOG_PREFIX, 'Force kill command sent');
      } catch (forceErr) {
        console.error(LOG_PREFIX, 'Force kill also failed:', forceErr);
      }
    }

    activeProcess = null;
    console.log(LOG_PREFIX, 'Backend stop cycle finished.');
    await new Promise(r => setTimeout(r, 300));
  } catch (error) {
    console.error(LOG_PREFIX, 'Unexpected error stopping backend:', error);
    activeProcess = null;
  } finally {
    isStopping = false;
  }
}

/**
 * Restarts the backend process.
 */
export async function restartBackend(options: SpawnOptions): Promise<number> {
  console.log(LOG_PREFIX, 'Restarting backend...');
  await stopBackend();
  // Brief delay to ensure port release and OS cleanup
  await new Promise(r => setTimeout(r, 1000));
  return await spawnBackend(options);
}

/**
 * Checks if the backend process is currently tracked as alive.
 */
export function isBackendAlive(): boolean {
  return activeProcess !== null;
}
