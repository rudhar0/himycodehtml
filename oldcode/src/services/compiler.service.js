import { writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const tempDir = path.join(process.cwd(), 'temp');

async function ensureTempDir() {
  if (!existsSync(tempDir)) {
    await mkdir(tempDir, { recursive: true });
  }
}

async function compile(code, language = 'c') {
  await ensureTempDir();
  const sessionId = uuidv4();
  const ext = language === 'cpp' || language === 'c++' ? 'cpp' : 'c';
  const compiler = language === 'cpp' || language === 'c++' ? 'g++' : 'gcc';
  const sourceFile = path.join(tempDir, `${sessionId}.${ext}`);
  const executable = path.join(tempDir, `${sessionId}.out`);

  await writeFile(sourceFile, code, 'utf8');

  return new Promise((resolve, reject) => {
    const args = ['-g', '-O0', sourceFile, '-o', executable];
    const cp = spawn(compiler, args);
    let stderr = '';
    cp.stderr.on('data', (d) => stderr += d.toString());
    cp.on('close', (codeExit) => {
      if (codeExit === 0) resolve({ sourceFile, executable });
      else reject(new Error(stderr || 'Compilation failed'));
    });
    cp.on('error', (err) => reject(err));
  });
}

export default { compile };
