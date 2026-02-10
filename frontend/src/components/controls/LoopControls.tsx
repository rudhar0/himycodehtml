// frontend/src/components/controls/LoopControls.tsx
// Loop-specific controls: Toggle Mode and Skip Loop

import React from 'react';
import { RotateCcw, FastForward, Layers, LayersIcon } from 'lucide-react';
import { useExecutionStore } from '@store/slices/executionSlice';
import { useLoopStore } from '@store/slices/loopSlice';
import { COLORS } from '@config/theme.config';

export default function LoopControls() {
  const {
    // currentStep, // Unused
    // totalSteps, // Unused
    // getCurrentStep, // Unused
    // jumpToStep, // Unused
  } = useExecutionStore();

  const {
    toggleMode,
    setToggleMode,
    skipCurrentLoop,
    canSkipLoop,
    getCurrentLoopInfo,
  } = useLoopStore();

    // const currentStepData = getCurrentStep(); // Unused
  const loopInfo = getCurrentLoopInfo();
  const isInLoop = loopInfo !== null;
  const canSkip = canSkipLoop();

  const handleToggleMode = () => {
    setToggleMode(!toggleMode);
  };

  const handleSkipLoop = () => {
    if (canSkip && loopInfo) {
      skipCurrentLoop();
    }
  };

  // Calculate skip percentage
  const getSkipPercentage = () => {
    if (!loopInfo || !loopInfo.totalIterations) return 0;
    const remaining = loopInfo.totalIterations - loopInfo.currentIteration;
    return Math.min(90, (remaining / loopInfo.totalIterations) * 100);
  };

  return (
    <div className="flex items-center gap-2">
      {/* Toggle Mode Button */}
      <div className="relative group">
        <button
          onClick={handleToggleMode}
          className={`
            rounded-lg px-3 py-2 transition-all duration-200
            flex items-center gap-2
            ${toggleMode
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
            }
            disabled:opacity-30 disabled:cursor-not-allowed
          `}
          title={toggleMode ? 'Toggle Mode: ON (Update in place)' : 'Toggle Mode: OFF (Create new elements)'}
        >
          {toggleMode ? (
            <Layers className="h-4 w-4" />
          ) : (
            <LayersIcon className="h-4 w-4" />
          )}
          <span className="text-xs font-semibold">
            {toggleMode ? 'UPDATE' : 'CREATE'}
          </span>
        </button>
        
        {/* Tooltip */}
        <div className="
          absolute bottom-full left-1/2 -translate-x-1/2 mb-2
          px-3 py-2 bg-slate-900 text-white text-xs rounded-lg
          opacity-0 group-hover:opacity-100 pointer-events-none
          transition-opacity duration-200 whitespace-nowrap
          border border-slate-700
          z-50
        ">
          <div className="font-semibold mb-1">
            {toggleMode ? '🔄 Toggle Mode: ON' : '📋 Toggle Mode: OFF'}
          </div>
          <div className="text-slate-300">
            {toggleMode 
              ? 'Updates elements in place during loops'
              : 'Creates new elements for each update'
            }
          </div>
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1">
            <div className="w-2 h-2 bg-slate-900 border-slate-700 border-r border-b transform rotate-45"></div>
          </div>
        </div>
      </div>

      {/* Skip Loop Button */}
      <div className="relative group">
        <button
          onClick={handleSkipLoop}
          disabled={!canSkip}
          className={`
            rounded-lg px-3 py-2 transition-all duration-200
            flex items-center gap-2
            ${isInLoop && canSkip
              ? 'bg-orange-600 hover:bg-orange-700 text-white'
              : 'bg-slate-700 text-slate-500'
            }
            disabled:opacity-30 disabled:cursor-not-allowed
          `}
          title={canSkip ? `Skip remaining ${getSkipPercentage().toFixed(0)}% of loop` : 'No active loop'}
        >
          <FastForward className="h-4 w-4" />
          <span className="text-xs font-semibold">
            SKIP
          </span>
          {isInLoop && loopInfo && (
            <span className="text-xs opacity-75">
              ({loopInfo.currentIteration}/{loopInfo.totalIterations})
            </span>
          )}
        </button>

        {/* Tooltip */}
        {isInLoop && canSkip && (
          <div className="
            absolute bottom-full left-1/2 -translate-x-1/2 mb-2
            px-3 py-2 bg-slate-900 text-white text-xs rounded-lg
            opacity-0 group-hover:opacity-100 pointer-events-none
            transition-opacity duration-200 whitespace-nowrap
            border border-slate-700
            z-50
          ">
            <div className="font-semibold mb-1">
              ⚡ Skip Loop
            </div>
            <div className="text-slate-300">
              Jump to end of loop
            </div>
            <div className="text-orange-400 text-xs mt-1">
              Jumping to step {loopInfo?.endStepIndex}
            </div>
            <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1">
              <div className="w-2 h-2 bg-slate-900 border-slate-700 border-r border-b transform rotate-45"></div>
            </div>
          </div>
        )}
      </div>

      {/* Loop Info Display */}
      {isInLoop && loopInfo && (
        <div className="ml-2 flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-1.5 border border-slate-700">
          <div className="flex items-center gap-1">
            <RotateCcw className="h-3 w-3 text-blue-400" />
            <span className="text-xs font-medium text-slate-300">
              Loop
            </span>
          </div>
          <div className="text-xs text-slate-500">|</div>
          <div className="flex items-center gap-1">
            <span className="text-xs font-bold text-blue-400">
              {loopInfo.currentIteration}
            </span>
            <span className="text-xs text-slate-500">
              / {loopInfo.totalIterations}
            </span>
          </div>
          {loopInfo.loopType && (
            <>
              <div className="text-xs text-slate-500">|</div>
              <span className="text-xs text-slate-400 uppercase">
                {loopInfo.loopType}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}