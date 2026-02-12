import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
// eslint-disable-next-line no-console
console.log('[neutrala][main] entry', { href: globalThis.location?.href, t0 });

try {
  await (globalThis as any).__NEUTRALA_BOOTSTRAP__?.();
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('[neutrala][main] bootstrap threw (ignored):', e);
}

// eslint-disable-next-line no-console
console.log('[neutrala][main] bootstrap done', {
  info: (globalThis as any).__NEUTRALA_BOOTSTRAP_INFO__,
  apiUrl: (globalThis as any).__NEUTRALA_API_URL,
  socketUrl: (globalThis as any).__NEUTRALA_SOCKET_URL,
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// eslint-disable-next-line no-console
console.log('[neutrala][main] react render scheduled', {
  dtMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
});
