// src/types/execution-graph.types.ts
// ============================================================================
// ExecutionGraph — Explicit ownership tree built by ExecutionStructureBuilder.
//
// Every node has a deterministic parentId resolved from in-memory context stacks
// (not scopeDepth heuristics). LayoutEngine can use nodeIndex and stepToNode for
// O(1) parent resolution instead of scanning activeControlByDepth.
// ============================================================================

// ---------------------------------------------------------------------------
// Node types
// ---------------------------------------------------------------------------

export type ExecutionNodeType =
  | 'stack_frame'
  | 'variable'
  | 'pointer'
  | 'array'
  | 'heap_object'
  | 'condition'
  | 'condition_branch'
  | 'loop'
  | 'loop_iteration'
  | 'output'
  | 'input'
  | 'call_site'
  | 'function_return';

// ---------------------------------------------------------------------------
// Core node
// ---------------------------------------------------------------------------

export interface ExecutionNode {
  /** Globally unique node id. Format depends on type:
   *  stack_frame:  "frame-{frameId}"
   *  variable:     "var-{frameId}-{name}-{stepIndex}"
   *  condition:    "cond-{frameId}-{conditionId}"
   *  loop:         "loop-{frameId}-{loopId}"
   *  output:       "output-{frameId}-{stepIndex}"
   *  etc.
   */
  nodeId: string;

  /** Discriminated type for LayoutEngine rendering. */
  type: ExecutionNodeType;

  /** Which function call owns this node. */
  frameId: string;

  /** conditionId active when this node was created (informational). */
  conditionId?: string;

  /** loopId active when this node was created (informational). */
  loopId?: string;

  /** Explicit parent — the primary structural field.
   *  LayoutEngine: `elementHistory.get(node.parentId)` → no heuristics needed.
   */
  parentId?: string;

  /** Ordered child nodeIds (appended in step order). */
  children: string[];

  /** Control-flow path this node belongs to.
   *  Format: "main", "main.1", "main.1.2", etc.
   *  Function calls inherit the caller's pathId.
   *  New path segments are created only by control-flow branches.
   */
  pathId: string;

  /** Tree depth from root (root stack_frame = 0). */
  depth: number;

  /** [firstStepIndex, lastStepIndex] into the original ExecutionStep[].
   *  Step data is NOT duplicated — LayoutEngine looks up the original step
   *  when it needs detailed fields (varName, value, etc.).
   */
  stepRange: [number, number];

  /** Node-type-specific structured payload.
   *  stack_frame: { functionName, callDepth, parentFrameId }
   *  variable:    { name, value, operation, varType }
   *  condition:   { conditionType, expression }
   *  loop:        { loopType, iterationCount }
   *  output:      { text }
   *  etc.
   */
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

export type ExecutionEdgeType = 'pointer' | 'call' | 'data_flow';

export interface ExecutionEdge {
  edgeId: string;
  type: ExecutionEdgeType;
  /** nodeId of the source (e.g. pointer variable node). */
  sourceNodeId: string;
  /** nodeId of the target (e.g. heap_object node). */
  targetNodeId: string;
  /** Optional label (e.g. field name for struct pointer). */
  label?: string;
  /** Step at which this edge was established. */
  stepIndex: number;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export interface ExecutionPath {
  /** e.g. "main", "main.1", "main.1.2" */
  pathId: string;
  /** The path from which this diverged (undefined for root "main"). */
  parentPathId?: string;
  /** The condition_branch or loop_iteration node that opened this path. */
  originNodeId: string;
  /** Human-readable label: "then", "else", "iteration 3", etc. */
  label: string;
  /** Ordered nodeIds on this path. */
  nodeIds: string[];
}

// ---------------------------------------------------------------------------
// Graph metadata
// ---------------------------------------------------------------------------

export interface ExecutionGraphMetadata {
  totalSteps: number;
  maxDepth: number;
  frameCount: number;
  buildDurationMs: number;
}

// ---------------------------------------------------------------------------
// The graph
// ---------------------------------------------------------------------------

export interface ExecutionGraph {
  /** nodeIds of top-level stack_frames (programs with a single main entry have
   *  exactly one root). */
  roots: string[];

  /** All nodes in step order. */
  nodes: ExecutionNode[];

  /** O(1) lookup by nodeId. */
  nodeIndex: Map<string, ExecutionNode>;

  /** O(1) lookup: stepIndex → nodeId.
   *
   *  For steps that create a node (var_declare, func_enter, output …) this maps
   *  to that node's id.
   *
   *  For steps that do NOT create their own node (block_enter, block_exit,
   *  conditional_branch, loop_iteration …) this maps to the current context
   *  node (active condition / loop / frame), giving LayoutEngine the correct
   *  parent for any element derived from that step.
   *
   *  Usage in LayoutEngine:
   *    const nodeId   = graph.stepToNode.get(stepIndex);
   *    const node     = graph.nodeIndex.get(nodeId);
   *    const parentEl = elementHistory.get(node?.parentId ?? '');
   */
  stepToNode: Map<number, string>;

  /** Pointer / call / data-flow edges. */
  edges: ExecutionEdge[];

  /** Control-flow paths, keyed by pathId. */
  paths: Map<string, ExecutionPath>;

  metadata: ExecutionGraphMetadata;
}

// ---------------------------------------------------------------------------
// Internal builder types (used only inside ExecutionStructureBuilder)
// ---------------------------------------------------------------------------

export interface ConditionContext {
  /** Stable string conditionId (may come from backend or be generated). */
  conditionId: string;
  /** nodeId of the condition node in the graph. */
  conditionNodeId: string;
  /** Which branch was taken ("then" | "else" | case label | "none"). */
  branchTaken: string;
  /** True if a block_enter was observed after conditional_start. */
  isBraced: boolean;
  /** True after the first child element is placed (for braceless body eviction). */
  bodyUsed: boolean;
  /** scopeDepth at the time conditional_start arrived (informational). */
  scopeDepthAtEntry: number;
  /** Path ID of this branch. */
  pathId: string;
}

export interface LoopContext {
  loopId: string | number;
  /** nodeId of the loop node in the graph. */
  loopNodeId: string;
  currentIteration: number;
  isBraced: boolean;
  /** Path ID of this loop. */
  pathId: string;
}

export interface BuilderFrame {
  frameId: string;
  /** nodeId of the stack_frame node. */
  nodeId: string;
  parentFrameId?: string;
  /** Current control-flow path active in this frame. */
  activePathId: string;
  /** Local branch counter stack per scope nesting.
   *  Top = current scope's counter; increments on each new branch at this level.
   */
  branchCounterStack: number[];
  conditionStack: ConditionContext[];
  loopStack: LoopContext[];
  activeScopeDepth: number;
}
