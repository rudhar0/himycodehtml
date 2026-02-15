import { useState, useEffect } from 'react';
import { ChunkManager } from '../services/chunk-manager';

const useChunkLoader = (sessionId: string, serverSecret: string | null, socket: any) => {
  const [chunkManager] = useState(() => new ChunkManager(sessionId, serverSecret, socket));
  const [loadedChunks, setLoadedChunks] = useState<Map<number, any[]>>(new Map());
  const [error, setError] = useState<Error | null>(null);
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });

  useEffect(() => {
    const handleChunkLoaded = (chunkId: number, steps: any[]) => {
      setLoadedChunks((prev) => new Map(prev).set(chunkId, steps));
    };

    const handleChunkError = (chunkId: number, err: Error) => {
      console.error(`Error loading chunk ${chunkId}:`, err);
      setError(err);
    };

    const handleProgress = (progress: { loaded: number, total: number }) => {
      setProgress(progress);
    };

    chunkManager.on('chunkLoaded', handleChunkLoaded);
    chunkManager.on('chunkError', handleChunkError);
    chunkManager.on('loadProgress', handleProgress);

    return () => {
      chunkManager.off('chunkLoaded', handleChunkLoaded);
      chunkManager.off('chunkError', handleChunkError);
      chunkManager.off('loadProgress', handleProgress);
    };
  }, [chunkManager]);

  return { chunkManager, loadedChunks, error, progress };
};

export default useChunkLoader;
