/**
 * Chunk Service
 * Handles large code files by managing chunks
 */

class ChunkService {
  constructor() {
    // Store chunks per socket
    this.socketChunks = new Map();
  }

  /**
   * Process incoming code chunk
   */
  handleChunk(socketId, chunkData) {
    const { chunkId, totalChunks, code } = chunkData;

    // Initialize socket storage if needed
    if (!this.socketChunks.has(socketId)) {
      this.socketChunks.set(socketId, {
        chunks: new Map(),
        totalChunks,
        receivedCount: 0
      });
    }

    const socketData = this.socketChunks.get(socketId);

    // Store chunk
    socketData.chunks.set(chunkId, code);
    socketData.receivedCount++;

    console.log(`📦 Received chunk ${chunkId + 1}/${totalChunks} from ${socketId}`);

    // Check if all chunks received
    if (socketData.receivedCount === totalChunks) {
      const fullCode = this.assembleChunks(socketId);
      this.clearChunks(socketId);
      return {
        complete: true,
        code: fullCode
      };
    }

    return {
      complete: false,
      progress: (socketData.receivedCount / totalChunks) * 100
    };
  }

  /**
   * Assemble all chunks into full code
   */
  assembleChunks(socketId) {
    const socketData = this.socketChunks.get(socketId);
    if (!socketData) {
      throw new Error('No chunks found for socket');
    }

    const sortedChunks = Array.from(socketData.chunks.entries())
      .sort((a, b) => a[0] - b[0]) // Sort by chunk ID
      .map(([_, code]) => code);

    return sortedChunks.join('');
  }

  /**
   * Clear chunks for a socket
   */
  clearChunks(socketId) {
    this.socketChunks.delete(socketId);
    console.log(`🗑️  Cleared chunks for ${socketId}`);
  }

  /**
   * Check if socket has pending chunks
   */
  hasPendingChunks(socketId) {
    return this.socketChunks.has(socketId);
  }

  /**
   * Get chunk progress
   */
  getProgress(socketId) {
    const socketData = this.socketChunks.get(socketId);
    if (!socketData) return 0;

    return (socketData.receivedCount / socketData.totalChunks) * 100;
  }

  /**
   * Cleanup on socket disconnect
   */
  handleDisconnect(socketId) {
    if (this.socketChunks.has(socketId)) {
      console.log(`🔌 Socket ${socketId} disconnected, clearing chunks`);
      this.clearChunks(socketId);
    }
  }
}

export const chunkService = new ChunkService();