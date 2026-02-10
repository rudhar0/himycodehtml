/**
 * Variable Lifetime Component
 * Timeline view showing when variables are alive/dead
 */

import { Clock, Activity } from 'lucide-react';
import { useExecutionStore } from '@store/slices/executionSlice';
import { COLORS } from '@config/theme.config';

export default function VariableLifetime() {
  const { executionTrace, currentStep, totalSteps } = useExecutionStore();

  // Extract all variables with their lifetime
  const variables = new Map<string, {
    name: string;
    type: string;
    scope: string;
    birthStep: number;
    deathStep: number | null;
    isAlive: boolean;
    depth: number;
  }>();

  let stackDepth = 0;

  // Guard against null/undefined executionTrace
  const steps = executionTrace?.steps || [];
  
  steps.forEach((step: any, index: number) => {
    // Handle both legacy 'function_call' and new 'func_enter'
    if (step.type === 'function_call' || step.type === 'func_enter') stackDepth++;

    // Handle variable creation from both old and new backends
    const primitiveVarTypes = ['int', 'float', 'double', 'char', 'bool', 'long', 'short'];
    const isPrimitiveEvent = primitiveVarTypes.includes((step as any).originalEventType as string);
    if (
      step.type === 'variable_declaration' ||
      step.type === 'global_declaration' ||
      step.type === 'var' ||
      isPrimitiveEvent
    ) {
      const varName = (step as any).variable || (step as any).name;
      const varType = (step as any).dataType || (step as any).varType || (isPrimitiveEvent ? (step as any).originalEventType : undefined);
      const scope = step.type === 'global_declaration' ? 'global' : 'local';

      if (varName && !variables.has(varName)) {
        variables.set(varName, {
          name: varName,
          type: varType,
          scope,
          birthStep: index,
          deathStep: null,
          isAlive: true,
          depth: stackDepth,
        });
      }
    }
    
    // Detect variable death from both legacy 'function_return' and new 'func_exit'
    if (step.type === 'function_return' || step.type === 'func_exit') {
      variables.forEach((v) => {
        // Only kill locals at the current stack depth
        if (v.scope === 'local' && v.deathStep === null && v.depth === stackDepth) {
          v.deathStep = index;
          v.isAlive = false;
        }
      });
      stackDepth--;
    }
  });

  const variableArray = Array.from(variables.values());

  if (variableArray.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="text-center text-sm text-[#5a6a7a] dark:text-slate-500">
          <Activity className="mx-auto mb-2 h-8 w-8 opacity-50" />
          <p>No variables to track</p>
          <p className="mt-1 text-xs">Run code to see lifetimes</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="mb-3 flex items-center gap-2 text-sm text-[#5a6a7a] dark:text-slate-400">
        <Clock className="h-4 w-4" />
        <span>Variable Lifetimes</span>
      </div>

      <div className="space-y-3">
        {variableArray.map((variable) => {
          const birth = variable.birthStep;
          const death = variable.deathStep ?? totalSteps - 1;
          const lifespan = death - birth;
          const isCurrentlyAlive = currentStep >= birth && currentStep <= death;
          
          // Calculate position and width for timeline bar
          const startPercent = (birth / totalSteps) * 100;
          const widthPercent = (lifespan / totalSteps) * 100;

          return (
            <div key={variable.name} className="space-y-1">
              {/* Variable Name & Info */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: isCurrentlyAlive 
                        ? COLORS.lifecycle.alive 
                        : COLORS.lifecycle.dead
                    }}
                  />
                  <span className="text-sm font-medium text-[#1a2332] dark:text-slate-300">
                    {variable.name}
                  </span>
                  <span className="text-xs text-[#8a9aaa] dark:text-slate-500">
                    {variable.type}
                  </span>
                </div>
                
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded"
                  style={{
                    backgroundColor: variable.scope === 'global' 
                      ? COLORS.memory.global.dark 
                      : COLORS.memory.stack.dark,
                    color: 'white'
                  }}
                >
                  {variable.scope}
                </span>
              </div>

              {/* Timeline Bar */}
              <div className="relative h-6 rounded bg-[#c8d0d8] dark:bg-slate-800">
                {/* Lifetime bar */}
                <div
                  className="absolute h-full rounded transition-opacity"
                  style={{
                    left: `${startPercent}%`,
                    width: `${widthPercent}%`,
                    backgroundColor: isCurrentlyAlive 
                      ? COLORS.lifecycle.alive 
                      : COLORS.lifecycle.dead,
                    opacity: isCurrentlyAlive ? 1 : 0.3,
                  }}
                />
                
                {/* Current position marker */}
                {isCurrentlyAlive && (
                  <div
                    className="absolute top-0 h-full w-0.5 bg-yellow-400"
                    style={{
                      left: `${(currentStep / totalSteps) * 100}%`,
                    }}
                  />
                )}

                {/* Birth/Death labels */}
                <div className="absolute inset-0 flex items-center justify-between px-2 text-xs text-white">
                  <span>↓ {birth}</span>
                  <span>{death} ↑</span>
                </div>
              </div>

              {/* Lifetime Stats */}
              <div className="flex justify-between text-xs text-[#8a9aaa] dark:text-slate-500">
                <span>Born: Step {birth}</span>
                <span>
                  {variable.deathStep ? `Died: Step ${death}` : 'Still alive'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}