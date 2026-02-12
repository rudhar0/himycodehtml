/* global Neutralino */

// Desktop bootstrap for Neutralino:
// - Reuse an existing backend via backend/.runtime/port.json + /api/health
// - Otherwise start the backend and wait until healthy
// - Expose runtime URLs as globals for the web app
//
// In normal browser dev, this file is still loaded but becomes a no-op.

(function () {
  const LOG_PREFIX = '[neutrala][bootstrap]';

  function log(...args) {
    try {
      // eslint-disable-next-line no-console
      console.log(LOG_PREFIX, ...args);
    } catch {
      // ignore
    }
  }

  function warn(...args) {
    try {
      // eslint-disable-next-line no-console
      console.warn(LOG_PREFIX, ...args);
    } catch {
      // ignore
    }
  }

  function setSplashStatus(text) {
    try {
      const el = document.getElementById('neutrala-splash-status');
      if (el) el.textContent = String(text || '');
    } catch {
      // ignore
    }
  }

  function isNeutralino() {
    return typeof Neutralino !== 'undefined' && Neutralino && typeof Neutralino.init === 'function';
  }

  async function withTimeout(promise, timeoutMs, label) {
    const ms = Number(timeoutMs);
    if (!Number.isFinite(ms) || ms <= 0) return await promise;
    let t = null;
    const timeout = new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(`Timed out after ${ms}ms${label ? ` (${label})` : ''}`)), ms);
    });
    try {
      // eslint-disable-next-line no-undef
      return await Promise.race([promise, timeout]);
    } finally {
      if (t) clearTimeout(t);
    }
  }

  function detectSeparator(p) {
    return String(p || '').includes('\\') ? '\\' : '/';
  }

  function dirname(p) {
    const s = String(p || '');
    const sep = detectSeparator(s);
    const i = s.lastIndexOf(sep);
    return i >= 0 ? s.slice(0, i) : s;
  }

  function join() {
    const parts = Array.prototype.slice.call(arguments).filter(Boolean).map(String);
    if (!parts.length) return '';
    const sep = detectSeparator(parts[0]);
    const cleaned = [];
    for (const part of parts) {
      const normalized = part.replace(/[\\/]+/g, sep).replace(new RegExp(`^${sep}+`), '');
      cleaned.push(normalized);
    }
    const first = parts[0].replace(/[\\/]+/g, sep);
    const isAbsWin = /^[a-zA-Z]:\\/.test(first);
    const isAbsPosix = first.startsWith('/');
    const prefix = isAbsWin ? first.slice(0, 3) : isAbsPosix ? sep : '';

    const rest =
      parts.length === 1
        ? first
        : cleaned.join(sep);
    return prefix ? prefix + rest.replace(new RegExp(`^${sep}+`), '') : rest;
  }

  async function sleep(ms) {
    return await new Promise((r) => setTimeout(r, ms));
  }

  async function fetchJsonWithTimeout(url, timeoutMs) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = setTimeout(() => ctrl?.abort?.(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl?.signal });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  async function readPortJson(portJsonPath) {
    try {
      const raw = await Neutralino.filesystem.readFile(portJsonPath);
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async function existsFile(filePath) {
    try {
      await Neutralino.filesystem.readFile(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async function isBackendHealthy(baseUrl) {
    try {
      const health = await fetchJsonWithTimeout(`${baseUrl}/api/health`, 1200);
      return !!(health && health.status === 'ok');
    } catch (e) {
      log(`Health check failed for ${baseUrl}:`, e?.message || String(e));
      return false;
    }
  }

  function setRuntimeUrls(baseUrl) {
    globalThis.__NEUTRALA_API_URL = baseUrl;
    globalThis.__NEUTRALA_SOCKET_URL = baseUrl;
    log(`Runtime URLs configured: API=${baseUrl}, SOCKET=${baseUrl}`);
  }

  async function resolveBackendBaseUrl({ backendDir }) {
    const portJsonPath = join(backendDir, '.runtime', 'port.json');
    log(`Attempting to read port from: ${portJsonPath}`);
    const info = await readPortJson(portJsonPath);

    if (!info) {
      log(`Port file not found or unreadable at ${portJsonPath}`);
      return null;
    }

    const port = Number(info?.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      warn(`Invalid port in port.json: ${String(info?.port)}`);
      return null;
    }

    const baseUrl = `http://127.0.0.1:${port}`;
    log(`Checking backend health at ${baseUrl}...`);
    if (await isBackendHealthy(baseUrl)) {
      log(`✓ Backend at ${baseUrl} is healthy`);
      return baseUrl;
    }

    warn(`✗ Backend at ${baseUrl} is not responding to health checks`);
    return null;
  }

  async function startBackend({ backendDir }) {
    const sep = detectSeparator(backendDir);
    const isWindows = sep === '\\';

    // Try multiple backend binary names (in order of preference)
    // The build script produces: <safeName>-backend<.exe>
    // For development, look for CommonJS transpiled or original server.js
    const candidates = [
      join(backendDir, isWindows ? 'codeviz-backend.exe' : 'codeviz-backend'),
      join(backendDir, isWindows ? 'codeviz-server.exe' : 'codeviz-server'),
      join(backendDir, isWindows ? 'server.exe' : 'server'),
    ];

    let backendExe = null;
    for (const c of candidates) {
      if (await existsFile(c)) {
        backendExe = c;
        log(`Found backend binary: ${c}`);
        break;
      }
    }

    // Fallback to node src/server.js for development
    const startCmd = isWindows
      ? backendExe
        ? `cmd /c "start "" /B "${backendExe}""`
        : `cmd /c (cd /d "${backendDir}" && start "" /B node src\\\\server.js)`
      : backendExe
        ? `"${backendExe}" >/dev/null 2>&1 &`
        : `sh -c 'cd "${backendDir}" && node src/server.js >/dev/null 2>&1 &'`;

    log(`Starting backend with command: ${startCmd}`);
    await Neutralino.os.execCommand({ command: startCmd });
    await sleep(500); // Give the process time to start
  }

  async function waitForBackend({ backendDir, timeoutMs }) {
    const startedAt = Date.now();
    let lastError = null;
    while (Date.now() - startedAt < timeoutMs) {
      try {
        const baseUrl = await resolveBackendBaseUrl({ backendDir });
        if (baseUrl) return baseUrl;
      } catch (e) {
        lastError = e;
      }
      await sleep(250);
    }
    warn(`Timeout waiting for backend (${timeoutMs}ms)`, lastError?.message || '');
    return null;
  }

  async function desktopBootstrap() {
    // Ensure neutralino.js has been loaded (see public/neutralino-loader.js).
    try {
      const loaded = await withTimeout(
        globalThis.__NEUTRALA_NEUTRALINO_READY__?.catch(() => false) ?? Promise.resolve(false),
        6000,
        'neutralino-loader',
      );
      if (!loaded) {
        // Not in Neutralino (or injection failed). Still allow the web UI to mount.
        log('Neutralino not available; skipping desktop bootstrap');
        return;
      }
    } catch (e) {
      warn('Failed waiting for Neutralino readiness; continuing without native API:', e);
      return;
    }

    if (!isNeutralino()) {
      log('Neutralino globals missing after loader; skipping desktop bootstrap');
      return;
    }

    try {
      Neutralino.init();
    } catch {
      // ignore
    }

    // Ensure the window title is branded even if config defaults leak through.
    try {
      await Neutralino.window?.setTitle?.('CodeViz');
    } catch {
      // ignore
    }

    // Multi-window scaffolding for desktop builds.
    // Exposed as `window.neutrala.openWindow(url)` and `window.neutrala.openNewWindow()`.
    globalThis.neutrala = globalThis.neutrala || {};
    globalThis.neutrala.openWindow = async (url, options) => {
      if (!isNeutralino()) throw new Error('Neutralino is not available in this environment.');
      if (!Neutralino.window || typeof Neutralino.window.create !== 'function') {
        throw new Error('Neutralino.window.create is unavailable (check nativeAllowList includes "window.").');
      }
      const targetUrl = url || globalThis.location?.href || '/index.html';
      const opts = options && typeof options === 'object' ? options : {};
      return await Neutralino.window.create(targetUrl, opts);
    };
    globalThis.neutrala.openNewWindow = async () => {
      const defaultOpts = { width: 1280, height: 800, enableInspector: true };
      return await globalThis.neutrala.openWindow?.(globalThis.location?.href, defaultOpts);
    };

    // NL_PATH points to the Neutralino executable; we compute bundle root from that.
    let nlPath = '';
    try {
      // Prefer injected global (most reliable). Fallback to env var.
      nlPath = String(globalThis.NL_PATH || '');
      if (!nlPath) nlPath = await Neutralino.os.getEnv('NL_PATH');
    } catch {
      // ignore
    }

    // Fix 6: NL_PATH fallback
    let appDir = '';
    try {
      const config = await Neutralino.app.getConfig();
      appDir = config?.dataPath || dirname(nlPath || '');
    } catch {
      appDir = dirname(nlPath || '');
    }

    // Packaged layout: <root>/desktop/<exe> and <root>/backend/...
    // neu dev layout (Windows): <repo>/desktop/bin/neutralino-win_x64.exe -> backend is 2 levels up.
    const candidates = [
      join(appDir, '..', 'backend'),
      join(appDir, '..', '..', 'backend'),
      join(appDir, 'backend'), // Compact layout
    ];
    let backendDir = candidates[0];
    for (const c of candidates) {
      log(`Checking backend candidate: ${c}`);
      if (await existsFile(join(c, 'package.json')) || await existsFile(join(c, 'src', 'server.js'))) {
        backendDir = c;
        break;
      }
    }

    log('Detected appDir:', appDir || '(unknown)');
    log('Using backendDir:', backendDir);

    // Reuse existing backend if healthy.
    const existing = await resolveBackendBaseUrl({ backendDir });
    if (existing) {
      log('Backend reused:', existing);
      setSplashStatus(`Connected to backend: ${existing}`);
      setRuntimeUrls(existing);
      return;
    }

    // Otherwise start and wait.
    setSplashStatus('Starting backend…');
    await startBackend({ backendDir });
    setSplashStatus('Waiting for backend health…');
    const baseUrl = await waitForBackend({ backendDir, timeoutMs: 20000 });
    if (!baseUrl) {
      throw new Error('Backend failed to start (timeout waiting for /api/health)');
    }
    log('Backend ready:', baseUrl);
    setSplashStatus(`Connected to backend: ${baseUrl}`);
    setRuntimeUrls(baseUrl);
  }

  // Expose a hook awaited by src/main.tsx before rendering.
  globalThis.__NEUTRALA_BOOTSTRAP__ = async () => {
    try {
      log('Frontend URL resolved:', globalThis.location?.href || '(no location)');
      try {
        globalThis.addEventListener?.('load', () => log('Neutralino window loaded'));
      } catch {
        // ignore
      }

      // Fix 6: NL_PATH fallback
      if (isNeutralino()) {
        try {
          const config = await Neutralino.app.getConfig();
          if (config?.dataPath) {
            log('Using config.dataPath as fallback appDir root');
            // We'll use this inside desktopBootstrap if NL_PATH fails or is weird
          }
        } catch (e) {
          warn('Failed to get Neutralino config:', e);
        }
      }

      await desktopBootstrap();
      globalThis.__NEUTRALA_BOOTSTRAP_INFO__ = {
        ok: true,
        ts: new Date().toISOString(),
        apiUrl: globalThis.__NEUTRALA_API_URL || null,
        socketUrl: globalThis.__NEUTRALA_SOCKET_URL || null,
      };
      log('Bootstrap complete:', globalThis.__NEUTRALA_BOOTSTRAP_INFO__);
    } catch (e) {
      // Desktop startup errors should be visible but not white-screen the UI.
      // eslint-disable-next-line no-console
      console.error('[neutrala-bootstrap] failed:', e);
      globalThis.__NEUTRALA_BOOTSTRAP_INFO__ = {
        ok: false,
        ts: new Date().toISOString(),
        error: e?.message || String(e),
      };
    }
  };
})();
