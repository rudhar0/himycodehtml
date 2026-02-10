/**
 * API Service
 * Centralized Axios client for HTTP requests
 */

import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from 'axios';
import { API_CONFIG } from '@config/api.config';

class APIService {
  private client: AxiosInstance;
  private requestInterceptor: number | null = null;
  private responseInterceptor: number | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_CONFIG.baseURL,
      timeout: API_CONFIG.timeout,
      headers: API_CONFIG.headers,
    });

    this.setupInterceptors();
  }

  /**
   * Setup request and response interceptors
   */
  private setupInterceptors() {
    // Request interceptor
    this.requestInterceptor = this.client.interceptors.request.use(
      (config) => {
        // Add timestamp to requests
        config.headers['X-Request-Time'] = new Date().toISOString();
        
        // Log request in development
        if (import.meta.env.DEV) {
          console.log('📤 API Request:', config.method?.toUpperCase(), config.url);
        }
        
        return config;
      },
      (error) => {
        console.error('❌ Request Error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.responseInterceptor = this.client.interceptors.response.use(
      (response) => {
        // Log response in development
        if (import.meta.env.DEV) {
          console.log('📥 API Response:', response.config.url, response.status);
        }
        
        return response;
      },
      async (error: AxiosError) => {
        // Handle errors
        if (error.response) {
          // Server responded with error
          console.error('❌ Server Error:', error.response.status, error.response.data);
        } else if (error.request) {
          // Request made but no response
          console.error('❌ Network Error: No response received');
        } else {
          // Something else happened
          console.error('❌ Request Error:', error.message);
        }

        return Promise.reject(error);
      }
    );
  }

  /**
   * Generic GET request
   */
  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.get<T>(url, config);
    return response.data;
  }

  /**
   * Generic POST request
   */
  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.post<T>(url, data, config);
    return response.data;
  }

  /**
   * Generic PUT request
   */
  async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.put<T>(url, data, config);
    return response.data;
  }

  /**
   * Generic DELETE request
   */
  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.delete<T>(url, config);
    return response.data;
  }

  /**
   * Health check
   */
  async healthCheck() {
    return this.get(API_CONFIG.endpoints.health);
  }

  /**
   * Get GCC status
   */
  async getGCCStatus() {
    return this.get(API_CONFIG.endpoints.compiler.status);
  }

  /**
   * Start GCC download
   */
  async startGCCDownload() {
    return this.post(API_CONFIG.endpoints.compiler.download);
  }

  /**
   * Get GCC download progress
   */
  async getGCCProgress() {
    return this.get(API_CONFIG.endpoints.compiler.progress);
  }

  /**
   * Validate code syntax
   */
  async validateSyntax(code: string, language: string) {
    return this.post(API_CONFIG.endpoints.analyze.syntax, {
      code,
      language
    });
  }

  /**
   * Get AST dump
   */
  async getAST(code: string, language: string) {
    return this.post(API_CONFIG.endpoints.analyze.ast, {
      code,
      language
    });
  }

  /**
   * Generate execution trace (HTTP - for small code)
   */
  async generateTrace(code: string, language: string, inputs: any[] = []) {
    return this.post(API_CONFIG.endpoints.analyze.trace, {
      code,
      language,
      inputs
    });
  }
}

// Export singleton instance
export const apiService = new APIService();
export default apiService;