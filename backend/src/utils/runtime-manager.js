import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import https from 'node:https';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';

// This manager is used for the "Neutrala runtime" directory:
// backend/resources/neutrala-runtime/<platform>/
//
// For desktop rollout, this is the NeutralinoJS runtime pack downloaded from official releases.
// It is NOT required to run the backend in dev by default.
const DEFAULT_SUPPORTED_RANGE = '>=1.0.0 <1000.0.0';
const DEFAULT_RELEASE_REPO = 'neutralinojs/neutralinojs';
const DEFAULT_TAG_PREFIX = 'v';
const DEFAULT_NEUTRALINO_JS_REPO = 'neutralinojs/neutralino.js';

function platformKey() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'mac';
  return 'linux';
}

function archKey() {
  // Neutralino release assets commonly use x64/arm64.
  return process.arch === 'arm64' ? 'arm64' : 'x64';
}

function interpolate(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars?.[k];
    return v == null ? `{${k}}` : String(v);
  });
}

function parseSemver(text) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(text));
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function cmpSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function satisfiesRange(versionText, rangeText) {
  const v = parseSemver(versionText);
  if (!v) return false;
  const parts = String(rangeText || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return true;

  for (const part of parts) {
    const m = /^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/.exec(part);
    if (!m) continue;
    const op = m[1] || '=';
    const r = parseSemver(m[2]);
    if (!r) continue;
    const c = cmpSemver(v, r);
    if (op === '=' && c !== 0) return false;
    if (op === '>' && !(c > 0)) return false;
    if (op === '>=' && !(c >= 0)) return false;
    if (op === '<' && !(c < 0)) return false;
    if (op === '<=' && !(c <= 0)) return false;
  }
  return true;
}

async function sha256File(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const s = fssync.createReadStream(filePath);
    s.on('error', reject);
    s.on('data', (d) => hash.update(d));
    s.on('end', () => resolve(hash.digest('hex')));
  });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function globalRuntimeCacheDir() {
  if (process.env.NEUTRALA_RUNTIME_CACHE_DIR) {
    return path.resolve(process.env.NEUTRALA_RUNTIME_CACHE_DIR);
  }
  return path.join(os.homedir(), '.neutrala', 'cache', 'runtime');
}

async function copyFileAtomic(srcPath, dstPath) {
  const tmp = `${dstPath}.${process.pid}.tmp`;
  await fs.copyFile(srcPath, tmp);
  try {
    await fs.unlink(dstPath);
  } catch {
    // ignore
  }
  try {
    await fs.rename(tmp, dstPath);
  } catch {
    await fs.copyFile(tmp, dstPath);
    try {
      await fs.unlink(tmp);
    } catch {
      // ignore
    }
  }
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

function downloadToFile(url, filePath) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          // GitHub API requires a UA; plain file downloads accept it too.
          'User-Agent': 'neutrala-runtime-manager',
          Accept: 'application/vnd.github+json',
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          resolve(downloadToFile(res.headers.location, filePath));
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Download failed (${res.statusCode}) for ${url}`));
          return;
        }

        pipeline(res, fssync.createWriteStream(filePath))
          .then(resolve)
          .catch(reject);
      },
    );
    req.on('error', reject);
  });
}

async function downloadToFileRetry(url, filePath, { retries = 3 } = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await downloadToFile(url, filePath);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(350 * attempt);
        continue;
      }
    }
  }
  throw lastErr || new Error(`Download failed for ${url}`);
}

async function isExecutable(filePath) {
  try {
    if (process.platform === 'win32') {
      await fs.access(filePath);
      return true;
    }
    await fs.access(filePath, fssync.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function runVersion(binaryPath) {
  const binaryDir = path.dirname(binaryPath);
  const tempConfig = path.join(binaryDir, 'neutralino.config.json');
  const tempNeu = path.join(binaryDir, 'resources.neu');
  const clientJs = path.join(binaryDir, 'neutralino.js');
  let createdConfig = false;
  let createdNeu = false;

  // 1. Try to read version from neutralino.js (fast and safe)
  try {
    const jsContent = await fs.readFile(clientJs, 'utf8');
    const match = /NL_CVERSION\s*=\s*["'](\d+\.\d+\.\d+)["']/.exec(jsContent);
    if (match) return match[1];
  } catch {
    // ignore
  }

  // 2. Try to get version from file metadata on Windows (avoids execution)
  if (process.platform === 'win32') {
    try {
      const psCmd = `powershell -NoProfile -Command "(Get-Item '${binaryPath}').VersionInfo.ProductVersion"`;
      const out = await new Promise((resolve) => {
        const p = spawn('powershell', ['-NoProfile', '-Command', `(Get-Item '${binaryPath}').VersionInfo.ProductVersion`], { windowsHide: true });
        let data = '';
        p.stdout.on('data', (d) => data += d.toString());
        p.on('close', () => resolve(data.trim()));
        p.on('error', () => resolve(''));
      });
      const match = /(\d+\.\d+\.\d+)/.exec(out);
      if (match) return match[1];
    } catch {
      // ignore
    }
  }

  // 3. Fallback to execution (risky on Windows due to WebView2 dependencies)
  try {
    await fs.access(tempConfig);
  } catch {
    try {
      await fs.writeFile(tempConfig, JSON.stringify({ applicationId: 'temp.version.check', modes: { window: { title: 'temp' } } }), 'utf8');
      createdConfig = true;
    } catch { }
  }

  try {
    await fs.access(tempNeu);
  } catch {
    try {
      await fs.writeFile(tempNeu, '', 'utf8');
      createdNeu = true;
    } catch { }
  }

  const result = await new Promise((resolve) => {
    const p = spawn(binaryPath, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      cwd: binaryDir,
    });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));
    const timer = setTimeout(() => p.kill(), 2000);
    p.on('close', () => {
      clearTimeout(timer);
      const match = /(\d+\.\d+\.\d+)/.exec(out) || /(\d+\.\d+\.\d+)/.exec(err);
      if (match) resolve(match[1]);
      else resolve(out.trim() || err.trim());
    });
    p.on('error', () => {
      clearTimeout(timer);
      resolve('');
    });
  });

  if (createdConfig) try { await fs.unlink(tempConfig); } catch { }
  if (createdNeu) try { await fs.unlink(tempNeu); } catch { }

  return result;
}

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  try {
    await fs.unlink(filePath);
  } catch {
    // ignore
  }
  await fs.rename(tmp, filePath);
}

export function getRuntimeInstallDir(resourcesDir, p = platformKey()) {
  return path.join(resourcesDir, 'neutrala-runtime', p);
}

export function getRuntimeManifestPath(resourcesDir) {
  return path.join(resourcesDir, 'neutrala-runtime', 'manifest.json');
}

async function listDirSafe(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function* walkFiles(dir, { maxDepth = 4, depth = 0 } = {}) {
  if (depth > maxDepth) return;
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkFiles(full, { maxDepth, depth: depth + 1 });
    } else if (e.isFile()) {
      yield full;
    }
  }
}

async function findCandidateNeutralinoBinary(installDir, p) {
  const entries = await listDirSafe(installDir);
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  const lower = files.map((f) => f.toLowerCase());

  if (p === 'windows') {
    const exact = files.find((f) => f.toLowerCase() === 'neutralino.exe');
    if (exact) return exact;
    const idx = lower.findIndex((n) => n.includes('neutralino') && n.endsWith('.exe'));
    return idx >= 0 ? files[idx] : null;
  }

  const exact = files.find((f) => f === 'neutralino');
  if (exact) return exact;
  const idx = lower.findIndex((n) => n.includes('neutralino') && !n.endsWith('.json') && !n.endsWith('.js'));
  return idx >= 0 ? files[idx] : null;
}

async function findNeutralinoBinaryPath(installDir, p) {
  const direct = await findCandidateNeutralinoBinary(installDir, p);
  if (direct) return path.join(installDir, direct);

  const candidates = [];
  for await (const filePath of walkFiles(installDir, { maxDepth: 4 })) {
    const name = path.basename(filePath).toLowerCase();
    if (p === 'windows') {
      if (name.includes('neutralino') && name.endsWith('.exe')) candidates.push(filePath);
      continue;
    }
    if (name === 'neutralino' || (name.includes('neutralino') && !name.endsWith('.js') && !name.endsWith('.json'))) {
      candidates.push(filePath);
    }
  }

  candidates.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return candidates[0] || null;
}

async function hasRuntimeSupportFiles(installDir) {
  const entries = await listDirSafe(installDir);
  const names = new Set(entries.map((e) => e.name.toLowerCase()));

  // Direct check for standard files or any neutralino binary
  if (names.has('neutralino.js') || names.has('resources') || names.has('webview') || names.has('webview2')) return true;
  for (const name of names) {
    if (name.includes('neutralino') && (name.endsWith('.exe') || !name.includes('.'))) return true;
  }

  // Fallback to recursive walk if needed
  for await (const filePath of walkFiles(installDir, { maxDepth: 4 })) {
    const name = path.basename(filePath).toLowerCase();
    if (name === 'neutralino.js' || name.includes('webview') || name.endsWith('.app')) return true;
    if (name.includes('neutralino') && (name.endsWith('.exe') || !name.includes('.'))) return true;
  }

  return false;
}

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'neutrala-runtime-manager',
          Accept: 'application/vnd.github+json',
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          resolve(httpsGetJson(res.headers.location));
          return;
        }
        if (res.statusCode !== 200) {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (body += c));
          res.on('end', () =>
            reject(new Error(`HTTP ${res.statusCode} for ${url}${body ? `: ${body.slice(0, 300)}` : ''}`)),
          );
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
  });
}

async function httpsGetJsonRetry(url, { retries = 3 } = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await httpsGetJson(url);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(250 * attempt);
        continue;
      }
    }
  }
  throw lastErr || new Error(`HTTP request failed for ${url}`);
}

function pickReleaseAsset({ assets, p, arch, preferExts = [] }) {
  const platformHints =
    p === 'windows'
      ? ['win', 'windows']
      : p === 'mac'
        ? ['mac', 'macos', 'osx', 'darwin']
        : ['linux'];

  const archHints = arch === 'arm64' ? ['arm64', 'aarch64'] : ['x64', 'amd64'];

  const candidates = (assets || [])
    .filter((a) => a && a.name && a.browser_download_url)
    .map((a) => ({ name: String(a.name), url: String(a.browser_download_url) }))
    .filter((a) => {
      const n = a.name.toLowerCase();
      const platformOk = platformHints.some((h) => n.includes(h));
      const archOk = archHints.some((h) => n.includes(h));
      const archiveOk = n.endsWith('.zip') || n.endsWith('.tar.gz') || n.endsWith('.tgz');

      // Special case for universal v6+ bundles: neutralinojs-vX.Y.Z.zip
      const isUniversal = n.startsWith('neutralinojs-v') && n.endsWith('.zip') && !n.includes('win') && !n.includes('linux') && !n.includes('mac');

      return (platformOk && archOk && archiveOk) || (isUniversal && archiveOk);
    });

  if (!candidates.length) return null;

  const score = (name) => {
    const n = name.toLowerCase();
    let s = 0;
    for (const ext of preferExts) if (n.endsWith(ext)) s += 10;

    // Prioritize platform-specific bundles over universal ones.
    // Platform bundles (e.g. neutralino-win_x64.zip) contain required DLLs/libs.
    if (platformHints.some(h => n.includes(h))) s += 20;

    if (n.includes('neutralino')) s += 2;
    if (n.includes('neutralinojs')) s += 1;
    if (n.includes('minimal')) s -= 1;
    return s;
  };

  candidates.sort((a, b) => score(b.name) - score(a.name) || a.name.localeCompare(b.name));
  return candidates[0];
}

async function runCommand(cmd, args, { cwd, env } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...(env || {}) },
      stdio: 'pipe',
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (out += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out.trim());
      else {
        const err = new Error(`${cmd} ${args.join(' ')} exited with code ${code}. ${out.trim()}`);
        err.code = code;
        reject(err);
      }
    });
  });
}

async function ensureNeutralinoJs({ installDir, version } = {}) {
  try {
    const targetPath = path.join(installDir, 'neutralino.js');
    try {
      await fs.access(targetPath);
      return targetPath;
    } catch {
      // continue
    }

    const repo = DEFAULT_NEUTRALINO_JS_REPO;
    const releaseApiUrl = version
      ? `https://api.github.com/repos/${repo}/releases/tags/v${String(version).replace(/^v/, '')}`
      : `https://api.github.com/repos/${repo}/releases/latest`;

    const release = await httpsGetJsonRetry(releaseApiUrl);
    const assets = release?.assets || [];
    const asset = assets.find((a) => String(a?.name || '').toLowerCase() === 'neutralino.js');
    if (!asset?.browser_download_url) return null;

    const tmp = `${targetPath}.${process.pid}.tmp`;
    await downloadToFileRetry(asset.browser_download_url, tmp);
    try {
      await fs.unlink(targetPath);
    } catch {
      // ignore
    }
    try {
      await fs.rename(tmp, targetPath);
    } catch {
      await fs.copyFile(tmp, targetPath);
      try {
        await fs.unlink(tmp);
      } catch {
        // ignore
      }
    }
    return targetPath;
  } catch {
    return null;
  }
}

async function downloadRuntimeViaNeu({ resourcesDir, platform, version } = {}) {
  const installDir = getRuntimeInstallDir(resourcesDir, platform);
  await fs.rm(installDir, { recursive: true, force: true });
  await fs.mkdir(installDir, { recursive: true });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `neutrala-neu-${platform}-`));
  const tmpResources = path.join(tmpDir, 'resources');
  await fs.mkdir(tmpResources, { recursive: true });
  await fs.writeFile(path.join(tmpResources, 'index.html'), '<!doctype html><title>neutrala</title>\n', 'utf8');
  await fs.writeFile(
    path.join(tmpDir, 'neutralino.config.json'),
    JSON.stringify(
      {
        applicationId: 'com.neutrala.runtimefetch',
        version: '0.0.0',
        defaultMode: 'window',
        port: 0,
        url: '/index.html',
        enableServer: true,
        enableNativeAPI: true,
        nativeAllowList: ['app.', 'os.', 'filesystem.', 'debug.log'],
      },
      null,
      2,
    ),
    'utf8',
  );

  const neuCmd = process.env.NEUTRALA_NEU_BIN || 'neu';
  try {
    if (version) {
      try {
        await runCommand(neuCmd, ['update', '--runtime-version', String(version)], { cwd: tmpDir });
      } catch {
        await runCommand(neuCmd, ['update'], { cwd: tmpDir });
      }
    } else {
      await runCommand(neuCmd, ['update'], { cwd: tmpDir });
    }
  } catch (err) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    throw err;
  }

  const binDir = path.join(tmpDir, 'bin');
  try {
    await fs.access(binDir);
  } catch {
    await fs.rm(tmpDir, { recursive: true, force: true });
    throw new Error(`neu update did not produce a bin/ directory in ${tmpDir}`);
  }

  // Copy downloaded runtime bits to installDir.
  const copyDir = async (src, dst) => {
    await fs.mkdir(dst, { recursive: true });
    const ents = await fs.readdir(src, { withFileTypes: true });
    for (const e of ents) {
      const s = path.join(src, e.name);
      const d = path.join(dst, e.name);
      if (e.isDirectory()) await copyDir(s, d);
      else await fs.copyFile(s, d);
    }
  };
  await copyDir(binDir, installDir);

  // Add Neutralino client library for the frontend to load (`/neutralino.js`).
  await ensureNeutralinoJs({ installDir, version: version || undefined });

  await fs.rm(tmpDir, { recursive: true, force: true });
  return { platform, installDir, mode: 'neu' };
}

async function tryDownloadSha256ForAsset({ assetUrl, dlDir, archiveName }) {
  // Best-effort: many releases include a sibling "<asset>.sha256" file.
  const candidates = [`${assetUrl}.sha256`, `${assetUrl}.sha256sum`, `${assetUrl}.sha256.txt`];
  for (const u of candidates) {
    try {
      const tmp = path.join(dlDir, `${archiveName}.sha256.tmp.${process.pid}`);
      await downloadToFile(u, tmp);
      const text = await fs.readFile(tmp, 'utf8');
      await fs.rm(tmp, { force: true });

      const m = /([a-fA-F0-9]{64})/.exec(text);
      if (m) return m[1].toLowerCase();
    } catch {
      // try next
    }
  }
  return null;
}

export async function detectRuntime({ resourcesDir, supportedRange = DEFAULT_SUPPORTED_RANGE } = {}) {
  if (!resourcesDir) throw new Error('detectRuntime: resourcesDir is required');
  const p = platformKey();
  const installDir = getRuntimeInstallDir(resourcesDir, p);
  const manifestPath = getRuntimeManifestPath(resourcesDir);
  const manifest = (await readJson(manifestPath)) || {};

  const manifestBinaryName = manifest?.platforms?.[p]?.binaryName || null;
  const binaryPath =
    manifestBinaryName
      ? path.join(installDir, manifestBinaryName)
      : (await findNeutralinoBinaryPath(installDir, p)) ||
      path.join(installDir, p === 'windows' ? 'neutralino.exe' : 'neutralino');

  if (!(await isExecutable(binaryPath))) {
    return {
      ok: false,
      reason: 'missing-or-not-executable',
      platform: p,
      installDir,
      binaryPath,
      supportedRange,
    };
  }

  if (!(await hasRuntimeSupportFiles(installDir))) {
    return {
      ok: false,
      reason: 'missing-support-files',
      platform: p,
      installDir,
      binaryPath,
      supportedRange,
    };
  }

  const versionOutput = await runVersion(binaryPath);
  const versionMatch = /(\d+\.\d+\.\d+)/.exec(versionOutput);
  const version = versionMatch ? versionMatch[1] : null;
  if (!version || !satisfiesRange(version, supportedRange)) {
    return {
      ok: false,
      reason: 'unsupported-version',
      platform: p,
      installDir,
      binaryPath,
      versionOutput,
      supportedRange,
    };
  }

  return {
    ok: true,
    platform: p,
    installDir,
    binaryPath,
    version,
    versionOutput,
  };
}

export async function downloadRuntime({ resourcesDir, baseUrl, url, sha256, downloadDir, version } = {}) {
  if (!resourcesDir) throw new Error('downloadRuntime: resourcesDir is required');
  const p = platformKey();
  const arch = archKey();

  const manifestPath = getRuntimeManifestPath(resourcesDir);
  const manifest = (await readJson(manifestPath)) || {};
  const platformManifest = manifest?.platforms?.[p] || {};

  const resolvedVersion =
    version ||
    process.env.NEUTRALA_RUNTIME_VERSION ||
    manifest.neutralinoVersion ||
    manifest.runtimeVersion ||
    null;

  const resolvedSha256 =
    sha256 ||
    process.env[`NEUTRALA_RUNTIME_SHA256_${p.toUpperCase()}`] ||
    process.env.NEUTRALA_RUNTIME_SHA256 ||
    platformManifest.sha256;

  const vars = { version: resolvedVersion, platform: p, arch };

  const archiveNameTemplate =
    platformManifest.archiveName ||
    // Default (override in manifest if your runtime host uses different names):
    // neutralinojs-v{version}-{platform}_{arch}.zip  (common on GitHub)
    'neutralinojs-v{version}-{platform}_{arch}.zip';
  const archiveName = interpolate(archiveNameTemplate, vars);

  const envUrl =
    process.env[`NEUTRALA_RUNTIME_URL_${p.toUpperCase()}`] ||
    process.env.NEUTRALA_RUNTIME_URL ||
    null;

  const envBaseUrl = baseUrl || process.env.NEUTRALA_RUNTIME_BASE_URL || platformManifest.baseUrl || null;
  const resolvedBaseUrl = envBaseUrl ? interpolate(envBaseUrl, vars) : null;

  let resolvedUrl =
    url ||
    envUrl ||
    (resolvedBaseUrl ? new URL(archiveName, resolvedBaseUrl).toString() : null) ||
    platformManifest.url ||
    null;

  // Detect unresolved template variables (encoded or not).
  const unresolvedVarRe = /(\{|\%7B)(version|platform|arch)(\}|\%7D)/i;
  if (resolvedUrl && unresolvedVarRe.test(resolvedUrl)) {
    throw new Error(
      `Neutrala runtime URL is missing required template variables (version/platform/arch). Set NEUTRALA_RUNTIME_VERSION or provide an explicit NEUTRALA_RUNTIME_URL_${p.toUpperCase()}.`,
    );
  }

  const dlDir = downloadDir || path.join(resourcesDir, 'neutrala-runtime', '_downloads');
  await fs.mkdir(dlDir, { recursive: true });

  // If no explicit URL is provided, prefer the official `neu update` workflow to fetch runtime binaries.
  if (!resolvedUrl && process.env.NEUTRALA_RUNTIME_NO_NEU !== 'true') {
    try {
      const result = await downloadRuntimeViaNeu({ resourcesDir, platform: p, version: resolvedVersion || undefined });
      return {
        mode: 'neu',
        platform: p,
        arch,
        version: resolvedVersion || process.env.NEUTRALA_RUNTIME_VERSION || null,
        installDir: result.installDir,
        url: 'neu update',
        verified: false,
      };
    } catch (err) {
      // Fall back to direct URL / GitHub discovery below if neu isn't available.
      if (process.env.NEUTRALA_RUNTIME_NEU_REQUIRED === 'true') throw err;
    }
  }

  // If URL isn't explicitly configured, try GitHub release discovery.
  if (!resolvedUrl) {
    const repo = manifest?.release?.repo || manifest?.repo || DEFAULT_RELEASE_REPO;
    const tagPrefix = manifest?.release?.tagPrefix || DEFAULT_TAG_PREFIX;

    // If no version is configured, fall back to latest release.
    const releaseApiUrl = resolvedVersion
      ? `https://api.github.com/repos/${repo}/releases/tags/${tagPrefix}${resolvedVersion}`
      : `https://api.github.com/repos/${repo}/releases/latest`;

    const release = await httpsGetJsonRetry(releaseApiUrl);
    const tagName = String(release?.tag_name || '').trim();
    const inferredVersion = /(\d+\.\d+\.\d+)/.exec(tagName)?.[1] || null;
    const effectiveVersion = resolvedVersion || inferredVersion;

    const asset = pickReleaseAsset({
      assets: release?.assets,
      p,
      arch,
      preferExts: p === 'windows' ? ['.zip'] : ['.tar.gz', '.tgz', '.zip'],
    });
    if (!asset) {
      throw new Error(
        `Could not find a Neutralino runtime asset for ${p}/${arch} in ${repo} ${resolvedVersion ? `${tagPrefix}${resolvedVersion}` : 'latest'}.`,
      );
    }
    resolvedUrl = asset.url;

    // Persist inferred version for logging/metadata.
    if (!process.env.NEUTRALA_RUNTIME_VERSION && effectiveVersion) {
      process.env.NEUTRALA_RUNTIME_VERSION = effectiveVersion;
    }
  }

  const finalArchiveName = path.basename(new URL(resolvedUrl).pathname) || archiveName;
  const archivePath = path.join(dlDir, finalArchiveName);
  const tmpPath = `${archivePath}.${process.pid}.tmp`;

  const offline = process.env.NEUTRALA_RUNTIME_OFFLINE === 'true';
  const cacheDir = globalRuntimeCacheDir();
  await fs.mkdir(cacheDir, { recursive: true });
  const cachedArchivePath = path.join(cacheDir, finalArchiveName);

  if (!(await fileExists(archivePath))) {
    if (await fileExists(cachedArchivePath)) {
      await copyFileAtomic(cachedArchivePath, archivePath);
    } else {
      if (offline) {
        throw new Error(
          `NEUTRALA_RUNTIME_OFFLINE=true but runtime archive is not cached: ${cachedArchivePath}`,
        );
      }
      await downloadToFileRetry(resolvedUrl, tmpPath);
      try {
        await fs.unlink(archivePath);
      } catch {
        // ignore
      }
      await fs.rename(tmpPath, archivePath);
      // Best-effort: populate global cache for future offline builds.
      try {
        await copyFileAtomic(archivePath, cachedArchivePath);
        const meta = {
          cachedAt: new Date().toISOString(),
          archiveName: finalArchiveName,
          url: resolvedUrl,
          platform: p,
          arch,
          version: resolvedVersion || process.env.NEUTRALA_RUNTIME_VERSION || null,
        };
        await writeJsonAtomic(path.join(cacheDir, `${finalArchiveName}.json`), meta);
      } catch {
        // ignore
      }
    }
  }

  let shaToCheck = resolvedSha256 ? String(resolvedSha256).toLowerCase() : null;
  if (!shaToCheck && process.env.NEUTRALA_RUNTIME_SKIP_VERIFY !== 'true') {
    shaToCheck = await tryDownloadSha256ForAsset({
      assetUrl: resolvedUrl,
      dlDir,
      archiveName: finalArchiveName,
    });
  }

  if (shaToCheck && process.env.NEUTRALA_RUNTIME_SKIP_VERIFY !== 'true') {
    const actual = await sha256File(archivePath);
    if (actual.toLowerCase() !== shaToCheck) {
      try {
        await fs.unlink(archivePath);
      } catch {
        // ignore
      }
      // If we used the cached archive and it's bad, remove it so next run can re-fetch.
      try {
        await fs.unlink(cachedArchivePath);
      } catch {
        // ignore
      }
      throw new Error(
        `Checksum mismatch for Neutrala runtime archive. expected=${shaToCheck} actual=${actual}`,
      );
    }
  }

  return {
    mode: 'archive',
    platform: p,
    arch,
    version: resolvedVersion || process.env.NEUTRALA_RUNTIME_VERSION || null,
    archivePath,
    archiveName: finalArchiveName,
    url: resolvedUrl,
    verified: !!shaToCheck && process.env.NEUTRALA_RUNTIME_SKIP_VERIFY !== 'true',
  };
}

export async function extractRuntime({ resourcesDir, archivePath } = {}) {
  if (!resourcesDir) throw new Error('extractRuntime: resourcesDir is required');
  if (!archivePath) throw new Error('extractRuntime: archivePath is required');

  const p = platformKey();
  const installDir = getRuntimeInstallDir(resourcesDir, p);
  const parentDir = path.dirname(installDir);
  await fs.mkdir(parentDir, { recursive: true });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `neutrala-runtime-${p}-`));
  const stagingDir = path.join(tmpDir, 'runtime');
  await fs.mkdir(stagingDir, { recursive: true });

  if (archivePath.endsWith('.zip')) {
    const extractZip = (await import('extract-zip')).default;
    await extractZip(archivePath, { dir: stagingDir });
  } else if (archivePath.endsWith('.tar.gz')) {
    const tarMod = await import('tar');
    const tar = tarMod.default ?? tarMod;
    await tar.x({ file: archivePath, cwd: stagingDir });
  } else {
    throw new Error(`Unsupported runtime archive format: ${archivePath}`);
  }

  // Flatten if archive contains a single top-level directory.
  const entries = await fs.readdir(stagingDir, { withFileTypes: true });
  const sourceRoot =
    entries.length === 1 && entries[0].isDirectory()
      ? path.join(stagingDir, entries[0].name)
      : stagingDir;

  const finalTmp = `${installDir}.${process.pid}.staging`;
  await fs.rm(finalTmp, { recursive: true, force: true });
  await fs.mkdir(finalTmp, { recursive: true });

  const copyDir = async (src, dst) => {
    await fs.mkdir(dst, { recursive: true });
    const ents = await fs.readdir(src, { withFileTypes: true });
    for (const e of ents) {
      const s = path.join(src, e.name);
      const d = path.join(dst, e.name);
      if (e.isDirectory()) await copyDir(s, d);
      else await fs.copyFile(s, d);
    }
  };
  await copyDir(sourceRoot, finalTmp);

  // If this is a universal bundle, rename the appropriate platform binary to the generic name.
  const binName = await findCandidateNeutralinoBinary(finalTmp, p);
  const standardName = p === 'windows' ? 'neutralino.exe' : 'neutralino';
  if (binName && binName !== standardName) {
    try {
      await fs.rename(path.join(finalTmp, binName), path.join(finalTmp, standardName));
    } catch {
      // ignore
    }
  }

  await fs.rm(installDir, { recursive: true, force: true });
  await fs.rename(finalTmp, installDir);
  await fs.rm(tmpDir, { recursive: true, force: true });

  // Best-effort executable bit for the runtime binary on POSIX.
  try {
    const manifest = (await readJson(getRuntimeManifestPath(resourcesDir))) || {};
    const manifestBinaryName = manifest?.platforms?.[p]?.binaryName || null;
    const binPath = manifestBinaryName
      ? path.join(installDir, manifestBinaryName)
      : await findNeutralinoBinaryPath(installDir, p);
    if (binPath && process.platform !== 'win32') await fs.chmod(binPath, 0o755);
  } catch {
    // ignore
  }

  return { platform: p, installDir };
}

export async function verifyRuntime({ resourcesDir, supportedRange = DEFAULT_SUPPORTED_RANGE } = {}) {
  const detection = await detectRuntime({ resourcesDir, supportedRange });
  if (!detection.ok) throw new Error(`Neutrala runtime invalid: ${detection.reason}`);
  return detection;
}

export async function ensureRuntime({ resourcesDir, supportedRange = DEFAULT_SUPPORTED_RANGE } = {}) {
  const current = await detectRuntime({ resourcesDir, supportedRange });
  if (current.ok) return current;

  const downloaded = await downloadRuntime({ resourcesDir });
  if (downloaded.mode === 'archive') {
    await extractRuntime({ resourcesDir, archivePath: downloaded.archivePath });
  }

  // Ensure `neutralino.js` is present BEFORE validation, as validation might be strict about support files.
  try {
    const detectionPlaceholder = await detectRuntime({ resourcesDir, supportedRange });
    await ensureNeutralinoJs({ installDir: detectionPlaceholder.installDir, version: detectionPlaceholder.version || undefined });
  } catch {
    // ignore
  }

  const verified = await verifyRuntime({ resourcesDir, supportedRange });
  return verified;
}

export async function getRuntimeBinary({ resourcesDir } = {}) {
  const info = await ensureRuntime({ resourcesDir });
  return info.binaryPath;
}

export async function registerRuntimeEnv({ resourcesDir } = {}) {
  const info = await ensureRuntime({ resourcesDir });
  process.env.NEUTRALA_RUNTIME_PLATFORM = info.platform;
  process.env.NEUTRALA_RUNTIME_DIR = info.installDir;
  process.env.NEUTRALA_RUNTIME_BIN = info.binaryPath;
  return info;
}
