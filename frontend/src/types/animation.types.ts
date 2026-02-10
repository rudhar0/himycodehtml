// frontend/src/types/animation.types.ts
import Konva from 'konva';

export type AnimationType =
  | 'variable_create'
  | 'variable_update'
  | 'variable_access'
  | 'function_call'
  | 'function_return'
  | 'loop_iteration'
  | 'memory_allocation'
  | 'memory_deallocation'
  | 'array_access'
  | 'element_destroy'
  | 'line_execution';

export interface BaseAnimation {
  type: AnimationType;
  duration: number;
  target: string; // Corresponds to an ID on the canvas
  konvaObject?: Konva.Node | Konva.Shape | Konva.Group | null; // The actual Konva object
}

export interface VariableCreateAnimation extends BaseAnimation {
  type: 'variable_create';
}

export interface VariableUpdateAnimation extends BaseAnimation {
  type: 'variable_update';
  from: any;
  to: any;
  valueTextNode?: Konva.Text;
  backgroundRect?: Konva.Rect;
}

export interface LineExecutionAnimation extends BaseAnimation {
  type: 'line_execution';
}

export interface VariableAccessAnimation extends BaseAnimation {
  type: 'variable_access';
}

export interface FunctionCallAnimation extends BaseAnimation {
  type: 'function_call';
  // Information about the new stack frame
}

export interface FunctionReturnAnimation extends BaseAnimation {
  type: 'function_return';
  // Return value information
}

export interface LoopIterationAnimation extends BaseAnimation {
    type: 'loop_iteration';
    iteration: number;
    totalIterations: number;
}

export interface MemoryAllocationAnimation extends BaseAnimation {
    type: 'memory_allocation';
    // Memory block information
}

export interface ArrayAccessAnimation extends BaseAnimation {
    type: 'array_access';
    index: number;
}

export interface ElementDestroyAnimation extends BaseAnimation { // New interface for destroy animation
    type: 'element_destroy';
}


export type Animation =
  | VariableCreateAnimation
  | VariableUpdateAnimation
  | VariableAccessAnimation
  | FunctionCallAnimation
  | FunctionReturnAnimation
  | LoopIterationAnimation
  | MemoryAllocationAnimation
  | ArrayAccessAnimation
  | ElementDestroyAnimation
  | LineExecutionAnimation;

export type AnimationSequence = Animation[];
