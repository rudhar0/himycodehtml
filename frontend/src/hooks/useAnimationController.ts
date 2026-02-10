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
 * @param state The memory state.
 * @param varName The name of the variable to find.
 * @returns The variable object or undefined if not found.
 */
function findVarInState(state: MemoryState, varName: string): Variable | undefined {
  const topFrame = state.callStack?.[0];
  if (topFrame?.locals?.[varName]) {
      return topFrame.locals[varName];
  }
  if (state.globals?.[varName]) {
      return state.globals[varName];
  }
  // This part is a fallback, ideally the scope is known from the step
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

    console.log(`[AnimationController] Processing step ${currentStep}:`, currentExecutionStep.type);

    // =========================================================================
    // BACKEND COMPATIBILITY LAYER (2026-01-18)
    // Maps new instrumentation backend types to animation actions
    // =========================================================================
    // Backend type → Animation action mapping:
    //   func_enter  → stack frame push (visual call stack)
    //   func_exit   → stack frame pop
    //   var         → variable highlight + value transition
    //   heap_alloc  → heap memory grow
    //   heap_free   → heap memory shrink
    //   program_end → execution complete
    // =========================================================================

    switch (currentExecutionStep.type) {
      // =====================================================================
      // NEW BACKEND TYPES (from instrumentation tracer)
      // =====================================================================

      // func_enter: Function entry (stack frame push animation)
      case 'func_enter': {
        const funcName = currentExecutionStep.function;
        if (funcName) {
          console.log(`[AnimationController] Stack PUSH: ${funcName}()`);
          const frameId = `frame-${funcName}`;
          animations.push({
            type: 'function_call',
            target: frameId,
            duration: 600,
          });
        }
        break;
      }

      // func_exit: Function exit (stack frame pop animation)
      case 'func_exit': {
        const funcName = currentExecutionStep.function;
        if (funcName) {
          console.log(`[AnimationController] Stack POP: ${funcName}()`);
          const frameId = `frame-${funcName}`;
          animations.push({
            type: 'function_return',
            target: frameId,
            duration: 600,
          });
        }
        break;
      }

      // var: Variable trace (assignment/update animation)
      case 'var': {
        const varName = currentExecutionStep.name;
        if (varName && previousState && currentState) {
          const updatedVar = findVarInState(currentState, varName);
          const previousVar = findVarInState(previousState, varName);

          if (updatedVar) {
            // If this is first appearance, treat as creation
            if (!previousVar) {
              console.log(`[AnimationController] Variable created: ${varName} = ${updatedVar.value}`);
              animations.push({
                type: 'variable_create',
                target: `var-${updatedVar.address}`,
                duration: 500,
              } as VariableCreateAnimation);
            } 
            // Otherwise, it's an update
            else if (JSON.stringify(updatedVar.value) !== JSON.stringify(previousVar.value)) {
              console.log(`[AnimationController] Variable updated: ${varName} → ${updatedVar.value}`);
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
              // Value didn't change but variable was traced → highlight access
              console.log(`[AnimationController] Variable accessed: ${varName}`);
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

      // heap_alloc: Heap allocation animation
      case 'heap_alloc': {
        const address = currentExecutionStep.addr;
        if (address) {
          console.log(`[AnimationController] Heap allocated at: ${address}`);
          animations.push({
            type: 'memory_allocation',
            target: `heap-${address}`,
            duration: 500,
          });
        }
        break;
      }

      // heap_free: Heap deallocation (memory shrink)
      case 'heap_free': {
        const address = currentExecutionStep.addr;
        if (address) {
          console.log(`[AnimationController] Heap freed at: ${address}`);
          animations.push({
            type: 'element_destroy',
            target: `heap-${address}`,
            duration: 500,
          } as ElementDestroyAnimation);
        }
        break;
      }

      // program_end: Execution complete (no animation needed, just log)
      case 'program_end': {
        console.log(`[AnimationController] Program execution completed`);
        break;
      }

      // =====================================================================
      // OUTPUT / STDOUT EVENTS (print, cout, puts, printf, fprintf, etc.)
      // =====================================================================
      case 'output': {
        const outputText = currentExecutionStep.value || (currentExecutionStep as any).stdout;
        if (outputText) {
          console.log(`[Program Output] ${outputText}`);
          animations.push({
            type: 'output_display',
            target: 'output-console',
            duration: 1500, // Visible for 1.5 seconds
            text: String(outputText),
            id: `output-${currentStep}`,
          });
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
            console.log(`[AnimationController] Variable declared: ${varName}`);
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
            console.log(`[AnimationController] Variable assigned: ${varName}`);
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
          console.log(`[AnimationController] Object destructed at: ${address}`);
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
                console.log(`[AnimationController] Pointer dereferenced: ${varName}`);
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
            console.log(`[AnimationController] Function call: ${funcName}`);
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
            console.log(`[AnimationController] Function return: ${funcName}`);
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
            console.log(`[AnimationController] Heap allocated: ${address}`);
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
        console.log(`[AnimationController] Line event: ${currentExecutionStep.type} @ L${currentExecutionStep.line}`);
        break;

      case 'output': {
        const outputText = currentExecutionStep.value;
        if (typeof outputText === 'string') {
          console.log(`[Program Output] ${outputText}`);
          animations.push({
            type: 'output_display',
            target: 'overlay',
            duration: 1500, // Make it visible for a bit
            text: outputText,
            id: `output-${currentStep}`, // Unique ID for the animation element
          });
        }
        break;
      }

      case 'input_request':
        console.log(`[Input Request]`, currentExecutionStep);
        break;

      default:
        console.warn(`[AnimationController] Unknown step type: "${currentExecutionStep.type}". Skipping animation.`);
    }

    if (animations.length > 0) {
      const sequenceTimeline = AnimationEngine.createSequence(animations);
      AnimationEngine.addSequence(sequenceTimeline);
    }

    previousStepRef.current = currentStep;
    previousMemoryStateRef.current = currentState;

  }, [currentStep, executionTrace, stage]);
};
