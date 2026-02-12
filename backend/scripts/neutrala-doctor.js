import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { validateToolchain } from './_lib/toolchain-validator.js';
import { detectRuntime } from '../src/utils/runtime-manager.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(SCRIPT_DIR, '..');
const RUNTIME_DIR = path.join(BACKEND_ROOT, '.runtime');

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeDiagnostics(payload) {
  await fs.mkdir(RUNTIME_DIR, { recursive: true });
  await fs.writeFile(
    path.join(RUNTIME_DIR, 'diagnostics.json'),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  );
}

function printSection(title) {
  // eslint-disable-next-line no-console
  console.log(`\n== ${title} ==`);
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('NeutralaJS Doctor');
  // eslint-disable-next-line no-console
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const toolchain = await validateToolchain({
    backendRoot: BACKEND_ROOT,
    requirePkg: false,
    requireNeu: false,
    requireFrontend: true,
    requireDesktop: true,
  });

  const portInfo = await readJson(path.join(RUNTIME_DIR, 'port.json'));
  const lockInfo = await readJson(path.join(RUNTIME_DIR, 'port.lock'));
  const resourcesDir = path.join(BACKEND_ROOT, 'resources');
  const runtimeStatus = await detectRuntime({
    resourcesDir,
    supportedRange: process.env.NEUTRALA_RUNTIME_RANGE || undefined,
  });

  const report = {
    timestamp: new Date().toISOString(),
    os: { platform: process.platform, release: os.release(), arch: process.arch },
    node: { version: process.versions.node, execPath: process.execPath },
    toolchain,
    runtime: runtimeStatus,
    port: { portInfo, lockInfo },
  };

  printSection('Toolchain');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: toolchain.ok, errors: toolchain.errors, warnings: toolchain.warnings }, null, 2));

  printSection('Versions');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(toolchain.versions, null, 2));

  printSection('Runtime');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(runtimeStatus, null, 2));

  printSection('Port State');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ portInfo, lockInfo }, null, 2));

  await writeDiagnostics(report);
  // eslint-disable-next-line no-console
  console.log(`\nWrote ${path.join(RUNTIME_DIR, 'diagnostics.json')}`);

  if (!toolchain.ok) process.exit(1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});

