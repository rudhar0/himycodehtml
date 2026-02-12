import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { validateToolchain } from './toolchain-validator.js';
import { detectRuntime } from '../../src/utils/runtime-manager.js';

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function writeDiagnostics({
  backendRoot,
  build = null,
  session = null,
} = {}) {
  if (!backendRoot) throw new Error('writeDiagnostics: backendRoot is required');
  const runtimeDir = path.join(backendRoot, '.runtime');
  await fs.mkdir(runtimeDir, { recursive: true });

  const toolchain = await validateToolchain({ backendRoot });
  const resourcesDir = path.join(backendRoot, 'resources');
  const runtime = await detectRuntime({
    resourcesDir,
    supportedRange: process.env.NEUTRALA_RUNTIME_RANGE || undefined,
  });

  const portInfo = await readJson(path.join(runtimeDir, 'port.json'));
  const lockInfo = await readJson(path.join(runtimeDir, 'port.lock'));

  const payload = {
    timestamp: new Date().toISOString(),
    os: { platform: process.platform, release: os.release(), arch: process.arch },
    node: { version: process.versions.node, execPath: process.execPath },
    toolchain,
    runtime,
    portManager: { portInfo, lockInfo },
    build,
    session,
  };

  const outPath = path.join(runtimeDir, 'diagnostics.json');
  await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return outPath;
}

