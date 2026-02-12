/* global MonacoEnvironment */

/**
 * Runtime configuration for Monaco Editor and TreeSitter workers.
 * 
 * This must be loaded BEFORE any dynamic imports of Monaco or TreeSitter.
 * It configures the base path for worker scripts to use relative paths
 * instead of absolute paths, enabling Neutralino (file://) compatibility.
 */

(function setupRuntimeConfig() {
  const LOG_PREFIX = '[neutrala][runtime-config]';

  function log(...args) {
    try {
      // eslint-disable-next-line no-console
      console.log(LOG_PREFIX, ...args);
    } catch {
      // ignore
    }
  }

  // Determine the base URL for worker assets
  // In Neutralino (file://), this will be relative to the current document
  // In dev server, this will resolve to http://localhost:5173
  function getWorkerBase() {
    try {
      const href = globalThis.location.href;
      const isFile = href.startsWith('file://');
      if (isFile) {
        // file:// URLs must use relative paths to work properly
        return './';
      }
      // http:// URLs can use absolute or relative paths
      return './';
    } catch {
      return './';
    }
  }

  const workerBase = getWorkerBase();
  log('Worker base URL:', workerBase);

  // Configure Monaco Editor worker paths
  // This tells Monaco where to find its worker scripts
  globalThis.MonacoEnvironment = globalThis.MonacoEnvironment || {};
  globalThis.MonacoEnvironment.getWorkerUrl = function (workerId) {
    // Map workerId to relative worker paths
    const workerScripts = {
      'editor.worker': 'assets/editor.worker',
      'json.worker': 'assets/json.worker',
      'css.worker': 'assets/css.worker',
      'html.worker': 'assets/html.worker',
      'typescript.worker': 'assets/typescript.worker',
      'javascript.worker': 'assets/javascript.worker',
    };

    const script = workerScripts[workerId];
    if (script) {
      return workerBase + script + '.js';
    }

    // Fallback for any other worker types
    log('Unknown worker ID:', workerId, '- using fallback');
    return workerBase + 'assets/' + workerId + '.worker.js';
  };

  log('MonacoEnvironment.getWorkerUrl configured');

  // Configure TreeSitter paths (if using web-tree-sitter)
  // This is needed if TreeSitter dynamic imports are used
  if (typeof globalThis.TreeSitter === 'undefined') {
    globalThis.TreeSitter = globalThis.TreeSitter || {};
  }

  // Preemptively set a locateFile function that other loaders might use
  globalThis.locateFile = globalThis.locateFile || function (filename) {
    return workerBase + filename;
  };

  log('Runtime config initialized');
})();
