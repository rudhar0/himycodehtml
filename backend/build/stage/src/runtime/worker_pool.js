import { EventEmitter } from 'events';
import os from 'os';
import { spawnSync } from 'child_process';
import { prepareRuntimeEnv, toolchainRoot } from './runtime_env.js';
import { getCompileFlags } from './compile_flags.js';
import { runWithHardLimitsIfAvailable } from './limits.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

class WorkerPool extends EventEmitter {
  constructor(size) {
    super();
    this.size = size || Math.max(2, Math.min(8, os.cpus().length));
    this.queue = [];
    this.workersBusy = 0;
    this.toolchain = prepareRuntimeEnv();
    this.cacheDir = path.join(this.toolchain.root, 'cache');
    try { if (!fs.existsSync(this.cacheDir)) fs.mkdirSync(this.cacheDir, {recursive:true}); } catch(e){}

    // warm clang once to reduce cold-start cost
    try { const clang = path.join(this.toolchain.root, this.toolchain.plat, 'bin', process.platform==='win32' ? 'clang++.exe' : 'clang++'); spawnSync(clang, ['--version'], {timeout:2000}); } catch(e){}
  }

  submit(task) {
    return new Promise((resolve, reject) => {
      // FIFO queue
      this.queue.push({task, resolve, reject});
      this._tryStart();
    });
  }

  _tryStart() {
    while (this.workersBusy < this.size && this.queue.length > 0) {
      const job = this.queue.shift();
      this._runJob(job.task).then(job.resolve).catch(job.reject);
    }
  }

  async _runJob(task) {
    this.workersBusy++;
    const startWait = Date.now();
    try {
      // task: {sessionId, srcPath, outPath, timeLimitMs, cwd, env}
      const toolRoot = this.toolchain.root;
      const plat = this.toolchain.plat;
      const clang = path.join(toolRoot, plat, 'bin', process.platform==='win32' ? 'clang++.exe' : 'clang++');

      // compile cache: hash source file
      const srcData = fs.readFileSync(task.srcPath);
      const hash = crypto.createHash('sha256').update(srcData).digest('hex');
      const cachedBin = path.join(this.cacheDir, hash + (process.platform==='win32'?'.exe':'.out'));

      let compileTime = 0;
      let compileRes = null;

      if (fs.existsSync(cachedBin)) {
        // copy cached binary atomically into session outPath
        try {
          fs.copyFileSync(cachedBin, task.outPath);
          try { const fd = fs.openSync(task.outPath, 'r'); fs.fsyncSync(fd); fs.closeSync(fd); } catch(e){}
        } catch(e){ /* fallthrough to compile */ }
      } else {
        // compile
        const compileFlags = getCompileFlags(toolRoot, plat, task.srcPath, task.outPath);
        const spawnArgs = compileFlags;
        const compileStart = Date.now();
        compileRes = spawnSync(clang, spawnArgs, {cwd: task.cwd, env: this.toolchain.env, timeout: 8000, encoding:'utf8'});
        compileTime = Date.now() - compileStart;
        const compileOk = compileRes && compileRes.status === 0;
        if (!compileOk) {
          return { success: false, stage: 'compile', compile: compileRes, waitTime: Date.now()-startWait, compileTime };
        }

        // store compiled binary in cache (best-effort)
        try {
          fs.copyFileSync(task.outPath, cachedBin);
          try { const fd = fs.openSync(cachedBin, 'r'); fs.fsyncSync(fd); fs.closeSync(fd); } catch(e){}
        } catch(e){}
      }

      // Stage runtime DLLs next to executable for Windows loader reliability
      if (process.platform === 'win32') {
        const dlls = ['libc++.dll', 'libunwind.dll', 'libwinpthread-1.dll'];
        for (const dll of dlls) {
          const src = path.join(toolRoot, plat, 'bin', dll);
          const dest = path.join(task.cwd, dll);
          try {
            if (fs.existsSync(src)) fs.copyFileSync(src, dest);
          } catch (_) {}
        }
      }

      // Ensure child executable permission
      try { if (process.platform !== 'win32') fs.chmodSync(task.outPath, 0o755); } catch(e){}

      // run with hard/soft limits streaming stdout/stderr into session files
      const stdoutPath = path.join(task.cwd, 'stdout.log');
      const stderrPath = path.join(task.cwd, 'stderr.log');
      const runStart = Date.now();
      const runRes = await runWithHardLimitsIfAvailable(task.outPath, [], {cwd: task.cwd, env: task.env || this.toolchain.env, timeMs: task.timeLimitMs || 2000, maxOutputBytes: task.maxOutputBytes || 1024*256, stdoutPath, stderrPath, memoryBytes: task.memoryBytes, cpuSeconds: Math.ceil((task.timeLimitMs||2000)/1000)});
      const runTime = Date.now() - runStart;

      // collect trace existence
      const tracePath = path.join(task.cwd, 'trace.json');
      const traceExists = fs.existsSync(tracePath);

      return { success: true, stage: 'run', compileTime, runTime, run: runRes, waitTime: Date.now()-startWait, traceExists };
    } finally {
      this.workersBusy--;
      setImmediate(()=>this._tryStart());
    }
  }
}

export { WorkerPool };
