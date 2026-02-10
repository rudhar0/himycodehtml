import React, { useRef, useEffect, useMemo } from 'react';
import { Stage, Layer } from 'react-konva';
import { useStageSize } from './useStageSize';
import { useStepController } from './StepController';
import { RenderRegistry, VisualElement } from './RenderRegistry';
import { VariableBox } from './VariableBox';
import { FunctionFrame } from './FunctionFrame';
import { PointerArrow } from './PointerArrow';
import { animateStepChange } from './animateStep';
import { Play, Pause, SkipForward, SkipBack } from 'lucide-react';

// Mock store import - replace with your actual store
import { useExecutionStore } from '@store/slices/executionSlice';

export default function SceneManager() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<any>(null);
  
  // 1. Canvas Sizing
  const { width, height } = useStageSize(containerRef);

  // 2. Data Source
  const { executionTrace } = useExecutionStore();
  
  // 3. Step Control
  const {
    currentStep,
    isPlaying,
    togglePlay,
    nextStep,
    prevStep,
    setSpeed
  } = useStepController({ 
    totalSteps: executionTrace.length,
    initialSpeed: 800 
  });

  // 4. Render Logic (Registry)
  const elements = useMemo(() => {
    return RenderRegistry.getElementsForStep(executionTrace, currentStep);
  }, [executionTrace, currentStep]);

  // 5. Animation Trigger
  useEffect(() => {
    if (stageRef.current && executionTrace[currentStep]) {
      animateStepChange(stageRef.current, executionTrace[currentStep]);
    }
  }, [currentStep, executionTrace]);

  return (
    <div className="flex flex-col h-full w-full bg-slate-950">
      {/* Controls Toolbar */}
      <div className="flex items-center gap-4 p-2 border-b border-slate-800 bg-slate-900">
        <button onClick={prevStep} className="p-1 hover:bg-slate-800 rounded text-slate-300">
          <SkipBack size={20} />
        </button>
        <button onClick={togglePlay} className="p-1 hover:bg-slate-800 rounded text-blue-400">
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <button onClick={nextStep} className="p-1 hover:bg-slate-800 rounded text-slate-300">
          <SkipForward size={20} />
        </button>
        <span className="text-xs text-slate-500 font-mono">
          Step: {currentStep} / {executionTrace.length}
        </span>
        <select 
          className="ml-auto bg-slate-800 text-xs text-slate-300 rounded p-1 border border-slate-700"
          onChange={(e) => setSpeed(Number(e.target.value))}
          defaultValue={800}
        >
          <option value={1500}>Slow</option>
          <option value={800}>Normal</option>
          <option value={300}>Fast</option>
        </select>
      </div>

      {/* Canvas Container */}
      <div 
        ref={containerRef} 
        className="flex-1 relative overflow-hidden"
        style={{ minHeight: '400px' }} // Ensure minimum height
      >
        {width > 0 && height > 0 && (
          <Stage
            ref={stageRef}
            width={width}
            height={height}
            className="absolute inset-0"
          >
            <Layer>
              {elements.map((el: VisualElement) => {
                switch (el.type) {
                  case 'variable':
                    return <VariableBox key={el.id} {...el.props} />;
                  case 'frame':
                    return <FunctionFrame key={el.id} {...el.props} />;
                  case 'pointer':
                    return <PointerArrow key={el.id} {...el.props} />;
                  default:
                    return null;
                }
              })}
              
              {elements.length === 0 && (
                <VariableBox id="empty-state" x={width/2 - 60} y={height/2 - 30} name="System" value="Ready" />
              )}
            </Layer>
          </Stage>
        )}
      </div>
    </div>
  );
}