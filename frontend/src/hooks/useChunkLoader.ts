import { useState, useEffect } from 'react';
import ChunkManager from '../services/chunk-manager';

const useChunkLoader = () => {
  const [chunkManager] = useState(() => new ChunkManager());
  const [loadedChunks, setLoadedChunks] = useState<Map<number, any[]>>(new Map());
  const [error, setError] = useState<Error | null>(null);
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });

  useEffect(() => {
    chunkManager.onChunkLoaded = (chunkId, steps) => {
      setLoadedChunks((prev) => new Map(prev).set(chunkId, steps));
    };

    chunkManager.onChunkError = (chunkId, err) => {
      console.error(`Error loading chunk ${chunkId}:`, err);
      setError(err);
    };

    chunkManager.onLoadProgress = (loaded, total) => {
      setProgress({ loaded, total });
    };
  }, [chunkManager]);

  return { chunkManager, loadedChunks, error, progress };
};

export default useChunkLoader;
