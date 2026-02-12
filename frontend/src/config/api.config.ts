/**
 * API Configuration
 * Central configuration for all API endpoints and settings
 */

function runtimeApiUrl(): string | undefined {
  return (globalThis as any).__NEUTRALA_API_URL as string | undefined;
}

function runtimeSocketUrl(): string | undefined {
  return (globalThis as any).__NEUTRALA_SOCKET_URL as string | undefined;
}

function fallbackBaseUrl(): string {
  const url = (import.meta as any).env?.VITE_API_URL;
  if (!url) {
    // In production/desktop, we MUST rely on the injected runtime URL. 
    // If it's missing, we should fail fast or retry, not guess localhost:5000.
    if ((import.meta as any).env?.PROD) {
      console.warn('API URL missing in production build. Waiting for injection...');
      return ''; 
    }
    return 'http://127.0.0.1:5000'; // Only for local dev (vite)
  }
  return url;
}

function fallbackSocketUrl(): string {
  return (import.meta as any).env?.VITE_SOCKET_URL || fallbackBaseUrl();
}

export const API_CONFIG = {
  // Base URLs
  // Use getters so values are resolved AFTER `__NEUTRALA_BOOTSTRAP__` sets runtime globals.
  get baseURL() {
    return runtimeApiUrl() || fallbackBaseUrl();
  },
  get socketURL() {
    return runtimeSocketUrl() || fallbackSocketUrl();
  },
  
  // API Endpoints
  endpoints: {
    // Health & Status
    health: '/api/health',
    
    // Compiler Management
    compiler: {
      status: '/api/compiler/status',
      download: '/api/compiler/download',
      progress: '/api/compiler/progress',
    },
    
    // Code Analysis
    analyze: {
      syntax: '/api/analyze/syntax',
      ast: '/api/analyze/ast',
      trace: '/api/analyze/trace',
    },
  },
  
  // Request Configuration
  timeout: 30000, // 30 seconds
  
  // Retry Configuration
  retry: {
    attempts: 3,
    delay: 1000, // 1 second
    backoff: 2, // Exponential backoff multiplier
  },
  
  // Headers
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
} as const;

export default API_CONFIG;
