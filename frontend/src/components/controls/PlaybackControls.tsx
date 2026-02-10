/**
 * Playback Controls Component
 * Play, pause, step forward/backward, reset
 */

import { 
  SkipBack, 
  ChevronLeft, 
  Play, 
  Pause, 
  ChevronRight, 
  SkipForward 
} from 'lucide-react';
import { useExecutionStore } from '@store/slices/executionSlice';
import { COLORS } from '@config/theme.config';
import LoopControls from './LoopControls';

export default function PlaybackControls() {
  const {
    isPlaying,
    currentStep,
    totalSteps,
    play,
    pause,
    stepForward,
    stepBackward,
    reset,
    canStepForward,
    canStepBackward,
  } = useExecutionStore();

  const hasTrace = totalSteps > 0;
  const isAtStart = currentStep === 0;
  const isAtEnd = currentStep === totalSteps - 1;

  return (
    <div className="flex items-center gap-2">
      {/* Reset to Start */}
      <button
        onClick={reset}
        disabled={!hasTrace || isAtStart}
        className="rounded p-2 hover:bg-[#c8d0d8] dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="Reset to Start"
      >
        <SkipBack className="h-5 w-5 text-[#5a6a7a] dark:text-slate-300" />
      </button>

      {/* Step Backward */}
      <button
        onClick={stepBackward}
        disabled={!hasTrace || !canStepBackward()}
        className="rounded p-2 hover:bg-[#c8d0d8] dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="Step Backward"
      >
        <ChevronLeft className="h-5 w-5 text-[#5a6a7a] dark:text-slate-300" />
      </button>

      {/* Play/Pause */}
      <button
        onClick={isPlaying ? pause : play}
        disabled={!hasTrace || isAtEnd}
        className="rounded-lg p-3 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        style={{
          backgroundColor: isPlaying 
            ? COLORS.state.warning 
            : COLORS.state.success,
        }}
        title={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? (
          <Pause className="h-6 w-6 text-white fill-white" />
        ) : (
          <Play className="h-6 w-6 text-white fill-white" />
        )}
      </button>

      {/* Step Forward */}
      <button
        onClick={stepForward}
        disabled={!hasTrace || !canStepForward()}
        className="rounded p-2 hover:bg-[#c8d0d8] dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="Step Forward"
      >
        <ChevronRight className="h-5 w-5 text-[#5a6a7a] dark:text-slate-300" />
      </button>

      {/* Skip to End */}
      <button
        onClick={() => useExecutionStore.getState().jumpToStep(totalSteps - 1)}
        disabled={!hasTrace || isAtEnd}
        className="rounded p-2 hover:bg-[#c8d0d8] dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="Skip to End"
      >
        <SkipForward className="h-5 w-5 text-[#5a6a7a] dark:text-slate-300" />
      </button>

      {/* Step Counter */}
      {hasTrace && (
        <div className="ml-4 flex items-center gap-2 rounded-lg bg-[#c8d0d8] dark:bg-slate-800 px-3 py-1.5">
          <span className="text-sm font-medium text-[#1a2332] dark:text-slate-300">
            Step
          </span>
          <span 
            className="text-lg font-bold"
            style={{ color: COLORS.brand.primary }}
          >
            {currentStep + 1}
          </span>
          <span className="text-sm text-[#5a6a7a] dark:text-slate-500">
            / {totalSteps}
          </span>
        </div>
      )}
      {/* Loop Controls */}
      <LoopControls />
    </div>
  );
}