import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');
const RUNTIME_DIR = path.join(BACKEND_ROOT, '.runtime');

function nowIso() {
  return new Date().toISOString();
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson(p) {
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(raw);
}

async function readText(p) {
  return await fs.readFile(p, 'utf8');
}

async function fetchWithTimeout(url, timeoutMs = 1500) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = setTimeout(() => ctrl?.abort?.(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl?.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (e) {
    return { ok: false, status: 0, text: e?.message || String(e) };
  } finally {
    clearTimeout(t);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  // eslint-disable-next-line no-console
  console.log(`CodeViz verification (${nowIso()})`);

  const failures = [];
  const warnings = [];

  const check = async (name, fn) => {
    try {
      await fn();
      // eslint-disable-next-line no-console
      console.log(`✔ ${name}`);
    } catch (e) {
      failures.push(`${name}: ${e?.message || String(e)}`);
      // eslint-disable-next-line no-console
      console.error(`✖ ${name}: ${e?.message || String(e)}`);
    }
  };

  await check('Desktop config branding', async () => {
    const cfgPath = path.join(REPO_ROOT, 'desktop', 'neutralino.config.json');
    assert(await exists(cfgPath), `Missing ${cfgPath}`);
    const cfg = await readJson(cfgPath);
    assert(cfg.applicationId === 'com.codeviz.desktop', `applicationId must be com.codeviz.desktop (got ${cfg.applicationId})`);
    assert(cfg.modes?.window?.title === 'CodeViz', `window.title must be CodeViz (got ${cfg.modes?.window?.title})`);
    assert(
      String(cfg.url || '').includes('127.0.0.1:5173'),
      `dev url should use 127.0.0.1:5173 (got ${cfg.url})`,
    );
  });

  await check('Frontend bootstrap wiring', async () => {
    const indexPath = path.join(REPO_ROOT, 'frontend', 'index.html');
    assert(await exists(indexPath), `Missing ${indexPath}`);
    const html = await readText(indexPath);
    assert(html.includes('<title>CodeViz</title>'), 'index.html title must be CodeViz');
    assert(html.includes('/neutralino-loader.js'), 'index.html must load /neutralino-loader.js');
    assert(html.includes('/neutrala-bootstrap.js'), 'index.html must load /neutrala-bootstrap.js');
    assert(html.includes('/src/main.tsx'), 'index.html must load /src/main.tsx');
    assert(html.includes('neutrala-splash'), 'index.html must include the splash element');
  });

  await check('Runtime URL resolution is dynamic', async () => {
    const cfgPath = path.join(REPO_ROOT, 'frontend', 'src', 'config', 'api.config.ts');
    assert(await exists(cfgPath), `Missing ${cfgPath}`);
    const ts = await readText(cfgPath);
    assert(ts.includes('get baseURL()'), 'API_CONFIG.baseURL must be a getter');
    assert(ts.includes('__NEUTRALA_API_URL'), 'API config must read __NEUTRALA_API_URL at runtime');
  });

  await check('Backend health (if running)', async () => {
    const portJson = path.join(RUNTIME_DIR, 'port.json');
    if (!(await exists(portJson))) {
      warnings.push('backend/.runtime/port.json missing (backend not running?)');
      return;
    }
    const info = await readJson(portJson);
    const port = Number(info?.port);
    assert(Number.isInteger(port) && port > 0 && port < 65536, `Invalid backend port in ${portJson}`);
    const url = `http://127.0.0.1:${port}/api/health`;
    const res = await fetchWithTimeout(url, 1500);
    assert(res.ok, `Health check failed: ${url} (${res.status}) ${res.text}`);
    const body = JSON.parse(res.text);
    assert(body?.status === 'ok', `Unexpected /api/health payload: ${res.text}`);
  });

  await check('Vite dev server (if running)', async () => {
    const client = await fetchWithTimeout('http://127.0.0.1:5173/@vite/client', 800);
    if (!client.ok) {
      warnings.push('Vite dev server not detected on http://127.0.0.1:5173 (skipping)');
      return;
    }
    const page = await fetchWithTimeout('http://127.0.0.1:5173/', 1200);
    assert(page.ok, `Vite index failed (${page.status})`);
    assert(page.text.includes('<title>CodeViz</title>'), 'Vite-served index.html title must be CodeViz');
  });

  if (warnings.length) {
    // eslint-disable-next-line no-console
    console.warn('\nWarnings:');
    for (const w of warnings) console.warn(`- ${w}`);
  }

  if (failures.length) {
    // eslint-disable-next-line no-console
    console.error('\nFailures:');
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log('\nAll checks passed.');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});

