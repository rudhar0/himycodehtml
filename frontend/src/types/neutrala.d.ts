/* global Neutralino */

export {};

declare global {
  interface Window {
    neutrala?: {
      openWindow?: (url?: string, options?: Record<string, unknown>) => Promise<unknown>;
      openNewWindow?: () => Promise<unknown>;
    };
  }
}

