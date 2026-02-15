// frontend/src/hooks/useAnimationController.ts

import { useEffect, useRef } from 'react';
import Konva from 'konva';
import { useExecutionStore } from '@store/slices/executionSlice';
import AnimationEngine from '@/animations/AnimationEngine';
import type {
  AnimationSequence,
  VariableCreateAnimation,
  VariableUpdateAnimation,
  ElementDestroyAnimation,
} from '../types/animation.types';
import type { MemoryState, Variable, ExecutionStep } from '../types';

/**
 * Finds a variable by name in the current memory state (globals or top stack frame).
 */
function findVarInState(state: MemoryState, varName: string): Variable | undefined {
  const topFrame = state.callStack?.[0];
  if (topFrame?.locals?.[varName]) {
      return topFrame.locals[varName];
  }
  if (state.globals?.[varName]) {
      return state.globals[varName];
  }
  for (const frame of state.callStack) {
    if (frame.locals?.[varName]) {
      return frame.locals[varName];
    }
  }
  return undefined;
}


export const useAnimationController = (stage: Konva.Stage | null) => {
  const previousStepRef = useRef<number>(-1);
  const previousMemoryStateRef = useRef<MemoryState | null>(null);

  const currentStep = useExecutionStore((state) => state.currentStep);
  const executionTrace = useExecutionStore((state) => state.executionTrace);

  useEffect(() => {
    if (stage) {
      AnimationEngine.initialize(stage);
    }
  }, [stage]);

  useEffect(() => {
    if (!stage || !executionTrace || currentStep === previousStepRef.current) {
      return;
    }

    const currentExecutionStep = executionTrace[currentStep] as ExecutionStep | undefined;
    if (!currentExecutionStep) return;

    const previousState = previousMemoryStateRef.current;
    const currentState = currentExecutionStep.state;
    const animations: AnimationSequence = [];

    switch (currentExecutionStep.type) {
      // =====================================================================
      // NEW BACKEND TYPES (from instrumentation tracer)
      // =====================================================================

      case 'func_enter': {
        const funcName = currentExecutionStep.function;
        if (funcName) {
          const frameId = `frame-${funcName}`;
          animations.push({
            type: 'function_call',
            target: frameId,
            duration: 600,
          });
        }
        break;
      }

      case 'func_exit': {
        const funcName = currentExecutionStep.function;
        if (funcName) {
          const frameId = `frame-${funcName}`;
          animations.push({
            type: 'function_return',
            target: frameId,
            duration: 600,
          });
        }
        break;
      }

      case 'var': {
        const varName = currentExecutionStep.name;
        if (varName && previousState && currentState) {
          const updatedVar = findVarInState(currentState, varName);
          const previousVar = findVarInState(previousState, varName);

          if (updatedVar) {
            if (!previousVar) {
              animations.push({
                type: 'variable_create',
                target: `var-${updatedVar.address}`,
                duration: 500,
              } as VariableCreateAnimation);
            } 
            else if (JSON.stringify(updatedVar.value) !== JSON.stringify(previousVar.value)) {
              const varBoxGroup = stage.findOne<Konva.Group>(`#var-${updatedVar.address}`);
              if (varBoxGroup) {
                const valueTextNode = varBoxGroup.findOne<Konva.Text>('.variable-value');
                const backgroundRect = varBoxGroup.findOne<Konva.Rect>('.box-bg');
                if (valueTextNode && backgroundRect) {
                  animations.push({
                    type: 'variable_update',
                    target: `var-${updatedVar.address}`,
                    duration: 1000,
                    from: previousVar.value,
                    to: updatedVar.value,
                    konvaContainer: varBoxGroup,
                    valueTextNode: valueTextNode,
                    backgroundRect: backgroundRect,
                  } as VariableUpdateAnimation);
                }
              }
            } else {
              animations.push({
                type: 'variable_access',
                target: `var-${updatedVar.address}`,
                duration: 300,
              });
            }
          }
        }
        break;
      }

      case 'heap_alloc': {
        const address = (currentExecutionStep as any).addr || currentExecutionStep.address;
        if (address) {
          animations.push({
            type: 'memory_allocation',
            target: `heap-${address}`,
            duration: 500,
          });
        }
        break;
      }

      case 'heap_free': {
        const address = (currentExecutionStep as any).addr || currentExecutionStep.address;
        if (address) {
          animations.push({
            type: 'element_destroy',
            target: `heap-${address}`,
            duration: 500,
          } as any);
        }
        break;
      }

      case 'program_end':
        break;

      // =====================================================================
      // OUTPUT / STDOUT EVENTS
      // =====================================================================
      case 'output': {
        const outputText = currentExecutionStep.value || (currentExecutionStep as any).stdout;
        if (outputText) {
          animations.push({
            type: 'line_execution',
            target: 'output-console',
            duration: 1500,
            text: String(outputText),
            id: `output-${currentStep}`,
          } as any);
        }
        break;
      }

      // =====================================================================
      // LEGACY FRONTEND TYPES (for backward compatibility)
      // =====================================================================

      case 'variable_declaration':
      case 'object_creation':
      case 'pointer_declaration':
      case 'array_declaration': {
        const varName = currentExecutionStep.variable || currentExecutionStep.objectName;
        if (varName) {
          const newVar = findVarInState(currentState, varName);
          if (newVar) {
            animations.push({
              type: 'variable_create',
              target: `var-${newVar.address}`,
              duration: 500,
            } as VariableCreateAnimation);
          }
        }
        break;
      }

      case 'assignment': {
        const varName = currentExecutionStep.variable;
        if (varName && previousState) {
          const updatedVar = findVarInState(currentState, varName);
          const previousVar = findVarInState(previousState, varName);

          if (updatedVar && previousVar && JSON.stringify(updatedVar.value) !== JSON.stringify(previousVar.value)) {
            const varBoxGroup = stage.findOne<Konva.Group>(`#var-${updatedVar.address}`);
            if (varBoxGroup) {
              const valueTextNode = varBoxGroup.findOne<Konva.Text>('.variable-value');
              const backgroundRect = varBoxGroup.findOne<Konva.Rect>('.box-bg');
              if (valueTextNode && backgroundRect) {
                animations.push({
                  type: 'variable_update',
                  target: `var-${updatedVar.address}`,
                  duration: 1000,
                  from: previousVar.value,
                  to: updatedVar.value,
                  konvaContainer: varBoxGroup,
                  valueTextNode: valueTextNode,
                  backgroundRect: backgroundRect,
                } as VariableUpdateAnimation);
              }
            }
          }
        }
        break;
      }
      
      case 'object_destruction': {
        const address = currentExecutionStep.address;
        if (address) {
          animations.push({
            type: 'element_destroy',
            target: `var-${address}`,
            duration: 500,
          } as ElementDestroyAnimation);
        }
        break;
      }

      case 'pointer_deref': {
        const varName = currentExecutionStep.variable;
        if (varName) {
            const ptrVar = findVarInState(currentState, varName);
            if(ptrVar) {
                animations.push({
                    type: 'variable_access',
                    target: `var-${ptrVar.address}`,
                    duration: 500,
                });
            }
        }
        break;
      }

      case 'function_call': {
        const funcName = currentExecutionStep.function;
        if (funcName) {
            const frameId = `frame-${funcName}`;
            animations.push({
                type: 'function_call',
                target: frameId,
                duration: 600,
            });
        }
        break;
      }

      case 'function_return': {
        const funcName = currentExecutionStep.function;
        if (funcName) {
            const frameId = `frame-${funcName}`;
            animations.push({
                type: 'function_return',
                target: frameId,
                duration: 600,
            });
        }
        break;
      }

      case 'heap_allocation': {
        const address = currentExecutionStep.address;
        if (address) {
            animations.push({
                type: 'memory_allocation',
                target: `heap-${address}`,
                duration: 500,
            });
        }
        break;
      }

      case 'line_execution':
      case 'loop_start':
      case 'loop_end':
      case 'conditional_start':
      case 'conditional_branch':
        break;

      case 'input_request':
        break;

      default:
        break;
    }

    if (animations.length > 0) {
      const sequenceTimeline = AnimationEngine.createSequence(animations);
      AnimationEngine.addSequence(sequenceTimeline);
    }

    previousStepRef.current = currentStep;
    previousMemoryStateRef.current = currentState;

  }, [currentStep, executionTrace, stage]);
};
