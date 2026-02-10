// frontend/src/components/canvas/types.ts
// COMPLETE - All existing types + function types

export interface CanvasTransform {
  scale: number;
  position: { x: number; y: number };
}

export interface VariableData {
  id: string;
  name: string;
  type: string;
  value: any;
  address: string;
  x: number;
  y: number;
  width: number;
  height: number;
  section: 'global' | 'stack' | 'heap';
  isNew?: boolean;
  isUpdated?: boolean;
  previousValue?: any;
  expression?: string;
  isInitialized?: boolean;
  declarationType?: 'with_value' | 'without_value' | 'multiple';
  isAccessed?: boolean;
  accessType?: 'read' | 'write';
}

export interface StackFrameData {
  id: string;
  function: string;
  returnType: string;
  isActive: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  locals: VariableData[];
  output: OutputData[];
}

export interface ArrayData {
  id: string;
  name: string;
  type: string;
  cells: ArrayCell[];
  x: number;
  y: number;
  cellWidth: number;
  cellHeight: number;
  section: 'global' | 'stack' | 'heap';
}

export interface ArrayCell {
  index: number;
  value: any;
  address: string;
  isUpdated?: boolean;
  previousValue?: any;
}

export interface PointerArrowData {
  id: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  color: string;
  fromVar: string;
  toVar: string;
}

export interface HeapBlockData {
  id: string;
  address: string;
  size: number;
  type: string;
  value: any;
  x: number;
  y: number;
  width: number;
  height: number;
  allocated: boolean;
}

export interface OutputData {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

export interface LoopIndicatorData {
  id: string;
  iteration: number;
  total: number;
  x: number;
  y: number;
}

// ============================================
// FUNCTION-RELATED TYPES
// ============================================

export interface FunctionParameter {
  name: string;
  type: string;
  value?: any;
}

export interface FunctionData {
  id: string;
  functionName: string;
  returnType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isRecursive: boolean;
  depth: number;
  calledFrom?: string;
  parameters: FunctionParameter[];
  localVarCount: number;
  isActive: boolean;
  isReturning: boolean;
  birthStep: number;
  lastActiveStep?: number;
}

export interface FunctionCallArrowData {
  id: string;
  fromFunctionId: string;
  toFunctionId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  label?: string;
  isRecursive: boolean;
  stepId: number;
}

export interface LayoutResult {
  globals: VariableData[];
  arrays: ArrayData[];
  stack: StackFrameData[];
  heap: HeapBlockData[];
  pointers: PointerArrowData[];
  loopIndicators: LoopIndicatorData[];
  functions?: FunctionData[];
  functionArrows?: FunctionCallArrowData[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}