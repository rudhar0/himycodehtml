/**
 * Timeline Scrubber Component
 * Interactive timeline slider for jumping to any step
 */

import * as Slider from '@radix-ui/react-slider';
import { useExecutionStore } from '@store/slices/executionSlice';
import { COLORS } from '@config/theme.config';

export default function TimelineScrubber() {
  const { currentStep, totalSteps, jumpToStep } = useExecutionStore();

  const hasTrace = totalSteps > 0;

  const handleValueChange = (values: number[]) => {
    jumpToStep(values[0]);
  };

  if (!hasTrace) {
    return (
      <div className="flex h-full items-center">
        <div className="w-full rounded-full bg-[#c8d0d8] dark:bg-slate-800 h-2" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <Slider.Root
        className="relative flex h-5 w-full touch-none select-none items-center"
        value={[currentStep]}
        max={totalSteps - 1}
        step={1}
        onValueChange={handleValueChange}
      >
        <Slider.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-[#b0bac4] dark:bg-slate-700">
          <Slider.Range 
            className="absolute h-full rounded-full" 
            style={{ backgroundColor: COLORS.brand.primary }}
          />
        </Slider.Track>
        
        <Slider.Thumb
          className="block h-5 w-5 rounded-full border-2 shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 transition-transform hover:scale-110"
          style={{
            backgroundColor: COLORS.brand.primary,
            borderColor: 'white',
          }}
          aria-label="Timeline position"
        />
      </Slider.Root>

      {/* Progress Percentage */}
      <div className="flex-shrink-0 text-sm font-medium text-[#5a6a7a] dark:text-slate-400 w-12 text-right">
        {Math.round((currentStep / (totalSteps - 1)) * 100)}%
      </div>
    </div>
  );
}