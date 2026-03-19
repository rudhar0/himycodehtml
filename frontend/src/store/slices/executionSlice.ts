import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { ExecutionStep, ExecutionTrace, MemoryState } from '../../types';
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
  analysisError: string | null;
  analysisStartTime: number | null;
  analysisStageDurations: Record<string, number>;
  totalGeneratedSteps: number | null;
  
  // Playback interval
  playbackInterval: any | null;
  
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
  setAnalysisError: (error: string | null) => void;
  dismissAnalysisResult: () => void;
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
    if ((step.type as string) === 'loop_body_summary' && (step as any).events) {
       expanded.push(...expandTrace((step as any).events as ExecutionStep[]));
    } else {
       const eventType = ((step as any).eventType || (step as any).type || '').toLowerCase();
       if (eventType === 'branch_taken' || eventType === 'branch') {
         const branchTakenRaw = String((step as any).branch || (step as any).branchType || (step as any).branchTaken || '');
         if (branchTakenRaw.trim().toLowerCase() === 'else') {
           // Inject an earlier evaluation step for else
           expanded.push({
             ...step,
             eventType: 'else_eval',
             type: 'else_eval',
           } as any);
         }
       }
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
    analysisError: null,
    analysisStartTime: null,
    analysisStageDurations: {},
    totalGeneratedSteps: null,
    playbackInterval: null,
    needsCanvasRebuild: false,

    // Actions
   setTrace: (trace: ExecutionTrace) =>
      set((state) => {
        if (!trace || !trace.steps || trace.steps.length === 0) {
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
        state.analysisError = null;
        state.totalGeneratedSteps = expandedTrace.totalSteps;
        state.needsCanvasRebuild = true;
        
        if (state.playbackInterval) {
          clearInterval(state.playbackInterval);
          state.playbackInterval = null;
        }
        
        if (expandedTrace.steps.length > 0) {
          state.currentState = expandedTrace.steps[0].state;
        }
        

      }),

    clearTrace: () => set(state => {
      state.executionTrace = null;
      state.totalSteps = 0;
      state.currentStep = 0;
      state.currentState = null;
      state.isAnalyzing = false;
      state.isPlaying = false;
      state.isPaused = false;
      state.analysisError = null;
      state.analysisStartTime = null;
      state.analysisStageDurations = {};
      state.totalGeneratedSteps = null;
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
          state.analysisError = null;
          state.analysisStartTime = Date.now();
          state.analysisStageDurations = {};
          state.totalGeneratedSteps = null;
        }
      }),

    setAnalysisProgress: (progress: number, stage: string) =>
      set((state) => {
        const prevStage = state.analysisStage;
        if (prevStage !== stage && state.analysisStartTime) {
          // Calculate duration for the previous stage
          const now = Date.now();
          // We'll track the start time of the CURRENT stage to calculate duration later
          // For simplicity, we just store the absolute time when each stage was reached
          state.analysisStageDurations[prevStage] = (now - (state.analysisStartTime + Object.values(state.analysisStageDurations).reduce((a, b) => a + b, 0) * 1000)) / 1000;
          
          // Actually, a simpler way: just store the timestamp when each stage started
          (state as any)._stageStartTimes = (state as any)._stageStartTimes || {};
          const lastStageStart = (state as any)._stageStartTimes[prevStage] || state.analysisStartTime;
          state.analysisStageDurations[prevStage] = (now - lastStageStart) / 1000;
          (state as any)._stageStartTimes[stage] = now;
        }
        
        state.analysisProgress = progress;
        state.analysisStage = stage;
      }),

    setAnalysisError: (error: string | null) =>
      set((state) => {
        state.analysisError = error;
        state.isAnalyzing = false;
      }),

    dismissAnalysisResult: () =>
      set((state) => {
        state.isAnalyzing = false;
        state.analysisStage = 'idle';
        state.analysisError = null;
        state.analysisProgress = 0;
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