const DIALOG_ID = 'codeviz-input-dialog';
const OVERLAY_ROOT_ID = 'codeviz-overlay-root';
const CANVAS_ID = 'visualization-canvas';

export function ensureInputDialogHost(): HTMLElement | null {
  if (typeof document === 'undefined') return null;

  try {
    let host = document.getElementById(DIALOG_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = DIALOG_ID;
      host.style.position = 'absolute';
      host.style.inset = '0';
      host.style.zIndex = '10000';
      host.style.pointerEvents = 'none';
    }

    const canvas = document.getElementById(CANVAS_ID);
    if (canvas) {
      if (getComputedStyle(canvas).position === 'static') {
        canvas.style.position = 'relative';
      }
      if (host.parentElement !== canvas) {
        canvas.appendChild(host);
      }
      return host;
    }

    let overlayRoot = document.getElementById(OVERLAY_ROOT_ID);
    if (!overlayRoot) {
      overlayRoot = document.createElement('div');
      overlayRoot.id = OVERLAY_ROOT_ID;
      overlayRoot.style.position = 'fixed';
      overlayRoot.style.inset = '0';
      overlayRoot.style.zIndex = '10000';
      overlayRoot.style.pointerEvents = 'none';
      document.body.appendChild(overlayRoot);
    }

    if (host.parentElement !== overlayRoot) {
      overlayRoot.appendChild(host);
    }
    return host;
  } catch (_error) {
    return null;
  }
}
