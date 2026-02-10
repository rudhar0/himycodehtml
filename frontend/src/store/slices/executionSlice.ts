import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { ExecutionStep, ExecutionTrace, MemoryState } from '@types/index';
import { DEFAULTS } from '@constants/index';
import AnimationEngine from '../../animations/AnimationEngine';

export interface ExecutionState {
  // Trace data
  executionTrace: ExecutionTrace | null; // Changed to hold the full trace object
  totalSteps: number;
  currentStep: number;
  
  // Playback state
  isPlaying: boolean;
  isPaused: boolean;
  isAnalyzing: boolean;
  speed: number;
  
  // Current state
  currentState: MemoryState | null;
  
  // Analysis progress
  analysisProgress: number;
  analysisStage: string;
  
  // Playback interval
  playbackInterval: NodeJS.Timeout | null;
  
  // Canvas rebuild flag (set to true when jumping to a step)
  needsCanvasRebuild: boolean;
  
  // Actions
  setTrace: (trace: ExecutionTrace) => void;
  clearTrace: () => void;
  setCurrentStep: (step: number) => void;
  stepForward: () => void;
  stepBackward: () => void;
  jumpToStep: (step: number) => void;
  play: () => void;
  pause: () => void;
  reset: () => void;
  setSpeed: (speed: number) => void;
  setAnalyzing: (isAnalyzing: boolean) => void;
  setAnalysisProgress: (progress: number, stage: string) => void;
  startAnalysis: () => void;
  markCanvasRebuildComplete: () => void;
  
  // Computed
  getCurrentStep: () => ExecutionStep | null;
  canStepForward: () => boolean;
  canStepBackward: () => boolean;
}

// Helper to expand loop summaries into full steps
const expandTrace = (steps: ExecutionStep[]): ExecutionStep[] => {
  const expanded: ExecutionStep[] = [];
  
  for (const step of steps) {
    if (step.type === 'loop_body_summary' && (step as any).events) {
       expanded.push(...expandTrace((step as any).events as ExecutionStep[]));
    } else {
       expanded.push(step);
    }
  }
  return expanded;
};

export const useExecutionStore = create<ExecutionState>()(
  immer((set, get) => ({
    // Initial state
    executionTrace: null,
    totalSteps: 0,
    currentStep: 0,
    isPlaying: false,
    isPaused: false,
    isAnalyzing: false,
    speed: DEFAULTS.PLAYBACK_SPEED,
    currentState: null,
    analysisProgress: 0,
    analysisStage: 'idle',
    playbackInterval: null,
    needsCanvasRebuild: false,

    // Actions
   setTrace: (trace: ExecutionTrace) =>
      set((state) => {
        if (!trace || !trace.steps || trace.steps.length === 0) {
          console.error("Invalid trace received in setTrace");
          return;
        }

        const expandedSteps = expandTrace(trace.steps);
        const expandedTrace = { ...trace, steps: expandedSteps, totalSteps: expandedSteps.length };

        state.executionTrace = expandedTrace;
        state.totalSteps = expandedTrace.totalSteps;
        state.currentStep = 0;
        state.isPlaying = false;
        state.isPaused = false;
        state.isAnalyzing = false;
        state.analysisProgress = 100;
        state.analysisStage = 'complete';
        state.needsCanvasRebuild = true;
        
        if (state.playbackInterval) {
          clearInterval(state.playbackInterval);
          state.playbackInterval = null;
        }
        
        if (expandedTrace.steps.length > 0) {
          state.currentState = expandedTrace.steps[0].state;
        }
        
        console.log('✅ Trace loaded & expanded:', {
          originalSteps: trace.steps.length,
          expandedSteps: expandedTrace.totalSteps,
          startingAtStep: 0,
        });
      }),

    clearTrace: () => set(state => {
      state.executionTrace = null;
      state.totalSteps = 0;
      state.currentStep = 0;
      state.currentState = null;
      state.isAnalyzing = false;
      state.isPlaying = false;
      state.isPaused = false;
    }),

    setCurrentStep: (step: number) =>
      set((state) => {
        if (!state.executionTrace) return;
        const validStep = Math.max(0, Math.min(step, state.totalSteps - 1));
        state.currentStep = validStep;
        
        if (state.executionTrace.steps[validStep]) {
          state.currentState = state.executionTrace.steps[validStep].state;
          
          if (state.executionTrace.steps[validStep].pauseExecution) {
            state.isPaused = true;
            state.isPlaying = false;
          }
        }
      }),

    stepForward: () =>
      set((state) => {
        if (!state.executionTrace) return;
        if (state.currentStep < state.totalSteps - 1) {
          state.currentStep++;
          
          if (state.executionTrace.steps[state.currentStep]) {
            state.currentState = state.executionTrace.steps[state.currentStep].state;
            
            if (state.executionTrace.steps[state.currentStep].pauseExecution) {
              state.isPaused = true;
              state.isPlaying = false;
            }
          }
        } else {
          state.isPlaying = false;
          if (state.playbackInterval) {
            clearInterval(state.playbackInterval);
            state.playbackInterval = null;
          }
        }
      }),

    stepBackward: () =>
      set((state) => {
        if (!state.executionTrace) return;
        if (state.currentStep > 0) {
          state.currentStep--;
          state.needsCanvasRebuild = true;
          
          if (state.executionTrace.steps[state.currentStep]) {
            state.currentState = state.executionTrace.steps[state.currentStep].state;
          }
          
          if (state.isPlaying) {
            state.isPlaying = false;
            state.isPaused = true;
            if (state.playbackInterval) {
              clearInterval(state.playbackInterval);
              state.playbackInterval = null;
            }
          }
        }
      }),

    jumpToStep: (step: number) =>
      set((state) => {
        if (!state.executionTrace) return;
        const validStep = Math.max(0, Math.min(step, state.totalSteps - 1));
        const previousStep = state.currentStep;
        
        if (validStep < previousStep || validStep > previousStep + 1) {
          state.needsCanvasRebuild = true;
        }
        
        state.currentStep = validStep;
        
        if (state.executionTrace.steps[validStep]) {
          state.currentState = state.executionTrace.steps[validStep].state;
        }
        
        if (state.isPlaying) {
          state.isPlaying = false;
          state.isPaused = true;
          if (state.playbackInterval) {
            clearInterval(state.playbackInterval);
            state.playbackInterval = null;
          }
        }
      }),

    play: () =>
      set((state) => {
        if (!state.executionTrace || state.currentStep >= state.totalSteps - 1) {
          return;
        }
        
        state.isPlaying = true;
        state.isPaused = false;
        
        AnimationEngine.resume();
        
        if (state.playbackInterval) clearInterval(state.playbackInterval);
        
        const delay = 1000 / state.speed;
        
        state.playbackInterval = setInterval(() => {
          get().stepForward();
        }, delay);
      }),

    pause: () =>
      set((state) => {
        state.isPlaying = false;
        state.isPaused = true;
        
        if (state.playbackInterval) {
          clearInterval(state.playbackInterval);
          state.playbackInterval = null;
        }
        
        AnimationEngine.pause();
      }),

    reset: () =>
      set((state) => {
        if (!state.executionTrace) return;
        state.currentStep = 0;
        state.isPlaying = false;
        state.isPaused = false;
        state.needsCanvasRebuild = true;
        
        if (state.playbackInterval) {
          clearInterval(state.playbackInterval);
          state.playbackInterval = null;
        }
        
        if (state.executionTrace.steps.length > 0) {
          state.currentState = state.executionTrace.steps[0].state;
        }
      }),

    setSpeed: (speed: number) =>
      set((state) => {
        state.speed = speed;
        if (state.isPlaying) {
          get().play(); // Restart interval with new speed
        }
      }),

    setAnalyzing: (isAnalyzing: boolean) =>
      set((state) => {
        state.isAnalyzing = isAnalyzing;
        if (isAnalyzing) {
          state.analysisProgress = 0;
          state.analysisStage = 'starting';
        }
      }),

    setAnalysisProgress: (progress: number, stage: string) =>
      set((state) => {
        state.analysisProgress = progress;
        state.analysisStage = stage;
      }),

    startAnalysis: () =>
      set((state) => {
        state.isAnalyzing = true;
        state.analysisProgress = 0;
        state.analysisStage = 'parsing';
        state.executionTrace = null;
        state.totalSteps = 0;
        state.currentStep = 0;
        state.currentState = null;
      }),

    // Computed getters
    getCurrentStep: () => {
      const state = get();
      if (!state.executionTrace) return null;
      return state.executionTrace.steps[state.currentStep] || null;
    },

    canStepForward: () => {
      const state = get();
      return state.currentStep < state.totalSteps - 1;
    },

    canStepBackward: () => {
      const state = get();
      return state.currentStep > 0;
    },

    markCanvasRebuildComplete: () =>
      set((state) => {
        state.needsCanvasRebuild = false;
      }),
  }))
);