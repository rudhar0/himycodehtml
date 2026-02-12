import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}. Must be an integer 1-65535.`);
  }
  return port;
}

function parseRange(rangeText) {
  const text = String(rangeText || '').trim();
  const match = /^(\d{1,5})\s*-\s*(\d{1,5})$/.exec(text);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end > 65535 ||
    start > end
  ) {
    return null;
  }
  return { start, end };
}

function nowMs() {
  return Date.now();
}

function isPidRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function newInstanceId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readJsonSync(filePath) {
  try {
    const raw = fssync.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJsonAtomic(filePath, data) {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  try {
    await fs.unlink(filePath);
  } catch {
    // ignore
  }
  await fs.rename(tmpPath, filePath);
}

function safeUnlinkSync(filePath) {
  try {
    fssync.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

async function safeUnlink(filePath) {
  try {
    await fs.unlink(filePath);
  } catch {
    // ignore
  }
}

async function attemptListen(server, { port, host }) {
  return await new Promise((resolve, reject) => {
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      server.off('error', onError);
      server.off('listening', onListening);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ port, host, exclusive: true });
  });
}

function isLockStale(lock, { heartbeatTtlMs }) {
  if (!lock || typeof lock !== 'object') return true;
  if (!lock.pid || !lock.port) return true;

  const pidAlive = isPidRunning(Number(lock.pid));
  if (!pidAlive) return true;

  const last = Number(lock.lastHeartbeat || 0);
  if (!Number.isFinite(last) || last <= 0) return true;
  return nowMs() - last > heartbeatTtlMs;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitForReleasableLock(lockFilePath, { heartbeatTtlMs, waitMs }) {
  const deadline = nowMs() + waitMs;
  while (nowMs() < deadline) {
    const current = await readJson(lockFilePath);
    if (!current) return null;
    if (isLockStale(current, { heartbeatTtlMs })) return current;
    await sleep(250);
  }
  return await readJson(lockFilePath);
}

export function resolvePreferredPortRange() {
  return (
    parseRange(process.env.PORT_RANGE) ||
    parseRange(process.env.PREFERRED_PORT_RANGE) ||
    { start: 3000, end: 3999 }
  );
}

export async function listenWithAutoPort(httpServer, options) {
  const {
    host = '0.0.0.0',
    runtimeDir,
    preferredRange = resolvePreferredPortRange(),
    portFileName = 'port.json',
    lockFileName = 'port.lock',
    heartbeatIntervalMs = 5000,
    heartbeatTtlMs = Number(process.env.PORT_LOCK_TTL_MS || 15000),
    lockWaitMs = Number(process.env.PORT_LOCK_WAIT_MS || 4000),
    allowMultiInstance = process.env.ALLOW_MULTI_INSTANCE === 'true',
  } = options || {};

  if (!runtimeDir) throw new Error('listenWithAutoPort: runtimeDir is required');
  await fs.mkdir(runtimeDir, { recursive: true });

  const portFilePath = path.join(runtimeDir, portFileName);
  const lockFilePath = path.join(runtimeDir, lockFileName);

  const instanceId = newInstanceId();
  let heartbeatTimer = null;

  const existingLock = await readJson(lockFilePath);
  if (existingLock && !isLockStale(existingLock, { heartbeatTtlMs })) {
    const otherPid = Number(existingLock.pid);
    if (otherPid === process.pid) {
      const err = new Error(
        `Port already bound by same PID (${process.pid}). Refusing to start twice.`,
      );
      err.code = 'EALREADY';
      throw err;
    }

    if (!allowMultiInstance) {
      // Rapid restarts: give the existing instance a short window to exit and clear its lock.
      const afterWait = await waitForReleasableLock(lockFilePath, {
        heartbeatTtlMs,
        waitMs: lockWaitMs,
      });
      if (afterWait && !isLockStale(afterWait, { heartbeatTtlMs })) {
        const err = new Error(
          `Backend already running (pid=${afterWait.pid}, port=${afterWait.port}).`,
        );
        err.code = 'ELOCKED';
        err.lock = afterWait;
        throw err;
      }
      await safeUnlink(lockFilePath);
    }
  } else if (existingLock) {
    await safeUnlink(lockFilePath);
  }

  const envPortRaw = process.env.PORT;
  const envPort =
    envPortRaw != null && String(envPortRaw).trim() !== ''
      ? parsePort(envPortRaw)
      : null;

  const lastPort = await readJson(portFilePath);
  const lastPortCandidate = Number(lastPort?.port);

  const portsToTry = [];
  if (envPort) {
    portsToTry.push(envPort);
  } else {
    if (
      Number.isInteger(lastPortCandidate) &&
      lastPortCandidate >= preferredRange.start &&
      lastPortCandidate <= preferredRange.end
    ) {
      portsToTry.push(lastPortCandidate);
    }
    for (let port = preferredRange.start; port <= preferredRange.end; port++) {
      if (port !== lastPortCandidate) portsToTry.push(port);
    }
  }

  const writeLock = async (port) => {
    const timestamp = new Date().toISOString();
    const lock = {
      port,
      pid: process.pid,
      timestamp,
      instanceId,
      lastHeartbeat: nowMs(),
    };
    await writeJsonAtomic(lockFilePath, lock);
    return lock;
  };

  const startHeartbeat = async (port) => {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(async () => {
      const current = await readJson(lockFilePath);
      if (!current || current.instanceId !== instanceId) return;
      current.lastHeartbeat = nowMs();
      await writeJsonAtomic(lockFilePath, current);
    }, heartbeatIntervalMs);
    heartbeatTimer.unref?.();

    // Immediate heartbeat write.
    await writeLock(port);
  };

  const release = async () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;

    const current = await readJson(lockFilePath);
    if (current && current.instanceId === instanceId) {
      await safeUnlink(lockFilePath);
    }
  };

  const releaseSync = () => {
    try {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    } catch {
      // ignore
    }
    heartbeatTimer = null;

    const current = readJsonSync(lockFilePath);
    if (current && current.instanceId === instanceId) {
      safeUnlinkSync(lockFilePath);
    }
  };

  // Crash recovery + deterministic cleanup.
  const installProcessHandlers = () => {
    process.once('exit', () => releaseSync());
    process.once('uncaughtException', (err) => {
      releaseSync();
      // eslint-disable-next-line no-console
      console.error('Uncaught exception (port lock released):', err);
      process.exit(1);
    });
    process.once('SIGINT', () => releaseSync());
    process.once('SIGTERM', () => releaseSync());
    process.once('SIGUSR2', () => releaseSync());
  };
  installProcessHandlers();

  let lastError = null;
  for (const port of portsToTry) {
    try {
      await attemptListen(httpServer, { port, host });

      await startHeartbeat(port);

      const portInfo = {
        pid: process.pid,
        port,
        host,
        instanceId,
        timestamp: new Date().toISOString(),
        url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`,
        platform: process.platform,
        node: process.versions.node,
      };
      await writeJsonAtomic(portFilePath, portInfo);

      return {
        port,
        host,
        instanceId,
        portFilePath,
        lockFilePath,
        release,
        releaseSync,
      };
    } catch (err) {
      lastError = err;
      if (err?.code === 'EACCES') {
        throw new Error(
          `Permission error binding to port ${port} on host ${host}: ${err.message}`,
        );
      }
      if (envPort) {
        throw new Error(
          `PORT=${envPort} is unavailable (code: ${err?.code || 'unknown'}). ${err?.message || err}`,
        );
      }
      if (err?.code !== 'EADDRINUSE') throw err;
    }
  }

  throw new Error(
    `No free port available in range ${preferredRange.start}-${preferredRange.end}. Last error: ${lastError?.message || lastError}`,
  );
}

export async function releasePortLock({ lockFilePath, instanceId } = {}) {
  if (!lockFilePath) return;
  if (!instanceId) {
    await safeUnlink(lockFilePath);
    return;
  }
  const current = await readJson(lockFilePath);
  if (current && current.instanceId === instanceId) {
    await safeUnlink(lockFilePath);
  }
}
