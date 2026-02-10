// ============================================
// EXECUTION TYPES
// ============================================

export type StepType =
  | 'program_start'
  | 'global_declaration'
  | 'func_enter' // New
  | 'func_exit' // New
  | 'var' // New
  | 'heap_alloc' // New
  | 'function_call'
  | 'function_return'
  | 'variable_declaration'
  | 'assignment'
  | 'array_declaration'
  | 'pointer_declaration'
  | 'pointer_deref'
  | 'object_creation'
  | 'object_destruction'
  | 'heap_allocation'
  | 'heap_free'
  | 'loop_start'
  | 'loop_iteration'
  | 'loop_compressed'
  | 'loop_end'
  | 'conditional_start'
  | 'conditional_branch'
  | 'line_execution'
  | 'input_request'
  | 'output'
  | 'program_end';

export interface ExecutionStep {
  id: number;
  type: StepType;
  line: number;
  explanation: string;
  state: MemoryState;

  // New optional fields for hybrid backend
  className?: string;
  objectName?: string;
  variable?: string;
  name?: string;
  dataType?: string;
  primitive?: 'class' | 'int' | 'pointer' | 'array' | string;
  value?: any;
  address?: string;
  scope?: 'local' | 'global';
  classInfo?: ClassInfo;
  function?: string;

  // Old fields
  animation?: AnimationConfig;
  pauseExecution?: boolean;
  inputRequest?: InputRequest;
}

export interface ExecutionTrace {
  steps: ExecutionStep[];
  totalSteps: number;
  globals: GlobalVariable[];
  functions: FunctionInfo[];
  metadata?: {
    debugger: string;
    hasSemanticInfo: boolean;
  };
}

// ============================================
// CLASS & OBJECT TYPES
// ============================================

export interface ClassInfo {
  members: Array<{ name: string; type: string; isField: boolean }>;
  methods: Array<{ name: string; type: string }>;
  hasConstructor: boolean;
  hasDestructor: boolean;
}

export interface ClassMember {
  name: string;
  type: string;
  value: any;
  address?: string;
}

// ============================================
// MEMORY TYPES
// ============================================

export interface MemoryState {
  globals: Record<string, Variable>;
  stack: StackFrame[]; // This might be deprecated in favor of callStack
  heap: Record<string, HeapBlock>;
  callStack: CallFrame[];
  stdout?: string;
}

export interface Variable {
  name: string;
  type: string;
  value: any; // For classes, this could be an array of ClassMember
  address: string;
  scope: 'global' | 'local' | 'parameter';
  primitive: 'int' | 'float' | 'char' | 'double' | 'bool' | 'pointer' | 'array' | 'struct' | 'class' | string;
  isInitialized: boolean;
  isAlive: boolean;
  birthStep?: number;
  deathStep?: number;
  declarationType?: 'with_value' | 'without_value' | 'multiple';
  isAccessed?: boolean; // For highlighting when read/written
  accessType?: 'read' | 'write';
  className?: string; // For class objects
}

export interface GlobalVariable extends Variable {
  scope: 'global';
}

export interface StackFrame {
  frameId: string;
  function: string;
  returnType: string;
  locals: Record<string, Variable>;
  returnAddress?: string;
}

export interface CallFrame {
  function: string;
  line?: number;
  returnType?: string;
  params?: Record<string, Variable>;
  locals: Record<string, Variable>;
  frameId?: string;
  returnAddress?: string | null;
  isActive?: boolean;
}

export interface HeapBlock {
  address: string;
  size: number;
  type: string;
  allocated: boolean;
  values: any[];
}

export interface ArrayVariable extends Variable {
  size: number;
  baseAddress: string;
  values: ArrayCell[];
}

export interface ArrayCell {
  index: number;
  value: any;
  address: string;
}

export interface PointerVariable extends Variable {
  pointsTo: string | null;
  pointerLevel: number; // 1 for *, 2 for **, etc.
}

// ============================================
// ANIMATION TYPES
// ============================================

export type AnimationType =
  | 'appear'
  | 'disappear'
  | 'value_change'
  | 'push_frame'
  | 'pop_frame'
  | 'heap_allocate'
  | 'heap_free'
  | 'array_create'
  | 'array_access'
  | 'array_update'
  | 'pointer_create'
  | 'pointer_update'
  | 'pointer_deref'
  | 'loop_indicator'
  | 'loop_cycle'
  | 'input_dialog'
  | 'output_display' // New
  | 'program_complete';

export interface AnimationConfig {
  type: AnimationType;
  target: 'global' | 'stack' | 'heap' | 'overlay';
  duration: number;
  effect?: string;
  element?: string;
  frameId?: string;
  from?: any;
  to?: any;
  [key: string]: any;
}

// ============================================
// INPUT/OUTPUT TYPES
// ============================================

export interface InputRequest {
  format: string;
  variables: string[];
  expectedTypes: string[];
  prompt?: string;
}

// ============================================
// FUNCTION TYPES
// ============================================

export interface FunctionInfo {
  name: string;
  signature?: string;
  returnType: string;
  parameters?: Parameter[];
  line: number;
  isMain?: boolean;
}

export interface Parameter {
  name:string;
  type: string;
}

// ============================================
// SYMBOL TYPES
// ============================================

export interface Symbol {
  name: string;
  type: 'function' | 'variable' | 'array' | 'pointer' | 'struct' | 'class';
  dataType: string;
  line: number;
  scope: string;
}

// ============================================
// CANVAS TYPES
// ============================================

export interface CanvasPosition {
  x: number;
  y: number;
}

export interface CanvasViewport {
  zoom: number;
  position: CanvasPosition;
}

// ============================================
// LANGUAGE TYPES
// ============================================

export type Language = 'c' | 'cpp';

// ============================================
// UI TYPES
// ============================================

export interface UIState {
  isSidebarOpen: boolean;
  activeTab: string;
  isModalOpen: boolean;
  modalType: string | null;
}

// ============================================
// GCC STATUS TYPES
// ============================================

export interface GCCStatus {
  available: boolean;
  downloading: boolean;
  progress: number;
  stage: 'idle' | 'downloading' | 'extracting' | 'ready' | 'failed';
  gccPath: string | null;
}
