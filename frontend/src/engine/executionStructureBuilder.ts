// frontend/src/engine/executionStructureBuilder.ts
// ============================================================
// ExecutionStructureStore — Frontend store for the ESB graph
//
// ISOLATED: Does NOT modify LayoutEngine or traceProcessor.
// Receives ExecutionGraph from the new socket event.
// Provides O(1) lookup APIs for the LayoutEngine (future).
// ============================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ESBNodeType =
  | 'program'
  | 'function'
  | 'condition'
  | 'branch'
  | 'loop'
  | 'loop_body'
  | 'statement'
  | 'call'
  | 'return'
  | 'variable'
  | 'array'
  | 'pointer'
  | 'output'
  | 'input';

export interface ESBNode {
  nodeId: string;
  type: ESBNodeType;
  label: string;
  frameId: string | null;
  conditionId: string | null;
  parentId: string | null;
  children: string[];
  depth: number;
  pathId: string;
  stepStart: number;
  stepEnd: number | null;
  meta: Record<string, any>;
}

export interface ESBPath {
  pathId: string;
  segments: string[];
}

export interface ESBMetadata {
  totalNodes: number;
  totalPaths: number;
  totalSteps: number;
  builtAt: number;
}

export interface ExecutionGraph {
  nodes: ESBNode[];
  nodeMap: Record<string, ESBNode>;
  stepToNode: Record<number, string>;
  paths: ESBPath[];
  metadata: ESBMetadata;
}

// ---------------------------------------------------------------------------
// Internal store state
// ---------------------------------------------------------------------------

interface StoreState {
  graph: ExecutionGraph | null;
  nodeMap: Record<string, ESBNode>;
  stepToNode: Record<number, string>;
  paths: ESBPath[];
  loaded: boolean;
}

const _state: StoreState = {
  graph: null,
  nodeMap: {},
  stepToNode: {},
  paths: [],
  loaded: false,
};

const ESB_DEBUG = import.meta.env?.DEV === true;

// ---------------------------------------------------------------------------
// Store API
// ---------------------------------------------------------------------------

export const ExecutionStructureStore = {
  /**
   * Load a graph received from the socket.
   * Replaces any previously loaded graph.
   */
  load(graph: ExecutionGraph): void {
    _state.graph = graph;
    _state.nodeMap = graph.nodeMap || {};
    _state.stepToNode = graph.stepToNode || {};
    _state.paths = graph.paths || [];
    _state.loaded = true;

    console.log(
      `[ESB] Graph received: ${graph.metadata?.totalNodes ?? 0} nodes,` +
      ` ${graph.metadata?.totalPaths ?? 0} paths,` +
      ` ${graph.metadata?.totalSteps ?? 0} steps`
    );
  },

  /**
   * Clear store — call when a new trace is requested.
   */
  clear(): void {
    _state.graph = null;
    _state.nodeMap = {};
    _state.stepToNode = {};
    _state.paths = [];
    _state.loaded = false;
  },

  /**
   * Whether a graph has been loaded.
   */
  isLoaded(): boolean {
    return _state.loaded;
  },

  // -------------------------------------------------------------------------
  // O(1) lookup APIs
  // -------------------------------------------------------------------------

  /**
   * Get any node by its nodeId.
   */
  getNode(nodeId: string): ESBNode | null {
    return _state.nodeMap[nodeId] ?? null;
  },

  /**
   * Get the node that owns a given step index.
   * Returns null if the ESB graph is not loaded or step not found.
   */
  getNodeForStep(stepIndex: number): ESBNode | null {
    if (!_state.loaded) return null;
    const nodeId = _state.stepToNode[stepIndex];
    if (!nodeId) return null;
    return _state.nodeMap[nodeId] ?? null;
  },

  /**
   * Get the node id that owns a given step index.
   */
  getNodeIdForStep(stepIndex: number): string | null {
    if (!_state.loaded) return null;
    return _state.stepToNode[stepIndex] ?? null;
  },

  /**
   * Get all child nodes of a given node.
   */
  getChildren(nodeId: string): ESBNode[] {
    const node = _state.nodeMap[nodeId];
    if (!node) return [];
    return node.children
      .map((id) => _state.nodeMap[id])
      .filter(Boolean) as ESBNode[];
  },

  /**
   * Get the parent node of a given node.
   */
  getParent(nodeId: string): ESBNode | null {
    const node = _state.nodeMap[nodeId];
    if (!node || !node.parentId) return null;
    return _state.nodeMap[node.parentId] ?? null;
  },

  /**
   * Get the full path identifier of a node.
   */
  getPath(nodeId: string): string | null {
    const node = _state.nodeMap[nodeId];
    return node?.pathId ?? null;
  },

  /**
   * Get all nodes belonging to a given frameId.
   */
  getNodesForFrame(frameId: string): ESBNode[] {
    if (!_state.graph) return [];
    return _state.graph.nodes.filter((n) => n.frameId === frameId);
  },

  /**
   * Get the root function node for a frameId.
   */
  getFunctionNode(frameId: string): ESBNode | null {
    if (!_state.graph) return null;
    return (
      _state.graph.nodes.find(
        (n) => n.type === 'function' && n.frameId === frameId
      ) ?? null
    );
  },

  /**
   * Get all paths.
   */
  getAllPaths(): ESBPath[] {
    return _state.paths;
  },

  /**
   * Get a snapshot of the full graph (for debugging).
   */
  getGraph(): ExecutionGraph | null {
    return _state.graph;
  },

  // -------------------------------------------------------------------------
  // Debug: Compare new ESB ownership with LayoutEngine's resolved parent
  // -------------------------------------------------------------------------

  /**
   * Compare ESB node assignment with the LayoutEngine's resolved parent ID.
   * Logs a warning if they differ — for development diagnostics only.
   */
  compareWithLayoutEngine(stepIndex: number, layoutParentId: string | null): void {
    if (!ESB_DEBUG) return;
    const esbNode = this.getNodeForStep(stepIndex);
    const esbParentId = esbNode?.nodeId ?? null;

    if (esbParentId !== layoutParentId) {
      console.warn(
        `[ESB MISMATCH] step=${stepIndex}` +
        ` oldParent=${layoutParentId ?? 'null'}` +
        ` newParent(ESB)=${esbParentId ?? 'null'}` +
        ` nodeType=${esbNode?.type ?? 'unknown'}` +
        ` label="${esbNode?.label ?? ''}"`
      );
    }
  },
};

export default ExecutionStructureStore;
