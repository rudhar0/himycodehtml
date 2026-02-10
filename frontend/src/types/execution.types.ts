export type StepType =
  | 'object_creation'
  | 'object_destruction'
  | 'variable_declaration'
  | 'assignment'
  | 'pointer_declaration'
  | 'pointer_deref'
  | 'array_declaration'
  | 'function_call'
  | 'function_return'
  | 'line_execution'
  | 'loop_start'
  | 'loop_end'
  | 'conditional_start'
  | 'conditional_branch'
  | 'heap_allocation'
  | 'heap_free'
  | 'output'
  | 'input_request'
  | 'program_end'
  | 'loop_body_summary';

export interface ClassInfo {
  members: Array<{ name: string; type: string; isField: boolean }>;
  methods: Array<{ name: string; type: string }>;
  hasConstructor: boolean;
  hasDestructor: boolean;
}

export interface MemberVariable {
  name: string;
  type: string;
  value: any;
  address: string;
}

export interface Variable {
  name: string;
  type: string;
  primitive?: 'class' | 'int' | 'pointer' | 'array' | string;
  className?: string;
  value: any | MemberVariable[];
  address: string;
  birthStep: number;
}

export interface StackFrame {
  function: string;
  line: number;
  locals: { [key: string]: Variable };
}

export interface MemoryState {
  callStack: StackFrame[];
  globals: { [key: string]: Variable };
  heap: { [key: string]: any }; // Assuming heap structure might be complex
  // The old 'stack' seems to be replaced by 'callStack', and 'pointers' are now part of variables.
}

export interface ExecutionStep {
  id: number;
  type: StepType;
  line: number;
  explanation: string;
  state: MemoryState;

  // Optional fields based on step type
  className?: string;
  objectName?: string;
  variable?: string;
  name?: string;
  dataType?: string;
  primitive?: 'class' | 'int' | 'pointer' | 'array' | string;
  value?: any | MemberVariable[];
  address?: string;
  scope?: 'local' | 'global';
  classInfo?: ClassInfo;
  function?: string;
  
  // Note: birthStep is on the Variable, not the step itself

  // Fields used by LayoutEngine
  eventType?: string;
  frameId?: string;
  callDepth?: number;
  parentFrameId?: string;
  isFunctionEntry?: boolean;
  isFunctionExit?: boolean;
  scopeDepth?: number;
  varType?: string;
  symbol?: string;
  returnValue?: any;
}

export interface GlobalVariable {
  name: string;
  type: string;
  value: any;
  address: string;
}

export interface FunctionInfo {
  name: string;
  signature: string;
  line: number;
  returnType: string;
}

export interface TraceMetadata {
  debugger: string;
  hasSemanticInfo: boolean;
}

export interface ExecutionTrace {
  steps: ExecutionStep[];
  totalSteps: number;
  globals: GlobalVariable[];
  functions: FunctionInfo[];
  metadata: TraceMetadata;
}

export interface InputRequest {
  variable: string;
  type: 'int' | 'float' | 'char' | 'string';
}