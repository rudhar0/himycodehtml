/**
 * Socket Service
 * Manages Socket.io connection and events
 */

import { io, Socket } from 'socket.io-client';
import { API_CONFIG } from '@config/api.config';
import { SOCKET_EVENTS } from '@constants/index';
import type { GCCStatus } from '@types/index';

export type SocketEventCallback = (data: any) => void;

class SocketService {
  private socket: Socket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private eventListeners: Map<string, SocketEventCallback[]> = new Map();
  private isConnectedFlag = false;

  /**
   * Connect to Socket.io server
   */
  connect(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        resolve(this.socket);
        return;
      }

      console.log('🔌 Connecting to Socket.io server...');

      this.socket = io(API_CONFIG.socketURL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: this.maxReconnectAttempts,
      });

      // Connection successful
      this.socket.on('connect', () => {
        console.log('✅ Socket.io connected:', this.socket?.id);
        this.reconnectAttempts = 0;
        this.isConnectedFlag = true;
        this.emitToListeners('connection:state', { connected: true });
        resolve(this.socket!);
      });

      // Connection error
      this.socket.on('connect_error', (error) => {
        console.error('❌ Socket.io connection error:', error);
        this.reconnectAttempts++;
        this.isConnectedFlag = false;
        this.emitToListeners('connection:state', { connected: false });
        
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          reject(new Error('Failed to connect after maximum attempts'));
        }
      });

      // Disconnection
      this.socket.on('disconnect', (reason) => {
        console.log('🔌 Socket.io disconnected:', reason);
        this.isConnectedFlag = false;
        this.emitToListeners('connection:state', { connected: false });
      });

      // Reconnection attempt
      this.socket.on('reconnect_attempt', (attempt) => {
        console.log(`🔄 Reconnection attempt ${attempt}/${this.maxReconnectAttempts}`);
      });

      // Setup event listeners
      this.setupEventListeners();
    });
  }

  /**
   * Disconnect from Socket.io server
   */
  disconnect() {
    if (this.socket) {
      console.log('🔌 Disconnecting from Socket.io server...');
      this.socket.disconnect();
      this.socket = null;
      this.eventListeners.clear();
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  /**
   * Setup event listeners for server-sent events
   */
  private setupEventListeners() {
    if (!this.socket) return;

    // Generic handler to forward events
    const forwardEvent = (event: string) => {
      this.socket?.on(event, (data: any) => {
        this.emitToListeners(event, data);
      });
    };

    // Events to forward
    const eventsToForward = [
      SOCKET_EVENTS.COMPILER_STATUS,
      SOCKET_EVENTS.CODE_SYNTAX_RESULT,
      SOCKET_EVENTS.CODE_SYNTAX_ERROR,
      SOCKET_EVENTS.CODE_TRACE_PROGRESS,
      SOCKET_EVENTS.CODE_TRACE_CHUNK,
      SOCKET_EVENTS.CODE_TRACE_COMPLETE,
      SOCKET_EVENTS.CODE_TRACE_ERROR,
      'execution:input_required', // Forward input required event
    ];

    eventsToForward.forEach(forwardEvent);
  }

  /**
   * Emit custom event to local listeners
   */
  private emitToListeners(event: string, data: any) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(callback => callback(data));
    }
  }

  /**
   * Subscribe to event
   */
  on(event: string, callback: SocketEventCallback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }

  /**
   * Unsubscribe from event
   */
  off(event: string, callback: SocketEventCallback) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  // ============================================
  // EMIT METHODS (Send to Server)
  // ============================================

  /**
   * Emit an event to the server.
   */
  emit(event: string, data: any) {
    this.socket?.emit(event, data);
  }

  /**
   * Request Compiler status
   */
  requestCompilerStatus() {
    this.emit(SOCKET_EVENTS.COMPILER_STATUS_REQUEST, {});
  }

  /**
   * Analyze code syntax
   */
  analyzeSyntax(code: string, language: string) {
    this.emit(SOCKET_EVENTS.CODE_ANALYZE_SYNTAX, { code, language });
  }

  /**
   * Generate execution trace
   */
  generateTrace(code: string, language: string) {
    this.emit(SOCKET_EVENTS.CODE_TRACE_GENERATE, { code, language });
  }

  /**
   * Provide user input (for scanf/cin)
   */
  provideInput(value: string | number) {
    this.emit(SOCKET_EVENTS.EXECUTION_INPUT_PROVIDE, { value });
  }
}

// Export singleton instance
export const socketService = new SocketService();
export default socketService;