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
    const eventType = String(step.eventType || step.type || '').toLowerCase();
    
    // Handle both legacy 'function_call' and new 'func_enter'
    if (eventType === 'function_call' || eventType === 'func_enter') stackDepth++;

    // Handle variable creation from both old and new backends
    const primitiveVarTypes = ['int', 'float', 'double', 'char', 'bool', 'long', 'short', 'string'];
    const isPrimitiveEvent = primitiveVarTypes.includes(step.originalEventType as string) || primitiveVarTypes.includes(eventType);
    
    if (
      eventType === 'variable_declaration' ||
      eventType === 'global_declaration' ||
      eventType === 'var' ||
      eventType === 'var_declare' ||
      eventType === 'declare' ||
      isPrimitiveEvent
    ) {
      const varName = step.variable || step.name || step.symbol;
      const varType = step.dataType || step.varType || (isPrimitiveEvent ? step.originalEventType || eventType : undefined);
      const scope = (step.type === 'global_declaration' || step.scope === 'global') ? 'global' : 'local';

      if (varName && !variables.has(varName)) {
        variables.set(varName, {
          name: varName,
          type: varType || 'int',
          scope,
          birthStep: index,
          deathStep: null,
          isAlive: true,
          depth: stackDepth,
        });
      }
    }
    
    // Detect variable death from both legacy 'function_return' and new 'func_exit'
    if (eventType === 'function_return' || eventType === 'func_exit' || eventType === 'return') {
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

      <div className="space-y-4">
        {variableArray.map((variable) => {
          const birth = variable.birthStep;
          const death = variable.deathStep ?? totalSteps - 1;
          const lifespan = death - birth + 1;
          const isCurrentlyAlive = currentStep >= birth && currentStep <= death;
          
          // Calculate position and width for timeline bar
          const startPercent = (birth / totalSteps) * 100;
          const widthPercent = (lifespan / totalSteps) * 100;

          return (
            <div key={variable.name} className="space-y-2 pb-2 border-b border-[#c8d0d8]/30 dark:border-slate-800/50">
              {/* Header: Name & Type & Scope */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: isCurrentlyAlive 
                        ? COLORS.lifecycle.alive 
                        : COLORS.lifecycle.dead,
                      boxShadow: isCurrentlyAlive ? `0 0 8px ${COLORS.lifecycle.alive}` : 'none'
                    }}
                  />
                  <span className="text-sm font-semibold text-[#1a2332] dark:text-slate-200">
                    {variable.name}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[#5a6a7a] dark:text-slate-400 font-mono">
                    {variable.type}
                  </span>
                </div>
                
                <div className="flex items-center gap-2">
                   <span
                    className="text-[10px] uppercase font-bold px-2 py-0.5 rounded shadow-sm"
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
              </div>

              {/* Timeline Row */}
              <div className="flex items-center gap-3">
                <div className="flex-1">
                   {/* Timeline Bar Container */}
                    <div className="relative h-5 rounded-md bg-[#c8d0d8]/50 dark:bg-slate-900 border border-[#c8d0d8] dark:border-slate-800 overflow-hidden">
                      {/* Lifetime bar */}
                      <div
                        className="absolute h-full transition-all duration-300"
                        style={{
                          left: `${startPercent}%`,
                          width: `${widthPercent}%`,
                          backgroundColor: isCurrentlyAlive 
                            ? COLORS.lifecycle.alive 
                            : COLORS.lifecycle.dead,
                          opacity: isCurrentlyAlive ? 0.9 : 0.25,
                        }}
                      />
                      
                      {/* Current position marker */}
                      {isCurrentlyAlive && (
                        <div
                          className="absolute top-0 h-full w-0.5 bg-amber-400 z-10 shadow-[0_0_8px_rgba(251,191,36,0.8)]"
                          style={{
                            left: `${(currentStep / totalSteps) * 100}%`,
                          }}
                        />
                      )}

                      {/* Birth/Death labels overlaid on bar */}
                      <div className="absolute inset-0 flex items-center justify-between px-2 text-[9px] font-bold text-white/80 pointer-events-none uppercase">
                        <span>S{birth}</span>
                        <span>S{death}</span>
                      </div>
                    </div>
                </div>

                {/* Right side info: Life & Status */}
                <div className="flex flex-col items-end min-w-[70px]">
                   <div className="text-[10px] font-bold text-[#8a9aaa] dark:text-slate-500 uppercase flex items-center gap-1">
                      <span>Life:</span>
                      <span className="text-[#1a2332] dark:text-slate-300">{lifespan} steps</span>
                   </div>
                   <div className={`text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5 ${
                     isCurrentlyAlive 
                      ? 'text-emerald-500 bg-emerald-500/10' 
                      : 'text-rose-500 bg-rose-500/10'
                   } uppercase`}>
                     {isCurrentlyAlive ? 'Active' : 'Inactive'}
                   </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}