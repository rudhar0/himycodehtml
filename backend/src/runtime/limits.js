import { spawn } from 'child_process';
import fs from 'fs';

// Soft limits wrapper: time, output size — stream output to files with byte caps
function runWithSoftLimitsToFiles(cmd, args, opts = {}){
  // opts: cwd, env, timeMs, maxOutputBytes, stdoutPath, stderrPath
  const timeMs = opts.timeMs || 2000;
  const maxOutputBytes = opts.maxOutputBytes || 1024 * 1024; // 1MB

  const child = spawn(cmd, args, {cwd: opts.cwd, env: opts.env, windowsHide: true});
  let timedOut = false;
  let killed = false;
  let stdoutSize = 0;
  let stderrSize = 0;

  const outStream = opts.stdoutPath ? fs.openSync(opts.stdoutPath, 'a') : null;
  const errStream = opts.stderrPath ? fs.openSync(opts.stderrPath, 'a') : null;

  const timer = setTimeout(()=>{
    timedOut = true;
    try { child.kill('SIGKILL'); } catch(e){ try { child.kill(); } catch(_){} }
    killed = true;
  }, timeMs);

  if (child.stdout) child.stdout.on('data', d => {
    stdoutSize += d.length;
    if (stdoutSize <= maxOutputBytes) {
      try { if (outStream) fs.writeSync(outStream, d); } catch(e){}
    } else {
      try { child.kill('SIGKILL'); } catch(e){}
    }
  });
  if (child.stderr) child.stderr.on('data', d => {
    stderrSize += d.length;
    if (stderrSize <= maxOutputBytes) {
      try { if (errStream) fs.writeSync(errStream, d); } catch(e){}
    } else {
      try { child.kill('SIGKILL'); } catch(e){}
    }
  });

  return new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      try { if (outStream) fs.fsyncSync(outStream); if (outStream) fs.closeSync(outStream); } catch(e){}
      try { if (errStream) fs.fsyncSync(errStream); if (errStream) fs.closeSync(errStream); } catch(e){}
      resolve({code, signal, timedOut, killed});
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      try { if (outStream) fs.closeSync(outStream); if (errStream) fs.closeSync(errStream); } catch(e){}
      resolve({error: err});
    });
  });
}

// Best-effort hard limits: POSIX prlimit helper (Linux). macOS/Windows fallback to soft limits.
function runWithHardLimitsIfAvailable(cmd, args, opts = {}){
  // opts: as above, memoryBytes, cpuSeconds
  if (process.platform === 'linux'){
    const prlimit = 'prlimit';
    const mem = opts.memoryBytes ? `--as=${opts.memoryBytes}` : null;
    const cpu = opts.cpuSeconds ? `--cpu=${opts.cpuSeconds}` : null;
    const extra = [];
    if (mem) extra.push(mem);
    if (cpu) extra.push(cpu);
    if (extra.length>0) {
      // run under prlimit
      const allArgs = extra.concat(['--']).concat([cmd]).concat(args);
      return runWithSoftLimitsToFiles(prlimit, allArgs, opts);
    }
  }
  // fallback
  return runWithSoftLimitsToFiles(cmd, args, opts);
}

export { runWithSoftLimitsToFiles, runWithHardLimitsIfAvailable };
