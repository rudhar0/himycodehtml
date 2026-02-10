/**
 * Speed Control Component
 * Adjust playback speed (0.25x - 10x)
 */

import { Gauge } from 'lucide-react';
import { useExecutionStore } from '@store/slices/executionSlice';
import { PLAYBACK_SPEEDS } from '@constants/index';

export default function SpeedControl() {
  const { speed, setSpeed } = useExecutionStore();

  return (
    <div className="flex items-center gap-2">
      <Gauge className="h-4 w-4 text-[#5a6a7a] dark:text-slate-400" />
      
      <div className="flex items-center gap-1 rounded-lg bg-[#c8d0d8] dark:bg-slate-800 p-1">
        {PLAYBACK_SPEEDS.map((option) => (
          <button
            key={option.value}
            onClick={() => setSpeed(option.value)}
            className={`
              rounded px-3 py-1 text-sm font-medium transition-colors
              ${
                speed === option.value
                  ? 'bg-blue-600 text-white'
                  : 'text-[#5a6a7a] dark:text-slate-400 hover:bg-[#b0bac4] dark:hover:bg-slate-700 hover:text-[#1a2332] dark:hover:text-slate-200'
              }
            `}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}