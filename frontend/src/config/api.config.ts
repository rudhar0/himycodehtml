/**
 * API Configuration
 * Central configuration for all API endpoints and settings
 */

// Environment variables with fallbacks
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

export const API_CONFIG = {
  // Base URLs
  baseURL: API_BASE_URL,
  socketURL: SOCKET_URL,
  
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