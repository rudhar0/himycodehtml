// src/store/selectors/executionSelectors.ts
// ============================================================================
// Memoized selectors for execution state
// ============================================================================

import type { ExecutionStep, MemoryState } from '../../types';
import { useExecutionStore } from '../slices/executionSlice';

/**
 * Select the current execution step (memoized by currentStep index).
 */
export function selectCurrentStep(): ExecutionStep | null {
  const state = useExecutionStore.getState();
  const { executionTrace, currentStep } = state;
  if (!executionTrace || currentStep < 0 || currentStep >= executionTrace.steps.length) {
    return null;
  }
  return executionTrace.steps[currentStep];
}

/**
 * Select the memory state at the current step.
 */
export function selectCurrentMemoryState(): MemoryState | null {
  const step = selectCurrentStep();
  return step?.state ?? null;
}

/**
 * Select playback state.
 */
export function selectPlaybackState() {
  const state = useExecutionStore.getState();
  return {
    isPlaying: state.isPlaying,
    isPaused: state.isPaused,
    speed: state.speed,
    currentStep: state.currentStep,
    totalSteps: state.executionTrace?.totalSteps ?? 0,
  };
}

/**
 * Hook-based selector for current step (reactive).
 */
export function useCurrentStep(): ExecutionStep | null {
  const executionTrace = useExecutionStore((s) => s.executionTrace);
  const currentStep = useExecutionStore((s) => s.currentStep);
  if (!executionTrace || currentStep < 0 || currentStep >= executionTrace.steps.length) {
    return null;
  }
  return executionTrace.steps[currentStep];
}

/**
 * Hook-based selector for total steps count.
 */
export function useTotalSteps(): number {
  return useExecutionStore((s) => s.executionTrace?.totalSteps ?? 0);
}
