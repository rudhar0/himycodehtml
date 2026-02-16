/**
 * Backend Spawner Module - FIXED VERSION
 * Manages the lifecycle of the Node.js backend process using Neutralino.os.spawnProcess.
 * 
 * FIX: Improved graceful shutdown with timeout and fallback force kill.
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
    let hostEnv: Record<string, string> = {};
    try {
      const N = (globalThis as any).Neutralino;
      if (N && N.os && N.os.getEnvs) {
        hostEnv = await N.os.getEnvs();
        console.log(LOG_PREFIX, `Fetched ${Object.keys(hostEnv).length} environment variables.`);
      }

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

    const proc = await (globalThis as any).Neutralino.os.spawnProcess(options.executablePath, {
      args: options.args || [],
      cwd: options.cwd,
      env: {
        ...hostEnv,
        ...options.env,
        NEUTRALA_FORCE_LOCAL_RUNTIME: 'true'
      },
      background: true,
      stdIn: '',
      stdOut: '',
      stdErr: ''
    });

    activeProcess = {
      id: proc.id,
      pid: proc.pid
    };

    console.log(LOG_PREFIX, 'Backend spawned successfully. ID:', proc.id, 'PID:', proc.pid);

    const onExit = (event: any) => {
      if (activeProcess && event.detail.id === activeProcess.id) {
        console.log(LOG_PREFIX, 'Backend process exited unexpectedly:', event.detail);
        activeProcess = null;
        (globalThis as any).Neutralino.events.off('spawnedProcessExited', onExit);
      }
    };
    
    (globalThis as any).Neutralino.events.on('spawnedProcessExited', onExit);

    return proc.pid;
  } catch (error) {
    console.error(LOG_PREFIX, 'Failed to spawn backend:', error);
    throw new Error(`Spawn failed for ${options.executablePath}: ${String(error)}`);
  }
}

/**
 * Stops the backend process with graceful shutdown + forced kill fallback.
 * FIX: Uses SIGTERM (graceful) first with timeout, then SIGKILL (force) if needed.
 */
export async function stopBackend(): Promise<void> {
  if (!activeProcess) {
    console.log(LOG_PREFIX, 'No active backend process to stop.');
    return;
  }

  const targetPid = activeProcess.pid;
  console.log(LOG_PREFIX, 'Stopping backend PID:', targetPid);
  
  try {
    const isWindows = (globalThis as any).NL_OS === 'Windows';
    
    // FIX: Try graceful SIGTERM first (gives server 2.5s to cleanup)
    const gracefulCmd = isWindows 
      ? `taskkill /PID ${targetPid} /T` 
      : `kill -TERM ${targetPid}`;
    
    // FIX: Force SIGKILL as fallback (kills immediately)
    const forceCmd = isWindows 
      ? `taskkill /F /T /PID ${targetPid}`
      : `kill -9 ${targetPid}`;
    
    console.log(LOG_PREFIX, `Graceful kill attempt: ${gracefulCmd}`);
    let killed = false;
    
    try {
      await Promise.race([
        (globalThis as any).Neutralino.os.execCommand(gracefulCmd),
        new Promise((_, r) => setTimeout(() => r(null), 2500))
      ]);
      killed = true;
      console.log(LOG_PREFIX, 'Graceful kill successful');
    } catch (graceErr) {
      console.warn(LOG_PREFIX, 'Graceful kill failed or timed out, using force kill');
    }
    
    // FIX: If graceful kill didn't work, force kill
    if (!killed) {
      try {
        await Promise.race([
          (globalThis as any).Neutralino.os.execCommand(forceCmd),
          new Promise((_, r) => setTimeout(() => r(null), 1500))
        ]);
        console.log(LOG_PREFIX, 'Force kill executed successfully');
      } catch (forceErr) {
        console.error(LOG_PREFIX, 'Force kill also failed:', forceErr);
      }
    }
    
    activeProcess = null;
    console.log(LOG_PREFIX, 'Backend stop completed');
    
    // FIX: Wait for OS to reap the process
    await new Promise(r => setTimeout(r, 200));
  } catch (error) {
    console.error(LOG_PREFIX, 'Unexpected error stopping backend:', error);
    activeProcess = null;
  }
}

/**
 * Restarts the backend process.
 */
export async function restartBackend(options: SpawnOptions): Promise<number> {
  console.log(LOG_PREFIX, 'Restarting backend...');
  await stopBackend();
  await new Promise(r => setTimeout(r, 1000));
  return await spawnBackend(options);
}

/**
 * Checks if the backend process is currently tracked as alive.
 */
export function isBackendAlive(): boolean {
  return activeProcess !== null;
}
