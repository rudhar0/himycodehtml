import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import os from 'os';
import { fileURLToPath } from 'url';
import { WorkerPool } from './worker_pool.js';
import { prepareRuntimeEnv, toolchainRoot } from './runtime_env.js';
import { sweepSessions } from './sweeper.js';
import resourceResolver from '../services/resource-resolver.service.js';

// Fix: Use resourceResolver to get a writable temp path (prevents Program Files write errors)
const ROOT_TEMP = resourceResolver.getTempRoot();
// Directory creation is handled by resourceResolver, but we ensure it here too just in case
if (!fs.existsSync(ROOT_TEMP)) fs.mkdirSync(ROOT_TEMP, { recursive: true });

function sessionPath(sessionId) { return path.join(ROOT_TEMP, `session_${sessionId}`); }

function atomicWrite(filePath, data, opts = { mode: 0o600 }) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, data, { mode: opts.mode });
  try { const fd = fs.openSync(tmp, 'r'); fs.fsyncSync(fd); fs.closeSync(fd); } catch (e) { }
  fs.renameSync(tmp, filePath);
}

function acquireLock(sessionDir, timeoutMs = 5000) {
  const lockfile = path.join(sessionDir, '.lock');
  const start = Date.now();
  while (true) {
    try {
      const fd = fs.openSync(lockfile, 'wx');
      fs.writeSync(fd, `${process.pid}\n`);
      fs.closeSync(fd);
      return () => { try { fs.unlinkSync(lockfile); } catch (e) { } };
    } catch (e) {
      if (Date.now() - start > timeoutMs) throw new Error('LockTimeout');
      // small sleep
      const wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
      try { wait(10); } catch (e) { }
    }
  }
}

function createSession(sessionId) {
  const sid = sessionId || crypto.randomBytes(6).toString('hex');
  const dir = sessionPath(sid);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return { sid, dir };
}

function cleanupSession(sessionId, opts = { force: false }) {
  const dir = sessionPath(sessionId);
  if (!fs.existsSync(dir)) return;
  try {
    const release = acquireLock(dir, 2000);
    const files = fs.readdirSync(dir);
    for (const f of files) { try { fs.unlinkSync(path.join(dir, f)); } catch (e) { } }
    try { fs.rmdirSync(dir); } catch (e) { }
    release();
  } catch (e) {
    if (opts.force) {
      try {
        spawnSync(process.platform === 'win32' ? 'powershell' : 'rm', process.platform === 'win32' ? ['-Command', `Remove-Item -Recurse -Force '${dir}'`] : ['-rf', dir]);
      } catch (e) { }
    } else throw e;
  }
}

// Warm worker pool for compile+run tasks
const POOL = new WorkerPool(Math.max(2, Math.min(6, os.cpus().length)));

// background sweeper every 10 minutes
setInterval(() => { try { sweepSessions(ROOT_TEMP, 1000 * 60 * 30); } catch (e) { } }, 1000 * 60 * 10);

async function compileAndRun(sessionId, sourceCode, opts = {}) {
  const { sid, dir } = createSession(sessionId);
  const release = acquireLock(dir, 2000);
  try {
    const src = path.join(dir, 'main.cpp');
    const binName = process.platform === 'win32' ? 'a.exe' : 'a.out';
    const bin = path.join(dir, binName);
    const traceOut = path.join(dir, 'trace.json');

    atomicWrite(src, sourceCode);

    const toolInfo = prepareRuntimeEnv();

    // submit to worker pool
    const task = {
      sessionId: sid,
      srcPath: src,
      outPath: bin,
      cwd: dir,
      env: Object.assign({}, toolInfo.env, { TRACE_OUTPUT: traceOut }),
      timeLimitMs: opts.timeLimitMs || 2000,
      maxOutputBytes: opts.maxOutputBytes || 1024 * 256
    };

    const res = await POOL.submit(task);

    // attach trace path and session info
    res.session = { id: sid, dir, trace: traceOut, stdout: path.join(dir, 'stdout.log'), stderr: path.join(dir, 'stderr.log') };
    // write metadata atomically
    const meta = { session: sid, created: Date.now(), status: res.success ? 'completed' : 'failed', resultStage: res.stage };
    try { atomicWrite(path.join(dir, 'meta.json'), JSON.stringify(meta)); } catch (e) { }
    return res;
  } finally {
    try { release(); } catch (e) { }
  }
}

export { createSession, cleanupSession, atomicWrite, compileAndRun };
