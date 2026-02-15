import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './bootstrap/desktopBootstrap';

// Platform-agnostic bootstrap logic
async function bootstrap() {
  // 0. Wait for Neutralino injection/loader if we are in a desktop context
  if ((globalThis as any).__NEUTRALA_NEUTRALINO_READY__) {
    console.log('[main] Waiting for Neutralino readiness...');
    await (globalThis as any).__NEUTRALA_NEUTRALINO_READY__;
  }

  const N = (globalThis as any).Neutralino;
  
  // 1. Initialize Neutralino if available
  if (N && typeof N.init === 'function') {
    try {
      N.init();
      console.log('[main] Neutralino initialized');
    } catch (e) {
      console.warn('[main] Neutralino init failed (likely browser mode):', e);
    }
  }

  // 2. Run Desktop Bootstrap (if injected by desktopBootstrap.ts)
  // This orchestrates backend spawning, port waiting, etc.
  if (typeof (globalThis as any).runDesktopBootstrap === 'function') {
    try {
      const result = await (globalThis as any).runDesktopBootstrap();
      if (!result.ok) {
        console.error('[main] Desktop bootstrap failed:', result.error);
        // We could render a fatal error screen here, but for now we let the app mount
        // The App component shows a "Connecting..." state which will persist if backend is dead.
      }
    } catch (e) {
      console.error('[main] Critical bootstrap error:', e);
    }
  }
}

// Start bootstrap then render
bootstrap().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
