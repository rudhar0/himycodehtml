// src/engine/traceProcessor.ts
// ============================================================================
// TraceProcessor — Pure trace normalization & memory state accumulation
//
// Extracted from useSocket.ts. Converts raw backend events into internal
// ExecutionStep[] with fully-built MemoryState per step.
//
// Rules:
//   ✔ Pure logic — no React, no DOM, no side effects
//   ✔ Never silently defaults to line_execution — tags unknown types
//   ✔ Uses structuredClone instead of JSON.parse(JSON.stringify())
//   ✔ Preserves ALL semantic event types
// ============================================================================

import type {
  ExecutionStep,
  ExecutionTrace,
  Variable,
  MemoryState,
  StepType,
} from '../types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Maximum trace steps processed in demo mode. Set 0 to disable. */
export const MAX_TRACE_STEPS = 500;

const __DEV__ =
  typeof process !== 'undefined'
    ? process.env.NODE_ENV !== 'production'
    : false;

// ---------------------------------------------------------------------------
// Step-type mapping
// ---------------------------------------------------------------------------

const STEP_TYPE_MAP: Record<string, string> = {
  // Array events
  array_create: 'array_declaration',
  array_init: 'array_initialization',
  array_index_assign: 'array_assignment',

  // Instrumentation backend
  func_enter: 'func_enter',
  func_exit: 'func_exit',
  var: 'var',
  heap_alloc: 'heap_allocation',
  heap_free: 'heap_free',
  program_end: 'program_end',
  program_start: 'program_start',
  stdout: 'output',
  print: 'output',
  declare: 'declare',
  assign: 'assign',

  // LLDB
  step_in: 'function_call',
  step_out: 'function_return',
  step_over: 'line_execution',

  // Semantic
  line_execution: 'line_execution',
  variable_declaration: 'variable_declaration',
  pointer_declaration: 'variable_declaration',
  array_declaration: 'array_declaration',
  assignment: 'assignment',
  object_creation: 'object_creation',
  object_destruction: 'object_destruction',
  function_call: 'function_call',
  function_return: 'function_return',
  loop_start: 'loop_start',
  loop_iteration: 'loop_iteration',
  loop_end: 'loop_end',
  conditional_start: 'conditional_start',
  conditional_branch: 'conditional_branch',
  array_access: 'array_access',
  pointer_deref: 'pointer_deref',
  heap_allocation: 'heap_allocation',
  output: 'output',
  input_request: 'input_request',

  // Backend primitive types → var
  int: 'var',
  double: 'var',
  float: 'var',
  char: 'var',
  bool: 'var',
  long: 'var',
  short: 'var',
  string: 'var',
  variable: 'var',
  variable_assignment: 'assignment',
  variable_change: 'assignment',

  // GDB
  next: 'line_execution',
  step: 'function_call',
  finish: 'function_return',

  // Extended semantic types the plan requires
  arg_bind: 'arg_bind',
  expression_eval: 'expression_eval',
  branch_taken: 'branch_taken',
  pointer_alias: 'pointer_alias',
};

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes a raw backend type string into an internal StepType.
 * NEVER silently falls back to `line_execution` — preserves originals.
 */
export function normalizeStepType(type: string | undefined): string {
  if (!type) return 'line_execution';
  const key = type.toLowerCase().trim();
  const mapped = STEP_TYPE_MAP[key];
  if (mapped) return mapped;

  if (__DEV__) {
    console.warn(`[TraceProcessor] Unknown step type: "${type}" — preserving as-is.`);
  }
  // Preserve original rather than silently mapping
  return key;
}

function normalizeCallStack(
  callStack: any,
): Array<{ function: string; line: number; locals: Record<string, Variable> }> {
  if (Array.isArray(callStack) && callStack.length > 0) return callStack;
  return [{ function: '(global scope)', line: 0, locals: {} }];
}

function normalizeLocals(locals: any): Record<string, Variable> {
  if (!locals) return {};
  if (!Array.isArray(locals)) return locals as Record<string, Variable>;

  const result: Record<string, Variable> = {};
  (locals as any[]).forEach((v) => {
    if (v?.name) result[v.name] = v;
  });
  return result;
}

// ---------------------------------------------------------------------------
// Array state tracker (used during processing)
// ---------------------------------------------------------------------------

interface ArrayState {
  name: string;
  baseType: string;
  dimensions: number[];
  values: any[];
  address: string;
  birthStep: number;
  owner: string;
}

function calculateFlatIndex(indices: number[], dimensions: number[]): number {
  if (indices.length === 1) return indices[0];
  if (indices.length === 2) return indices[0] * dimensions[1] + indices[1];
  if (indices.length === 3) {
    return (
      indices[0] * dimensions[1] * dimensions[2] +
      indices[1] * dimensions[2] +
      indices[2]
    );
  }
  return indices[0];
}

// ---------------------------------------------------------------------------
// Main processor
// ---------------------------------------------------------------------------

export interface ProcessedTrace {
  trace: ExecutionTrace;
  arrayRegistry: Map<string, ArrayState>;
}

/**
 * Processes raw backend chunks into a fully normalised ExecutionTrace.
 *
 * @param rawChunks  Array of chunk payloads from socket events
 * @param maxSteps   Maximum steps to process (0 = unlimited)
 */
export function processRawTrace(
  rawChunks: any[],
  maxSteps: number = 0,
): ProcessedTrace {
  // 1. Flatten chunks → expanded steps
  const allRawSteps: any[] = rawChunks.flatMap((c) => c.steps || []);
  const expandedSteps: any[] = [];

  for (const step of allRawSteps) {
    const { internalEvents, ...mainStep } = step;
    expandedSteps.push(mainStep);
    if (internalEvents) {
      for (const internal of internalEvents) {
        const expanded = { ...mainStep, ...internal };
        if (expanded.type && !expanded.eventType) {
          expanded.eventType = expanded.type;
        }
        expandedSteps.push(expanded);
      }
    }
  }

  if (expandedSteps.length === 0) {
    throw new Error('No steps found in received trace data.');
  }

  // Enforce step cap
  const limit =
    maxSteps > 0
      ? Math.min(expandedSteps.length, maxSteps)
      : expandedSteps.length;

  // 2. Process each step — accumulate memory state
  let currentMemoryState: MemoryState = {
    globals: {},
    stack: [],
    heap: {},
    callStack: [],
    stdout: '',
  };

  const arrayRegistry = new Map<string, ArrayState>();
  const variableBirthStepMap = new Map<string, number>();
  const processedSteps: ExecutionStep[] = [];

  for (let index = 0; index < limit; index++) {
    const raw = expandedSteps[index];

    // Clone — structuredClone replaces JSON round-trip
    const step: any = structuredClone(raw);

    // Field normalisation: addr → address, eventType → type
    if (step.addr && !step.address) step.address = step.addr;
    if (step.eventType && !step.type) step.type = step.eventType;
    if (step.eventType) step.originalEventType = step.eventType;
    if (step.stdout && step.type === 'output') step.value = step.stdout;

    const originalType = step.type;
    step.type = normalizeStepType(step.type) as StepType;

    const nextMemoryState: MemoryState = structuredClone(currentMemoryState);
    const functionName = (step.function || '').trim().replace(/\r/g, '');

    // --- Step type switch ---
    switch (step.type) {
      case 'func_enter':
        nextMemoryState.callStack.push({
          function: functionName,
          line: step.line,
          locals: {},
        });
        break;

      case 'func_exit':
        if (nextMemoryState.callStack.length > 0) {
          nextMemoryState.callStack.pop();
        }
        break;

      // --- Arrays ---
      case 'array_declaration': {
        const name = step.name;
        const baseType = step.baseType || 'int';
        const dims = step.dimensions || [1];
        const addr = step.address || step.addr;
        const totalSize = dims.reduce((a: number, b: number) => a * b, 1);
        arrayRegistry.set(name, {
          name,
          baseType,
          dimensions: dims,
          values: new Array(totalSize).fill(0),
          address: addr,
          birthStep: index,
          owner: functionName || 'main',
        });
        step.arrayData = arrayRegistry.get(name);
        break;
      }

      case 'array_initialization': {
        const arr = arrayRegistry.get(step.name);
        if (arr) {
          arr.values = [...(step.values || [])];
          step.arrayData = arr;
        }
        break;
      }

      case 'array_assignment': {
        const arr = arrayRegistry.get(step.name);
        if (arr) {
          const flat = calculateFlatIndex(
            step.indices || [],
            arr.dimensions,
          );
          if (flat >= 0 && flat < arr.values.length) {
            arr.values[flat] = step.value;
            step.arrayData = { ...arr };
            step.updatedIndices = [step.indices];
          }
        }
        break;
      }

      // --- Variables ---
      case 'var': {
        const frame =
          nextMemoryState.callStack[nextMemoryState.callStack.length - 1];
        const declaredType = step.varType || step.eventType || originalType;
        const varName = step.name;
        if (!varName) break;

        if (frame) {
          const existing = frame.locals[varName];
          if (!existing) {
            frame.locals[varName] = {
              name: varName,
              value: step.value,
              type: declaredType,
              primitive: declaredType,
              address: step.addr || step.address,
              scope: 'local',
              isInitialized: true,
              isAlive: true,
              birthStep: index,
            } as Variable;
            variableBirthStepMap.set(varName, index);
          } else {
            existing.value = step.value;
          }
        } else {
          // Global
          const existing = nextMemoryState.globals[varName];
          if (!existing) {
            nextMemoryState.globals[varName] = {
              name: varName,
              value: step.value,
              type: declaredType,
              primitive: declaredType,
              address: step.addr || step.address,
              scope: 'global',
              isInitialized: true,
              isAlive: true,
              birthStep: index,
            } as Variable;
            variableBirthStepMap.set(varName, index);
          } else {
            existing.value = step.value;
          }
        }
        break;
      }

      case 'output':
        nextMemoryState.stdout =
          (nextMemoryState.stdout || '') + (step.value ?? '');
        break;

      // declare / assign — handled by LayoutEngine, just pass through
      default:
        break;
    }

    // Attach array snapshot
    step.arrays = Array.from(arrayRegistry.values());

    // Build final step
    step.state = nextMemoryState;
    step.id = index;
    if (!step.explanation) {
      step.explanation = `Executing ${step.type} at line ${step.line}`;
    }

    processedSteps.push(step as ExecutionStep);
    currentMemoryState = nextMemoryState;
  }

  const validSteps = processedSteps.filter((s) => s.id !== undefined);
  if (validSteps.length === 0) {
    throw new Error('No valid steps after processing.');
  }

  const trace: ExecutionTrace = {
    steps: validSteps,
    totalSteps: validSteps.length,
    globals: rawChunks[0]?.globals || [],
    functions: rawChunks[0]?.functions || [],
    metadata: {
      ...(rawChunks[0]?.metadata || {}),
      debugger: 'instrumentation',
      hasSemanticInfo: true,
    },
  };

  return { trace, arrayRegistry };
}
