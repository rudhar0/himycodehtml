import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { GCCStatus } from '@types/index';

export interface GCCState extends GCCStatus {
  // Additional UI state
  isDownloadModalOpen: boolean;
  downloadError: string | null;
  
  // Actions
  setGCCStatus: (status: Partial<GCCStatus>) => void;
  setDownloading: (downloading: boolean) => void;
  setProgress: (progress: number) => void;
  setStage: (stage: GCCStatus['stage']) => void;
  setAvailable: (available: boolean) => void;
  setGCCPath: (path: string | null) => void;
  
  // Modal actions
  openDownloadModal: () => void;
  closeDownloadModal: () => void;
  setDownloadError: (error: string | null) => void;
  
  // Reset
  reset: () => void;
}

export const useGCCStore = create<GCCState>()(
  immer((set) => ({
    // Initial state
    available: false,
    downloading: false,
    progress: 0,
    stage: 'idle',
    gccPath: null,
    isDownloadModalOpen: false,
    downloadError: null,

    // Actions
    setGCCStatus: (status: Partial<GCCStatus>) =>
      set((state) => {
        if (status.available !== undefined) state.available = status.available;
        if (status.downloading !== undefined) state.downloading = status.downloading;
        if (status.progress !== undefined) state.progress = status.progress;
        if (status.stage !== undefined) state.stage = status.stage;
        if (status.gccPath !== undefined) state.gccPath = status.gccPath;
      }),

    setDownloading: (downloading: boolean) =>
      set((state) => {
        state.downloading = downloading;
        if (downloading) {
          state.stage = 'downloading';
          state.downloadError = null;
        }
      }),

    setProgress: (progress: number) =>
      set((state) => {
        state.progress = Math.max(0, Math.min(100, progress));
      }),

    setStage: (stage: GCCStatus['stage']) =>
      set((state) => {
        state.stage = stage;
        
        // Reset error when stage changes from failed
        if (stage !== 'failed') {
          state.downloadError = null;
        }
        
        // Close modal when ready
        if (stage === 'ready') {
          state.isDownloadModalOpen = false;
          state.available = true;
        }
      }),

    setAvailable: (available: boolean) =>
      set((state) => {
        state.available = available;
        if (available) {
          state.stage = 'ready';
          state.downloading = false;
          state.progress = 100;
        }
      }),

    setGCCPath: (path: string | null) =>
      set((state) => {
        state.gccPath = path;
      }),

    // Modal actions
    openDownloadModal: () =>
      set((state) => {
        state.isDownloadModalOpen = true;
      }),

    closeDownloadModal: () =>
      set((state) => {
        state.isDownloadModalOpen = false;
      }),

    setDownloadError: (error: string | null) =>
      set((state) => {
        state.downloadError = error;
        if (error) {
          state.stage = 'failed';
          state.downloading = false;
        }
      }),

    // Reset
    reset: () =>
      set((state) => {
        state.available = false;
        state.downloading = false;
        state.progress = 0;
        state.stage = 'idle';
        state.gccPath = null;
        state.isDownloadModalOpen = false;
        state.downloadError = null;
      }),
  }))
);