export const SOCKET_CONFIG = {
  url: ((globalThis as any).__NEUTRALA_SOCKET_URL as string | undefined) ||  'http://localhost:5000',
  options: {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
    timeout: 20000,
    autoConnect: false,
    withCredentials: true
  }
} as const;

export default SOCKET_CONFIG;
