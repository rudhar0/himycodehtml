import { writeFile } from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { toolchainService } from './toolchain.service.js';
import resourceResolver from './resource-resolver.service.js';
import sessionManager from './session-manager.service.js';

async function compile(code, language = 'c') {
  const sessionId = uuidv4();
  const session = await sessionManager.createSession(sessionId);
  const workDir = session.path;

  const ext = language === 'cpp' || language === 'c++' ? 'cpp' : 'c';
  // Use bundled toolchain
  const compiler = toolchainService.getCompiler(language);
  const includeFlags = toolchainService.getIncludeFlags();
  const linkFlags = toolchainService.getLinkerFlags(); // Might need these if simple compile needs libcpp

  const sourceFile = path.join(workDir, `${sessionId}.${ext}`);
  const executable = path.join(workDir, `${sessionId}.out${process.platform === 'win32' ? '.exe' : ''}`);

  await writeFile(sourceFile, code, 'utf8');

  return new Promise((resolve, reject) => {
    // Add flags
    const args = ['-g', '-O0', ...includeFlags, ...linkFlags, sourceFile, '-o', executable];
    console.log(`[CompilerService] Compiling: ${compiler} ${args.join(' ')}`);
    const cp = spawn(compiler, args, { cwd: workDir });
    let stderr = '';
    cp.stderr.on('data', (d) => stderr += d.toString());
    cp.on('close', (codeExit) => {
      if (codeExit === 0) resolve({ sessionId: session.id, sourceFile, executable });
      else reject(new Error(stderr || 'Compilation failed'));
    });
    cp.on('error', (err) => reject(err));
  });
}

export default { compile };
