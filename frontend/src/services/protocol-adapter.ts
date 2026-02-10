// frontend/src/services/protocol-adapter.ts
import { io, Socket } from 'socket.io-client';
import { ChunkManager } from './chunk-manager';
import { SOCKET_EVENTS } from '../constants/events';

// Define the callbacks the UI will use
type StateUpdateCallback = (steps: any[]) => void;
type ProgressCallback = (progress: { loaded: number, total: number }) => void;
type ErrorCallback = (error: Error) => void;

/**
 * This adapter provides a backward-compatible interface for the frontend,
 * while using the new chunk-based architecture underneath.
 */
export class ProtocolAdapter {
  private socket: Socket;
  public chunkManager: ChunkManager | null = null;
  
  private onStateUpdateCallback: StateUpdateCallback | null = null;
  private onProgressCallback: ProgressCallback | null = null;
  private onErrorCallback: ErrorCallback | null = null;
  
  private allSteps: any[] = [];
  private totalChunks = -1;

  public async connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = io(url, { transports: ['websocket'] });

      this.socket.on('connect', () => {
        console.log('ProtocolAdapter connected.');
        resolve();
      });

      this.socket.on('connect_error', (err) => {
        console.error('Connection Error:', err);
        reject(err);
      });

      // Legacy/new session hook: if backend emits session info
      this.socket.on('session:created', ({ sessionId }) => {
        console.log('Session created:', sessionId);
        // If backend supports encrypted chunks it should provide a short-lived clientSecret.
        // For legacy unencrypted traces, serverSecret may be null.
        const serverSecret = null;
        this.chunkManager = new ChunkManager(sessionId, serverSecret, this.socket);
        this.setupChunkManagerListeners();
      });

      // Also listen for chunk-style trace events emitted by older backend handlers
      this.socket.on(SOCKET_EVENTS.CODE_TRACE_CHUNK, (payload) => {
        // Ensure chunkManager exists (use socket id as session fallback)
        if (!this.chunkManager) {
          this.chunkManager = new ChunkManager(this.socket.id || 'local', null, this.socket);
          this.setupChunkManagerListeners();
        }
        // Reuse existing chunk handling — ChunkManager will accept legacy `steps` payloads
        this.socket.emit('chunk:ready:internal', payload); // forward if needed
        // Directly call the internal handler for immediate processing
        // @ts-ignore
        this.chunkManager.handleChunkReady(payload);
      });

      this.socket.on(SOCKET_EVENTS.CODE_TRACE_COMPLETE, (summary) => {
        if (this.chunkManager) {
          this.chunkManager.emit('loadProgress', { loaded: this.chunkManager.getTotalChunks(), total: summary.totalChunks });
        }
      });
    });
  }

  /**
   * Listens to events from the ChunkManager and translates them for the UI.
   */
  private setupChunkManagerListeners(): void {
    if (!this.chunkManager) return;
    
    this.chunkManager.on('chunkLoaded', (chunkId, steps) => {
      console.log(`Chunk ${chunkId} loaded with ${steps.length} steps.`);
      // For backward compatibility, we emit one state update per step.
      for (const step of steps) {
        if (this.onStateUpdateCallback) {
          const programState: ProgramState = {
              location: { file: '', line: step.line, function: step.state?.callStack[0]?.function || ''},
              callStack: step.state.callStack,
              variables: step.state,
              changes: step.changes,
          };
          this.onStateUpdateCallback(programState);
        }
      }
    });

    this.chunkManager.on('loadProgress', (progress) => {
      this.totalChunks = progress.total;
      if (this.onProgressCallback) {
        this.onProgressCallback(progress);
      }
    });
    
    this.chunkManager.on('chunkError', (chunkId, error) => {
      console.error(`Error loading chunk ${chunkId}:`, error);
      if (this.onErrorCallback) {
        this.onErrorCallback(error);
      }
    });
  }

  public sendCode(code: string, language: 'c' | 'cpp' = 'cpp'): void {
    this.allSteps = [];
    if (this.chunkManager) {
      this.chunkManager.clear();
    }
    this.socket.emit('debug:start', { code, language });
  }
  
  // Register callbacks from the UI
  public onStateUpdate(callback: StateUpdateCallback): void {
    this.onStateUpdateCallback = callback;
  }

  public onProgress(callback: ProgressCallback): void {
    this.onProgressCallback = callback;
  }
  
  public onError(callback: ErrorCallback): void {
      this.onErrorCallback = callback;
  }

  public disconnect(): void {
    if (this.chunkManager) {
      this.chunkManager.destroy();
    }
    if (this.socket) {
      this.socket.disconnect();
      console.log('ProtocolAdapter disconnected.');
    }
  }

  // --- Debugger Controls ---
  public nextStep = () => this.socket.emit('debug:next');
  public stepIn = () => this.socket.emit('debug:stepIn');
  public stepOut = () => this.socket.emit('debug:stepOut');
  public continue = () => this.socket.emit('debug:continue');
}
