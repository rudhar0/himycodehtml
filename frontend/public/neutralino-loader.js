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
      log('Not running in Neutralino (no injection detected); skipping neutralino.js. Found keys:', nlKeys);
      return false;
    }

    if (typeof globalThis.Neutralino !== 'undefined') {
      log('Neutralino already present');
      return true;
    }

    // Fix: use relative path for portability
    log('Loading ./neutralino.js…');
    await loadScript('./neutralino.js');

    if (typeof globalThis.Neutralino === 'undefined') {
      throw new Error('neutralino.js loaded but globalThis.Neutralino is undefined');
    }
    log('neutralino.js ready');
    return true;
  })();

  // Await this from other bootstrapping code (e.g. neutrala-bootstrap.js) before calling Neutralino APIs.
  globalThis.__NEUTRALA_NEUTRALINO_READY__ = ready;
})();

