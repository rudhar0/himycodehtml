// frontend/src/store/slices/loopSlice.ts
// Loop state management: toggle mode, skip, current loop tracking

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { useExecutionStore } from './executionSlice';

export interface LoopInfo {
  loopId: number;
  loopType: 'for' | 'while' | 'do-while';
  currentIteration: number;
  totalIterations: number;
  startStepIndex: number;
  endStepIndex?: number;
  isActive: boolean;
}

export interface LoopState {
  // Toggle mode: true = update in place, false = create new elements
  toggleMode: boolean;
  
  // Current active loops (stack for nested loops)
  activeLoops: LoopInfo[];
  
  // Loop skip state
  isSkipping: boolean;
  skipTargetStep?: number;
  
  // Actions
  setToggleMode: (enabled: boolean) => void;
  
  // Loop tracking
  enterLoop: (loopInfo: Omit<LoopInfo, 'isActive'>) => void;
  updateLoopIteration: (loopId: number, iteration: number) => void;
  exitLoop: (loopId: number) => void;
  
  // Skip functionality
  skipCurrentLoop: () => void;
  canSkipLoop: () => boolean;
  getCurrentLoopInfo: () => LoopInfo | null;
  
  // Reset
  reset: () => void;
}

export const useLoopStore = create<LoopState>()(
  immer((set, get) => ({
    // Initial state
    toggleMode: true, // Default: update in place
    activeLoops: [],
    isSkipping: false,
    skipTargetStep: undefined,

    // Actions
    setToggleMode: (enabled: boolean) =>
      set((state) => {
        state.toggleMode = enabled;
      }),

    enterLoop: (loopInfo) =>
      set((state) => {
        state.activeLoops.push({
          ...loopInfo,
          isActive: true,
        });
      }),

    updateLoopIteration: (loopId: number, iteration: number) =>
      set((state) => {
        const loop = state.activeLoops.find(l => l.loopId === loopId);
        if (loop) {
          loop.currentIteration = iteration;
        }
      }),

    exitLoop: (loopId: number) =>
      set((state) => {
        const index = state.activeLoops.findIndex(l => l.loopId === loopId);
        if (index !== -1) {
          state.activeLoops[index].isActive = false;
          // Remove after a delay to allow animations
          setTimeout(() => {
            set((s) => {
              s.activeLoops = s.activeLoops.filter(l => l.loopId !== loopId);
            });
          }, 500);
        }
      }),

    skipCurrentLoop: () => {
      const currentLoop = get().getCurrentLoopInfo();
      if (!currentLoop || !currentLoop.endStepIndex) return;

      const executionStore = useExecutionStore.getState();
      
      // Calculate skip target (90% to end)
      const currentStep = executionStore.currentStep;
      const loopDuration = currentLoop.endStepIndex - currentLoop.startStepIndex;
      const skipPercentage = 0.9; // Skip 90%
      const skipSteps = Math.floor(loopDuration * skipPercentage);
      const targetStep = Math.min(
        currentStep + skipSteps,
        currentLoop.endStepIndex
      );

      set((state) => {
        state.isSkipping = true;
        state.skipTargetStep = targetStep;
      });

      // Perform the skip
      executionStore.jumpToStep(targetStep);

      // Reset skip state after animation
      setTimeout(() => {
        set((state) => {
          state.isSkipping = false;
          state.skipTargetStep = undefined;
        });
      }, 1000);
    },

    canSkipLoop: () => {
      const state = get();
      const currentLoop = state.getCurrentLoopInfo();
      
      if (!currentLoop || !currentLoop.isActive) return false;
      
      const executionStore = useExecutionStore.getState();
      const currentStep = executionStore.currentStep;
      
      // Can skip if:
      // 1. Loop has an end step defined
      // 2. Current step is before end step
      // 3. Not already skipping
      return (
        currentLoop.endStepIndex !== undefined &&
        currentStep < currentLoop.endStepIndex &&
        !state.isSkipping
      );
    },

    getCurrentLoopInfo: () => {
      const state = get();
      // Return the innermost active loop (last in array)
      const activeLoops = state.activeLoops.filter(l => l.isActive);
      return activeLoops.length > 0 ? activeLoops[activeLoops.length - 1] : null;
    },

    reset: () =>
      set((state) => {
        state.activeLoops = [];
        state.isSkipping = false;
        state.skipTargetStep = undefined;
      }),
  }))
);