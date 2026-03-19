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
      <Gauge className="h-4 w-4 text-t3" />
      
      <div className="flex items-center gap-1 rounded-lg bg-bg0 p-1">
        {PLAYBACK_SPEEDS.map((option) => (
          <button
            key={option.value}
            onClick={() => setSpeed(option.value)}
            className={`
              rounded px-2 py-1 text-xs font-medium transition-colors font-mono
              ${
                speed === option.value
                  ? 'bg-acc text-white'
                  : 'text-t3 hover:bg-bg3 hover:text-t2'
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