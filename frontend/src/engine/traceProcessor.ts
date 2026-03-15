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
} from "../types";
import {
  annotateStepsWithPlacementKeys,
  buildConditionTree,
} from "../ExecutionStructureBuilder";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Maximum trace steps processed in demo mode. Set 0 to disable. */
export const MAX_TRACE_STEPS = 500;

const __DEV__ =
  typeof process !== "undefined"
    ? process.env.NODE_ENV !== "production"
    : false;

// ---------------------------------------------------------------------------
// Step-type mapping
// ---------------------------------------------------------------------------

const STEP_TYPE_MAP: Record<string, string> = {
  // Array events
  array_create: "array_declaration",
  array_init: "array_initialization",
  array_index_assign: "array_assignment",

  // Instrumentation backend
  func_enter: "func_enter",
  func_exit: "func_exit",
  var: "var",
  heap_alloc: "heap_allocation",
  heap_free: "heap_free",
  program_end: "program_end",
  program_start: "program_start",
  stdout: "output",
  print: "output",
  declare: "declare",
  assign: "assign",

  // LLDB
  step_in: "function_call",
  step_out: "function_return",
  step_over: "line_execution",

  // Semantic
  line_execution: "line_execution",
  variable_declaration: "variable_declaration",
  pointer_declaration: "variable_declaration",
  array_declaration: "array_declaration",
  assignment: "assignment",
  object_creation: "object_creation",
  object_destruction: "object_destruction",
  function_call: "function_call",
  function_return: "function_return",
  loop_start: "loop_start",
  loop_iteration: "loop_iteration",
  loop_body_start: "loop_body_start",
  loop_iteration_end: "loop_iteration_end",
  loop_end: "loop_end",
  conditional_start: "conditional_start",
  conditional_branch: "conditional_branch",
  array_access: "array_access",
  pointer_deref: "pointer_deref",
  heap_allocation: "heap_allocation",
  output: "output",
  input: "input_request",
  input_request: "input_request",
  input_call: "input_call",
  input_assign: "input_assign",

  // Backend primitive types → var
  int: "var",
  double: "var",
  float: "var",
  char: "var",
  bool: "var",
  long: "var",
  short: "var",
  string: "var",
  variable: "var",
  variable_assignment: "assignment",
  variable_change: "assignment",

  // GDB
  next: "line_execution",
  step: "function_call",
  finish: "function_return",

  // Extended semantic types the plan requires
  arg_bind: "arg_bind",
  expression_eval: "expression_eval",
  condition_eval: "condition",
  branch_taken: "branch",
  pointer_alias: "pointer_alias",
  pointer_deref_write: "pointer_write",
  loop_condition: "loop_condition",
};

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes a raw backend type string into an internal StepType.
 * NEVER silently falls back to `line_execution` — preserves originals.
 */
export function normalizeStepType(type: string | undefined): string {
  if (!type) return "line_execution";
  const key = type.toLowerCase().trim();
  const mapped = STEP_TYPE_MAP[key];
  if (mapped) return mapped;

  if (__DEV__) {
    console.warn(
      `[TraceProcessor] Unknown step type: "${type}" — preserving as-is.`,
    );
  }
  // Preserve original rather than silently mapping
  return key;
}

function normalizeCallStack(
  callStack: any,
): Array<{ function: string; line: number; locals: Record<string, Variable> }> {
  if (Array.isArray(callStack) && callStack.length > 0) return callStack;
  return [{ function: "(global scope)", line: 0, locals: {} }];
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

function isRuntimeCleanupStep(raw: any): boolean {
  const eventType = String(raw?.eventType || raw?.type || "")
    .toLowerCase()
    .trim();
  const fn = String(raw?.function || raw?.func || "")
    .toLowerCase()
    .trim();
  const file = String(raw?.file || "")
    .toLowerCase()
    .trim();

  if (eventType === "heap_free") return true;
  if (fn.includes("operator delete")) return true;
  if ((file === "??" || file === "unknown") && fn.startsWith("std::"))
    return true;
  if (file.includes("libc++") || file.includes("libstdc++")) return true;

  return false;
}

const NON_VISUAL_EVENTS = new Set([
  "program_start",
  "program_end",
  "func_exit",
  "scope_exit",
  "heap_free",
  "cleanup",
  "block_enter",
  "block_exit",
]);

const ALWAYS_VISUAL_EVENTS = new Set([
  "func_enter",
  "return",
  "output",
  "input_request",
  "input",
  "input_call",
  "input_assign",
  "var",
  "var_declare",
  "var_assign",
  "declare",
  "assign",
  "assignment",
  "array_declaration",
  "array_initialization",
  "array_assignment",
  "loop_start",
  "loop_body_start",
  "loop_iteration",
  "loop_iteration_end",
  "loop_end",
  "loop_condition",
  "loop_break",
  "loop_continue",
  "condition",
  "branch",
  "conditional_start",
  "conditional_branch",
  "condition_eval",
  "branch_taken",
  "pointer_alias",
  "pointer_write",
  "pointer_deref",
  "pointer_deref_write",
  "heap_alloc",
  "heap_write",
  "function_call",
  "function_return",
]);

function hasVisualChange(
  prevState: MemoryState,
  nextState: MemoryState,
  step: any,
): boolean {
  const eventType = String(step?.type || step?.eventType || "")
    .toLowerCase()
    .trim();

  if (NON_VISUAL_EVENTS.has(eventType)) return false;
  if (ALWAYS_VISUAL_EVENTS.has(eventType) || eventType === "scope_exit") return true;

  return JSON.stringify(prevState) !== JSON.stringify(nextState);
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
// Input step merger
// ---------------------------------------------------------------------------

/**
 * Merges consecutive input_call + input_assign steps emitted by the backend
 * into a single unified 'input' step for visualization.
 * This must run ONLY in the frontend — do NOT move to backend.
 */
function mergeInputSteps(steps: any[]): any[] {
  const merged: any[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const nextStep = steps[i + 1];

    if (step.type === "input_call" && nextStep?.type === "input_assign") {
      merged.push({
        ...step,
        type: "input",
        assignments: nextStep.assignments,
        returnValue: nextStep.returnValue,
        returnValueVar: nextStep.returnValueVar,
        returnNote: nextStep.returnValueVar
          ? `returned ${nextStep.returnValue} → stored in ${nextStep.returnValueVar}`
          : undefined,
        // carry over id from the call step; re-assign after merge
        id: step.id,
      });
      i++; // skip input_assign
      continue;
    }

    merged.push(step);
  }
  return merged;
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
    throw new Error("No steps found in received trace data.");
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
    stdout: "",
  };

  const arrayRegistry = new Map<string, ArrayState>();
  const variableBirthStepMap = new Map<string, number>();
  const processedSteps: ExecutionStep[] = [];
  const inferredScopeDepthByFrame = new Map<string, number>();
  
  // Local control-context stacks (do NOT store on MemoryState/callStack frames).
  // Each entry corresponds 1:1 with currentMemoryState.callStack depth.
  type ConditionCtx = { conditionId: string; bodyDepth: number };
  const conditionStacks: ConditionCtx[][] = [];

  // 🔄 LOOP STABILIZATION: Track depth/stack at loop start to reset per-iteration.
  type LoopCtx = { scopeDepth: number; conditionStackLen: number };
  const loopStacksByFrame = new Map<string, LoopCtx[]>();

  for (let index = 0; index < limit; index++) {
    const raw = expandedSteps[index];
    const rawEventType = String(raw?.eventType || raw?.type || "")
      .toLowerCase()
      .trim();
    const frameId = String(raw.frameId || "main-0");
    const activeStackIdx = currentMemoryState.callStack.length;

    // --- 🔄 LOOP RESET LOGIC (Top of loop to prevent bypass) ---
    // Trigger reset on ANY loop iteration marker (start, condition, or body_start)
    const isIterationStartRaw = 
      rawEventType === "loop_body_start" || 
      rawEventType === "loop_iteration" || 
      rawEventType === "loop_iteration_start" || 
      rawEventType === "loop_condition"; // Reseting at condition is safer as it always happens
    
    if (rawEventType === "loop_start") {
      let frameLoops = loopStacksByFrame.get(frameId);
      if (!frameLoops) {
        frameLoops = [];
        loopStacksByFrame.set(frameId, frameLoops);
      }
      const activeStack = conditionStacks[activeStackIdx] || [];
      frameLoops.push({
        scopeDepth: inferredScopeDepthByFrame.get(frameId) ?? 0,
        conditionStackLen: activeStack.length
      });
      console.log(`[TRACE] loop_start frame: ${frameId} -> base depth: ${inferredScopeDepthByFrame.get(frameId)}, stack len: ${activeStack.length}`);
    } else if (isIterationStartRaw) {
      const frameLoops = loopStacksByFrame.get(frameId);
      const loopCtx = frameLoops && frameLoops.length > 0 ? frameLoops[frameLoops.length - 1] : null;
      
      if (loopCtx) {
        // RESET DEPTH and POP CONDITIONS to loop-start state
        if (inferredScopeDepthByFrame.get(frameId) !== loopCtx.scopeDepth) {
            inferredScopeDepthByFrame.set(frameId, loopCtx.scopeDepth);
        }
        
        while (conditionStacks.length <= activeStackIdx) conditionStacks.push([]);
        const activeStack = conditionStacks[activeStackIdx];
        if (activeStack) {
          while (activeStack.length > loopCtx.conditionStackLen) {
            const popped = activeStack.pop();
            console.log(`[TRACE] loop iteration reset -> Popped leaky condition: ${popped?.conditionId} (Trigger: ${rawEventType})`);
          }
        }
      }
    } else if (rawEventType === "loop_end") {
      const frameLoops = loopStacksByFrame.get(frameId);
      if (frameLoops) {
        const popped = frameLoops.pop();
        console.log(`[TRACE] loop_end frame: ${frameId} -> popped loop context (base depth was ${popped?.scopeDepth})`);
      }
    }

    if (rawEventType === "block_enter") {
      const current = inferredScopeDepthByFrame.get(frameId) ?? 0;
      inferredScopeDepthByFrame.set(frameId, current + 1);
      console.log(`[TRACE] block_enter frame: ${frameId} -> depth: ${current + 1}`);
      continue;
    }
    if (rawEventType === "block_exit") {
      const current = inferredScopeDepthByFrame.get(frameId) ?? 0;
      const next = Math.max(0, current - 1);
      inferredScopeDepthByFrame.set(frameId, next);
      
      console.log(
        `[TRACE] block_exit frame: ${frameId} -> depth: ${next} (from ${current})`
      );
      // create a structural step so condition stacks can close properly
      const step: any = structuredClone(raw);
      step.scopeDepth = next;
      step.type = "scope_exit";

      expandedSteps[index] = step;
    }

    if (isRuntimeCleanupStep(raw)) continue;
    const logicalIndex = processedSteps.length;

    // Clone — structuredClone replaces JSON round-trip
    const step: any = structuredClone(expandedSteps[index]);

    // Field normalisation: addr → address, eventType → type
    if (step.addr && !step.address) step.address = step.addr;
    if (step.eventType && !step.type) step.type = step.eventType;
    
    // CRITICAL: Preserve original eventType for LayoutEngine semantic matching (in lowercase)
    if (step.eventType) {
      step.originalEventType = String(step.eventType).toLowerCase();
      step.eventType = step.originalEventType;
    } else if (step.type) {
      const typeLower = String(step.type).toLowerCase();
      step.eventType = typeLower; // Backfill eventType if missing
      step.originalEventType = typeLower;
    }
    
    if (step.stdout && step.type === "output") step.value = step.stdout;
    
    // 🔧 LOOP-SPECIALIZED DEPTH NORMALIZATION
    // If inside a loop, we calculate normalizedDepth = currentDepth - (loopBaseDepth + 1)
    // This ensures that pruneLogic and parent resolution see depths starting from 1 inside iterations.
    const frameLoops = loopStacksByFrame.get(frameId);
    let rawDepth = inferredScopeDepthByFrame.get(frameId) ?? 0;
    
    if (frameLoops && frameLoops.length > 0) {
      const topLoop = frameLoops[frameLoops.length - 1];
      // Formula: normalizedDepth = rawDepth - loopBaseDepth
      // This ensures that steps inside the loop start at depth 1 relative to the loop's entry depth.
      const normalizedDepth = Math.max(0, rawDepth - topLoop.scopeDepth);
      step.scopeDepth = normalizedDepth;
      step.rawScopeDepth = rawDepth; // Keep original for reference
      step.loopBaseDepth = topLoop.scopeDepth;
    } else {
      step.scopeDepth = rawDepth;
      step.rawScopeDepth = rawDepth;
    }

    const originalType = step.type;
    step.type = normalizeStepType(step.type) as StepType;

    // Condition scope handling:
    // - push on taken branches (branch_taken → normalized 'branch')
    // - pop when scopeDepth drops below the branch body depth
    // - fill missing step.conditionId from current active condition (top of stack)
    const scopeDepth = Number(step.scopeDepth ?? (inferredScopeDepthByFrame.get(frameId) ?? 0));
    const activeCondStack =
      conditionStacks.length > 0
        ? conditionStacks[conditionStacks.length - 1]
        : null;

    if (activeCondStack && activeCondStack.length > 0) {
      const closed: string[] = [];
      while (
        activeCondStack.length > 0 &&
        scopeDepth < activeCondStack[activeCondStack.length - 1].bodyDepth
      ) {
        const popped = activeCondStack.pop();
        if (popped?.conditionId) {
          closed.push(String(popped.conditionId));
        }
      }
      if (closed.length > 0) {
        // Log the final resulting depth of the stack or N/A
        const remainingDepth = activeCondStack.length > 0 ? activeCondStack[activeCondStack.length - 1].bodyDepth : 'N/A';
        console.log(`[TRACE] scopeDepth: ${scopeDepth} < bodyDepth: ${remainingDepth} -> Closing conditions:`, closed);
        step.closedConditionIds = closed;
      }
    }

    if (
      (step.conditionId === undefined || step.conditionId === null) &&
      activeCondStack &&
      activeCondStack.length > 0
    ) {
      const activeCondition =
        activeCondStack[activeCondStack.length - 1].conditionId;

      const condFrame = activeCondition.split("-").slice(1, 3).join("-");
      const stepFrame = String(step.frameId);

      const activeBodyDepth = activeCondStack[activeCondStack.length - 1].bodyDepth;
      if (condFrame === stepFrame && scopeDepth > activeBodyDepth) {
        step.conditionId = activeCondition;
      }
    }

    const nextMemoryState: MemoryState = structuredClone(currentMemoryState);
    const functionName = (step.function || "").trim().replace(/\r/g, "");

    // --- Step type switch ---
    switch (step.type) {
      case "func_enter": {
        const parentFrame =
          currentMemoryState.callStack.length > 0
            ? (currentMemoryState.callStack[
                currentMemoryState.callStack.length - 1
              ] as any)
            : null;

        const newFrame: any = {
          function: functionName,
          line: step.line,
          locals: {},
        };

        nextMemoryState.callStack.push(newFrame);
        inferredScopeDepthByFrame.set(step.frameId || "unknown", 0);

        // Seed callee condition stack with caller's currently-active condition (if any),
        // using bodyDepth=-1 so it never auto-closes inside the callee.
        const callerStack =
          conditionStacks.length > 0
            ? conditionStacks[conditionStacks.length - 1]
            : null;
        const activeCaller =
          callerStack && callerStack.length > 0
            ? callerStack[callerStack.length - 1]
            : null;
        const calleeStack: ConditionCtx[] = [];
        if (activeCaller?.conditionId) {
          if (activeCaller?.conditionId) {
            calleeStack.push({
              conditionId: String(activeCaller.conditionId),
              bodyDepth: -1,
            });
          }
        }
        conditionStacks.push(calleeStack);
        break;
      }

      case "func_exit":
        if (nextMemoryState.callStack.length > 0) {
          nextMemoryState.callStack.pop();
        }

        // clear condition stack when returning to caller
        if (conditionStacks.length > 0) {
          const stack = conditionStacks[conditionStacks.length - 1];
          if (stack) stack.length = 0;
        }

        if (conditionStacks.length > 0) {
          conditionStacks.pop();
        }
        break;

      // --- Arrays ---
      case "array_declaration": {
        const name = step.name;
        const baseType = step.baseType || "int";
        const dims = step.dimensions || [1];
        const addr = step.address || step.addr;
        const totalSize = dims.reduce((a: number, b: number) => a * b, 1);
        arrayRegistry.set(name, {
          name,
          baseType,
          dimensions: dims,
          values: new Array(totalSize).fill(0),
          address: addr,
          birthStep: logicalIndex,
          owner: functionName || "main",
        });
        step.arrayData = arrayRegistry.get(name);
        break;
      }

      case "array_initialization": {
        const arr = arrayRegistry.get(step.name);
        if (arr) {
          arr.values = [...(step.values || [])];
          step.arrayData = arr;
        }
        break;
      }

      case "array_assignment": {
        const arr = arrayRegistry.get(step.name);
        if (arr) {
          const flat = calculateFlatIndex(step.indices || [], arr.dimensions);
          if (flat >= 0 && flat < arr.values.length) {
            arr.values[flat] = step.value;
            step.arrayData = { ...arr };
            step.updatedIndices = [step.indices];
          }
        }
        break;
      }

      // --- Variables ---
      case "var": {
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
              scope: "local",
              isInitialized: true,
              isAlive: true,
              birthStep: logicalIndex,
            } as Variable;
            variableBirthStepMap.set(varName, logicalIndex);
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
              scope: "global",
              isInitialized: true,
              isAlive: true,
              birthStep: logicalIndex,
            } as Variable;
            variableBirthStepMap.set(varName, logicalIndex);
          } else {
            existing.value = step.value;
          }
        }
        break;
      }

      case "output":
        nextMemoryState.stdout =
          (nextMemoryState.stdout || "") + (step.value ?? "");
        break;

      case "condition": {
        step.condition = step.condition || step.expression || "";
        const rawResult = step.result ?? step.value ?? null;
        step.result = rawResult;
        if (rawResult !== null && rawResult !== undefined) {
          step.conditionResult = Boolean(rawResult);
        }
        break;
      }

      case "branch": {
        step.branch = step.branch || step.branchType || "if";
        // Push condition context for the taken branch body.
        // bodyDepth = scopeDepth + 1 because backend scopeDepth uses "start depth" for control
        // steps (branch_taken), while body statements are at the deeper "max depth".
        const stack =
          conditionStacks.length > 0
            ? conditionStacks[conditionStacks.length - 1]
            : null;
        if (
          stack &&
          step.conditionId !== undefined &&
          step.conditionId !== null
        ) {
          stack.push({
            conditionId: String(step.conditionId),
            bodyDepth: scopeDepth,
          });
          console.log(`[TRACE] branch -> Pushing condition: ${step.conditionId} with bodyDepth: ${scopeDepth}`);
        }

        break;
      }

      case "pointer_write": {
        step.target = step.target || step.name || step.symbol || "";
        break;
      }

      // declare / assign — handled by LayoutEngine, just pass through
      default:
        break;
    }

    // Attach array snapshot
    step.arrays = Array.from(arrayRegistry.values());

    // Build final step
    step.state = nextMemoryState;
    if (!step.explanation) {
      step.explanation = `Executing ${step.type} at line ${step.line}`;
    }

    const stepEventType = String(step.type || step.eventType || "")
      .toLowerCase()
      .trim();
    const isReturnEvent =
      stepEventType === "return" || stepEventType === "function_return";

    if (
      !hasVisualChange(currentMemoryState, nextMemoryState, step) &&
      !isReturnEvent
    ) {
      currentMemoryState = nextMemoryState;
      continue;
    }

    step.id = processedSteps.length;
    step.hasVisualChange = true;

    processedSteps.push(step as ExecutionStep);
    currentMemoryState = nextMemoryState;
  }

  const validSteps = processedSteps.filter((s) => s.id !== undefined);
  if (validSteps.length === 0) {
    throw new Error("No valid steps after processing.");
  }

  // Merge consecutive input_call + input_assign into a single 'input' step
  const mergedSteps = mergeInputSteps(validSteps);
  // Remove any empty/noop steps that should not appear as visual timeline entries
  const finalSteps = mergedSteps.filter(
    (s) => s && s.type !== "noop" && s.type !== "empty",
  );

  // Layer 1 + 2: Annotate steps with stepKey/placementParentKey and build conditionTree
  if (!finalSteps[0]?.stepKey) {
    annotateStepsWithPlacementKeys(finalSteps);
  }
  const conditionTree = buildConditionTree(finalSteps);

  const trace: ExecutionTrace = {
    steps: finalSteps,
    totalSteps: finalSteps.length,
    globals: rawChunks[0]?.globals || [],
    functions: rawChunks[0]?.functions || [],
    metadata: {
      ...(rawChunks[0]?.metadata || {}),
      debugger: "instrumentation",
      hasSemanticInfo: true,
    },
  };

  // Attach conditionTree for LayoutEngine's 3-layer placement system
  (trace as any).conditionTree = conditionTree;

  return { trace, arrayRegistry };
}
