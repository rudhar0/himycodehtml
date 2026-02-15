// Neutralino loader shim:
// - In Neutralino: loads /neutralino.js (official client library) and exposes a readiness promise.
// - In a normal browser: no-ops (prevents noisy connection errors / document.write overrides).
//
// This exists because Vite dev always serves /public assets, but Neutralino-specific JS must not run in the browser.

(function () {
  const log = (...args) => {
    try {
      // eslint-disable-next-line no-console
      console.log('[neutrala][neutralino-loader]', ...args);
    } catch {
      // ignore
    }
  };

  function hasNeutralinoInjection() {
    // These globals are injected by Neutralino core before scripts execute.
    return (
      typeof globalThis !== 'undefined' &&
      typeof globalThis.NL_PORT !== 'undefined' &&
      typeof globalThis.NL_TOKEN === 'string' &&
      globalThis.NL_TOKEN.length > 0
    );
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = () => resolve(true);
      s.onerror = (e) => reject(e || new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  }

  const ready = (async () => {
    let retries = 10;
    while (retries-- > 0) {
      if (hasNeutralinoInjection()) break;
      await new Promise(r => setTimeout(r, 100)); // wait 100ms
    }

    if (!hasNeutralinoInjection()) {
      const nlKeys = Object.keys(globalThis).filter(k => k.startsWith('NL_'));
      log('No injection detected initially. Keys found:', nlKeys);
      // Fallback: If running in the actual Neutralino app (file:// or specific user agent), 
      // we should try loading the script anyway.
      const isNeutralinoUserAgent = navigator.userAgent.includes('Neutralino');
      const isFileProtocol = window.location.protocol === 'file:';
      const isResourcePath = window.location.pathname.includes('/resources/'); // Common in Neutralino serve mode

      if (!isNeutralinoUserAgent && !isFileProtocol && !isResourcePath) {
        log('Warning: Not running in standard Neutralino environment (UA/file/resources mismatch), but attempting to load neutralino.js anyway to support portable mode.');
        // Previously returned false here, now we proceed to try loading the script.
      } else {
        log('Environment looks like Neutralino (UA, file://, or path). Attempting to load neutralino.js...');
      }
    }

    if (typeof globalThis.Neutralino !== 'undefined') {
      log('Neutralino already present');
      return true;
    }

    // Fix: use relative path for portability
    log('Loading ./neutralino.js…');
    try {
      await loadScript('./neutralino.js');
    } catch (e) {
      log('Failed to load neutralino.js:', e);
      return false;
    }

    if (typeof globalThis.Neutralino === 'undefined') {
      // It might be that neutralino.js loaded but didn't initialize globals yet?
      // Or we are just in a browser that successfully loaded a 404 page as "script".
      log('neutralino.js loaded but globalThis.Neutralino is undefined. Possible 404 or bad script.');
      return false;
    }

    log('neutralino.js ready');

    // If still no injection (dev mode), try fetching auth_info.json
    // If still no injection (dev mode), try fetching auth_info.json with retries
    if (!hasNeutralinoInjection()) {
      log('No injection found. Polling for auth_info.json (dev mode)...');

      const fetchAuth = async () => {
        try {
          const res = await fetch('/auth_info.json');
          if (!res.ok) return false;

          // Verify it's actually JSON and not index.html (SPA fallback)
          const type = res.headers.get('content-type');
          if (type && type.includes('text/html')) return false;

          const auth = await res.json();
          globalThis.NL_PORT = auth.nlPort;
          globalThis.NL_TOKEN = auth.nlToken;
          globalThis.NL_ConnectToken = auth.nlConnectToken;
          globalThis.NL_ARGS = [];
          log('Loaded auth info from file:', auth);
          return true;
        } catch (e) {
          return false;
        }
      };

      // Poll for up to 5 seconds
      for (let i = 0; i < 25; i++) {
        if (await fetchAuth()) break;
        await new Promise(r => setTimeout(r, 200));
      }

      if (!hasNeutralinoInjection()) {
        log('Failed to load auth_info.json after polling.');
      }
    }

    return true;
  })();

  // Await this from other bootstrapping code (e.g. neutrala-bootstrap.js) before calling Neutralino APIs.
  globalThis.__NEUTRALA_NEUTRALINO_READY__ = ready;
})();

