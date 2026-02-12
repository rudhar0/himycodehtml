import { EventEmitter } from 'events';
import { createRedis } from '../config/redis.config.js';
import securityConfig from '../config/security.config.js';
import dataSecurityService from './data-security.service.js';
import logger from '../utils/logger.js';

const CHUNK_TTL = 900; // 15 minutes in seconds

class ChunkStreamerService extends EventEmitter {
  constructor(sessionId) {
    super();
    this.sessionId = sessionId;
    this.chunkSize = securityConfig.chunkSize || 100;
    this.stepBuffer = [];
    this.chunkIdCounter = 0;
    this.totalSteps = 0;
    this.redis = createRedis();
  }

  /**
   * Adds a single execution step to the stream.
   * When the buffer is full, it automatically chunks, encrypts, caches, and emits the chunk.
   * @param {object} step - The execution step object.
   */
  async addStep(step) {
    this.stepBuffer.push(step);
    this.totalSteps++;
    if (this.stepBuffer.length >= this.chunkSize) {
      await this.processChunk();
    }
  }

  /**
   * Processes the current buffer into a chunk.
   */
  async processChunk() {
    if (this.stepBuffer.length === 0) return;

    const chunkId = this.chunkIdCounter++;
    const chunkData = [...this.stepBuffer];
    this.stepBuffer = []; // Clear the buffer

    try {
      logger.info({ sessionId: this.sessionId, chunkId, steps: chunkData.length }, 'Processing new chunk.');
      const encryptedChunk = await dataSecurityService.encrypt(JSON.stringify(chunkData), this.sessionId);
      
      const payload = {
        chunkId,
        ...encryptedChunk,
      };
      
      await this.cacheChunk(chunkId, payload);

      // Emit event for the socket handler to send to the client
      this.emit('chunk:ready', payload);
      this.emit('chunk:progress', { loaded: this.chunkIdCounter, total: -1 }); // Total is unknown until the end

    } catch (error) {
      logger.error({ err: error, sessionId: this.sessionId, chunkId }, 'Failed to process or encrypt chunk.');
      this.emit('error', new Error(`Failed to process chunk ${chunkId}`));
    }
  }

  /**
   * Flushes any remaining steps in the buffer into a final chunk.
   * This should be called at the end of the debug session.
   */
  async flush() {
    await this.processChunk(); // Process any remaining steps
    logger.info({ sessionId: this.sessionId, totalChunks: this.chunkIdCounter }, 'Flushed all chunks.');
    this.emit('chunk:complete', { totalChunks: this.chunkIdCounter });
  }

  /**
   * Caches an encrypted chunk in Redis.
   * @param {number} chunkId - The ID of the chunk.
   * @param {object} chunkPayload - The encrypted chunk payload.
   */
  async cacheChunk(chunkId, chunkPayload) {
    const key = `chunk:${this.sessionId}:${chunkId}`;
    try {
      await this.redis.set(key, JSON.stringify(chunkPayload), 'EX', CHUNK_TTL);
      logger.debug({ sessionId: this.sessionId, chunkId }, 'Cached chunk in Redis.');
    } catch (error) {
      logger.warn({ err: error, sessionId: this.sessionId, chunkId }, 'Failed to cache chunk in Redis.');
    }
  }

  /**
   * Retrieves a cached chunk from Redis.
   * @param {number} chunkId - The ID of the chunk to retrieve.
   * @returns {Promise<object|null>} The cached chunk payload or null.
   */
  async getCachedChunk(chunkId) {
    const key = `chunk:${this.sessionId}:${chunkId}`;
    try {
      const chunkData = await this.redis.get(key);
      if (chunkData) {
        logger.debug({ sessionId: this.sessionId, chunkId }, 'Retrieved chunk from cache.');
        return JSON.parse(chunkData);
      }
    } catch (error) {
      logger.warn({ err: error, sessionId: this.sessionId, chunkId }, 'Failed to retrieve chunk from Redis cache.');
    }
    return null;
  }
}

export default ChunkStreamerService;