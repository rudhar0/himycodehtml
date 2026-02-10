/**
 * Step Info Component
 * Display information about the current execution step
 */

import { Info } from 'lucide-react';
import { useExecutionStore } from '@store/slices/executionSlice';
import { COLORS } from '@config/theme.config';

export default function StepInfo() {
  const { getCurrentStep } = useExecutionStore();
  const currentStep = getCurrentStep();

  if (!currentStep) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-[#5a6a7a] dark:text-slate-500">
          <Info className="h-4 w-4" />
          <span>No execution trace available</span>
        </div>
      </div>
    );
  }

  // Get color based on step type
  const getStepColor = () => {
    switch (currentStep.type) {
      case 'function_call':
      case 'function_return':
        return COLORS.memory.stack.DEFAULT;
      case 'variable_declaration':
      case 'assignment':
        return COLORS.lifecycle.modified;
      case 'array_declaration':
        return COLORS.memory.array.DEFAULT;
      case 'heap_allocation':
      case 'heap_free':
        return COLORS.memory.heap.DEFAULT;
      case 'loop_start':
      case 'loop_iteration':
        return COLORS.flow.control.DEFAULT;
      case 'input_request':
        return COLORS.state.warning;
      default:
        return COLORS.brand.primary;
    }
  };

  return (
    <div className="flex h-full flex-col justify-center gap-1 rounded-lg bg-[#c8d0d8] dark:bg-slate-800 px-4 py-2">
      {/* Step Type Badge */}
      <div className="flex items-center gap-2">
        <div
          className="rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white"
          style={{ backgroundColor: getStepColor() }}
        >
          {currentStep.type.replace(/_/g, ' ')}
        </div>
        
        <span className="text-xs text-[#5a6a7a] dark:text-slate-500">
          Line {currentStep.line}
        </span>
      </div>

      {/* Explanation */}
      <div className="text-sm text-[#1a2332] dark:text-slate-300 line-clamp-2">
        {currentStep.explanation}
      </div>

      {/* Input Request Indicator */}
      {currentStep.pauseExecution && (
        <div className="mt-1 flex items-center gap-1 text-xs font-medium text-yellow-600 dark:text-yellow-400">
          <Info className="h-3 w-3" />
          <span>Waiting for user input</span>
        </div>
      )}
    </div>
  );
}