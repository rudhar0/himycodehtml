// frontend/src/store/slices/loopSlice.ts
// Loop state management: toggle mode, skip, current loop tracking

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { useExecutionStore } from './executionSlice';
import type { ExecutionTrace } from '../../types';

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
  syncFromTrace: (trace: ExecutionTrace | null, currentStep: number) => void;
  
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

    syncFromTrace: (trace: ExecutionTrace | null, currentStep: number) =>
      set((state) => {
        if (!trace || !Array.isArray(trace.steps) || trace.steps.length === 0) {
          state.activeLoops = [];
          return;
        }

        const stepTypeOf = (step: any) => (step?.eventType || step?.type || '') as string;

        const endStepByLoopId = new Map<number, number>();
        for (let i = 0; i < trace.steps.length; i++) {
          const step: any = trace.steps[i];
          if (stepTypeOf(step) === 'loop_end' && typeof step.loopId === 'number') {
            endStepByLoopId.set(step.loopId, i);
          }
        }

        const stack: LoopInfo[] = [];
        const limit = Math.min(currentStep, trace.steps.length - 1);
        for (let i = 0; i <= limit; i++) {
          const step: any = trace.steps[i];
          const type = stepTypeOf(step);

          if (type === 'loop_start' && typeof step.loopId === 'number') {
            const loopId = step.loopId as number;
            const loopType = (step.loopType || 'for') as LoopInfo['loopType'];
            stack.push({
              loopId,
              loopType,
              currentIteration: 0,
              totalIterations: 0,
              startStepIndex: i,
              endStepIndex: endStepByLoopId.get(loopId),
              isActive: true,
            });
            continue;
          }

          if (type === 'loop_body_start' && typeof step.loopId === 'number') {
            const loopId = step.loopId as number;
            const iteration = typeof step.iteration === 'number' ? step.iteration : 0;
            for (let s = stack.length - 1; s >= 0; s--) {
              if (stack[s].loopId === loopId) {
                stack[s].currentIteration = iteration;
                stack[s].totalIterations = Math.max(stack[s].totalIterations, iteration);
                break;
              }
            }
            continue;
          }

          if (type === 'loop_iteration_end' && typeof step.loopId === 'number') {
            const loopId = step.loopId as number;
            const iteration = typeof step.iteration === 'number' ? step.iteration : 0;
            for (let s = stack.length - 1; s >= 0; s--) {
              if (stack[s].loopId === loopId) {
                stack[s].totalIterations = Math.max(stack[s].totalIterations, iteration);
                break;
              }
            }
            continue;
          }

          if (type === 'loop_end' && typeof step.loopId === 'number') {
            const loopId = step.loopId as number;
            for (let s = stack.length - 1; s >= 0; s--) {
              if (stack[s].loopId === loopId) {
                stack.splice(s, 1);
                break;
              }
            }
            continue;
          }
        }

        state.activeLoops = stack;
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

      // Skip to the loop end deterministically (matches in-canvas skip behavior)
      const targetStep = currentLoop.endStepIndex;

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
