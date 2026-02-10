// frontend/src/services/chunk-manager.ts
import { EventEmitter } from 'events';
import { Socket } from 'socket.io-client';
import { decryptAndDecompressChunk } from './crypto-helper';

const MAX_CACHE_SIZE = 50;

type Step = any; // Define a proper Step type based on your data structure

export class ChunkManager extends EventEmitter {
  private cache = new Map<number, Step[]>();
  private totalChunks = -1;
  private preloaded = new Set<number>();

  constructor(
    private sessionId: string,
    private serverSecret: string | null, // optional — null for unencrypted traces
    private socket: Socket
  ) {
    super();
    this.setupSocketListeners();
  }

  private setupSocketListeners() {
    this.socket.on('chunk:ready', this.handleChunkReady.bind(this));
    this.socket.on('chunk:complete', (summary) => {
      this.totalChunks = summary.totalChunks;
      this.emit('loadProgress', { loaded: this.cache.size, total: this.totalChunks });
    });
  }

  private async handleChunkReady(rawChunk: any) {
    const { chunkId } = rawChunk;
    try {
      if (this.cache.has(chunkId)) return;

      // Support legacy (plain) chunks that already contain steps
      let steps: Step[];
      if (rawChunk.steps && Array.isArray(rawChunk.steps)) {
        steps = rawChunk.steps;
      } else {
        if (!this.serverSecret) throw new Error('Encrypted chunk received but no serverSecret provided');
        steps = await decryptAndDecompressChunk(rawChunk, this.sessionId, this.serverSecret);
      }
      
      if (this.cache.size >= MAX_CACHE_SIZE) {
        const oldestKey = this.cache.keys().next().value;
        this.cache.delete(oldestKey);
      }
      this.cache.set(chunkId, steps);
      this.preloaded.delete(chunkId);
      
      this.emit('chunkLoaded', chunkId, steps);
      this.emit('loadProgress', { loaded: this.cache.size, total: this.totalChunks });

    } catch (error) {
      console.error(`Failed to process chunk ${chunkId}:`, error);
      this.emit('chunkError', chunkId, error);
    }
  }

  /**
   * Called by the UI when it's partway through processing the steps of a chunk.
   * This triggers the preloading of the next chunks.
   * @param {number} currentChunkId - The ID of the chunk currently being viewed.
   * @param {number} currentStepIndex - The index of the step within that chunk.
   */
  public reportStepProgress(currentChunkId: number, currentStepIndex: number) {
    const chunk = this.cache.get(currentChunkId);
    if (!chunk) return;

    const progressPercentage = currentStepIndex / chunk.length;
    if (progressPercentage >= 0.8) {
      this.preloadNext(currentChunkId + 1);
      this.preloadNext(currentChunkId + 2); // Prefetch next 2
    }
  }

  /**
   * Preloads a chunk if it's not already cached or being preloaded.
   * @param {number} chunkId - The ID of the chunk to preload.
   */
  private preloadNext(chunkId: number) {
    if (this.totalChunks !== -1 && chunkId >= this.totalChunks) return; // Don't preload past the end
    if (this.cache.has(chunkId) || this.preloaded.has(chunkId)) return;

    console.log(`Preloading chunk ${chunkId}...`);
    this.preloaded.add(chunkId);
    this.socket.emit('chunk:request', { chunkId });
  }

  public getChunk(chunkId: number): Step[] | null {
    if (!this.cache.has(chunkId)) {
      this.preloadNext(chunkId); // Request it if not available
      return null;
    }
    return this.cache.get(chunkId) || null;
  }
  
  public getTotalChunks(): number {
    return this.totalChunks;
  }

  public clear() {
    this.cache.clear();
    this.preloaded.clear();
    this.totalChunks = -1;
  }
  
  public destroy() {
    this.clear();
    this.socket.off('chunk:ready');
    this.socket.off('chunk:complete');
    this.removeAllListeners();
  }
}
