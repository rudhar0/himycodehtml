#!/usr/bin/env node
/**
 * Self-test: validates bundled toolchain and runs a simple compile+execute test
 * Run: node scripts/self_test.js
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { toolchainService } from '../src/services/toolchain.service.js';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function test(name, fn) {
  process.stdout.write(`\n⏳ ${name}... `);
  try {
    await fn();
    console.log('✅');
    return true;
  } catch (e) {
    console.log(`❌\n   ${e.message}`);
    return false;
  }
}

async function runTests() {
  let passed = 0, failed = 0;

  // Test 1: Toolchain verification
  if (await test('Toolchain compiler check', async () => {
    const res = await toolchainService.verify();
    if (!res.compiler) throw new Error('Compiler not found');
  })) passed++; else failed++;

  if (await test('Toolchain headers check', async () => {
    const res = await toolchainService.verify();
    if (!res.headers) throw new Error('Headers not found');
  })) passed++; else failed++;

  // Test 2: Simple compile test
  if (await test('Compile simple C++ program', async () => {
    const compiler = toolchainService.getCompiler('cpp');
    const tmpDir = path.join(__dirname, '../temp_test');
    const fs = await import('fs/promises');
    try { await fs.mkdir(tmpDir, { recursive: true }); } catch (e) {}

    const srcFile = path.join(tmpDir, 'test.cpp');
    const outFile = path.join(tmpDir, 'test' + (process.platform === 'win32' ? '.exe' : ''));
    const code = `
#include <iostream>
int main() {
  std::cout << "SELF_TEST_PASS" << std::endl;
  return 0;
}
`;
    await fs.writeFile(srcFile, code, 'utf-8');

    const flags = toolchainService.getIncludeFlags();
    const lflags = toolchainService.getLinkerFlags();
    const args = [...flags, ...lflags, '-o', outFile, srcFile];

    await new Promise((resolve, reject) => {
      const p = spawn(compiler, args, { cwd: tmpDir, stdio: 'pipe' });
      let err = '';
      p.stderr.on('data', d => err += d.toString());
      p.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`Compile failed (${code}): ${err}`));
      });
    });

    // Cleanup
    try { await fs.unlink(srcFile); await fs.unlink(outFile); } catch (e) {}
  })) passed++; else failed++;

  // Test 3: Simple execute test
  if (await test('Execute compiled program', async () => {
    const tmpDir = path.join(__dirname, '../temp_test');
    const fs = await import('fs/promises');
    try { await fs.mkdir(tmpDir, { recursive: true }); } catch (e) {}

    const compiler = toolchainService.getCompiler('cpp');
    const srcFile = path.join(tmpDir, 'test.cpp');
    const outFile = path.join(tmpDir, 'test' + (process.platform === 'win32' ? '.exe' : ''));
    const code = `
#include <iostream>
int main() {
  std::cout << "SELF_TEST_PASS" << std::endl;
  return 0;
}
`;
    await fs.writeFile(srcFile, code, 'utf-8');

    const flags = toolchainService.getIncludeFlags();
    const lflags = toolchainService.getLinkerFlags();
    const args = [...flags, ...lflags, '-o', outFile, srcFile];

    await new Promise((resolve, reject) => {
      const p = spawn(compiler, args, { cwd: tmpDir, stdio: 'pipe' });
      let err = '';
      p.stderr.on('data', d => err += d.toString());
      p.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`Compile failed (${code}): ${err}`));
      });
    });

    // Execute
    let output = '';
    await new Promise((resolve, reject) => {
      const cmd = process.platform === 'win32' ? outFile : `./${path.basename(outFile)}`;
      const p = spawn(cmd, [], { cwd: tmpDir, stdio: 'pipe' });
      p.stdout.on('data', d => output += d.toString());
      p.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`Execution failed (${code})`));
      });
      setTimeout(() => {
        p.kill();
        reject(new Error('Execution timeout'));
      }, 5000);
    });

    if (!output.includes('SELF_TEST_PASS')) throw new Error(`Expected output not found: ${output}`);

    // Cleanup
    try { await fs.unlink(srcFile); await fs.unlink(outFile); } catch (e) {}
  })) passed++; else failed++;

  console.log(`\n\n📊 Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error('Test harness error:', e);
  process.exit(1);
});
