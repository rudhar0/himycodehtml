// src/engine/relation.ts
// ============================================================================
// RelationManager — Pure logical visualization model (element ownership tree)
//
// No coordinates, no animation, no React.
// Tracks: stack frames, variables, heap objects, pointer relations, arrays.
//
// API:
//   applyStep(step)   — Mutate the tree based on a single execution step
//   getTree()         — Returns the current root node
//   getElement(id)    — Lookup a single element by id
//   reset()           — Clear all state
// ============================================================================

import type { ExecutionStep, ExecutionTrace } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RelationNodeType =
  | 'root'
  | 'stack_frame'
  | 'variable'
  | 'pointer'
  | 'array'
  | 'heap_object'
  | 'output'
  | 'input'
  | 'loop'
  | 'condition'
  | 'function_return'
  | 'call_site';

export interface RelationNode {
  id: string;
  type: RelationNodeType;
  parentId: string | null;
  children: string[];
  data: Record<string, any>;
  birthStep: number;
  deathStep: number | null;   // null = still alive
  lastUpdateStep: number;
}

export interface RelationTree {
  root: RelationNode;
  nodes: Map<string, RelationNode>;
  pointerEdges: Map<string, string>;  // pointer node id → target node id
}

// ---------------------------------------------------------------------------
// RelationManager
// ---------------------------------------------------------------------------

export class RelationManager {
  private nodes: Map<string, RelationNode> = new Map();
  private pointerEdges: Map<string, string> = new Map();
  private frameStack: string[] = [];
  private root: RelationNode;
  private stepCounter: number = 0;

  constructor() {
    this.root = this.createNode('root', 'root', null, {});
    this.nodes.set('root', this.root);

    // Pre-create the main frame
    const mainFrame = this.createNode('frame-main-0', 'stack_frame', 'root', {
      functionName: 'main',
      frameId: 'main-0',
      callDepth: 0,
      isActive: true,
    });
    this.addChild('root', mainFrame.id);
    this.frameStack.push(mainFrame.id);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  applyStep(step: ExecutionStep, index: number, executionTrace?: ExecutionTrace): void {
    this.stepCounter = index;
    const raw = step as any;
    const eventType: string = raw.eventType || raw.type || '';
    const frameId: string = raw.frameId || 'main-0';

    switch (eventType) {
      case 'func_enter':
        this.handleFuncEnter(raw, index, executionTrace);
        break;
      case 'func_exit':
        this.handleFuncExit(raw, index, executionTrace);
        break;
      case 'var_declare':
        this.handleVarDeclare(raw, index, frameId);
        break;
      case 'var_assign':
      case 'var_load':
        this.handleVarAssign(raw, index, frameId);
        break;
      case 'array_declaration':
      case 'array_create':
        this.handleArrayCreate(raw, index, frameId);
        break;
      case 'array_assignment':
      case 'array_index_assign':
        this.handleArrayUpdate(raw, index);
        break;
      case 'heap_alloc':
      case 'heap_allocation':
        this.handleHeapAlloc(raw, index, frameId);
        break;
      case 'heap_free':
        this.handleHeapFree(raw, index);
        break;
      case 'output':
      case 'stdout':
      case 'print':
        this.handleOutput(raw, index, frameId);
        break;
      case 'input_request':
        this.handleInput(raw, index, frameId);
        break;
      case 'loop_start':
        this.handleLoopStart(raw, index, frameId);
        break;
      case 'loop_iteration':
        this.handleLoopIteration(raw, index);
        break;
      case 'loop_end':
        this.handleLoopEnd(raw, index);
        break;
      case 'conditional_start':
        this.handleConditionStart(raw, index, frameId);
        break;
      case 'conditional_branch':
        this.handleConditionBranch(raw, index);
        break;
      default:
        // Unknown types are preserved but not stored in the tree
        break;
    }
  }

  getTree(): RelationTree {
    return {
      root: this.root,
      nodes: this.nodes,
      pointerEdges: this.pointerEdges,
    };
  }

  getElement(id: string): RelationNode | undefined {
    return this.nodes.get(id);
  }

  getAliveNodes(upToStep: number): RelationNode[] {
    const alive: RelationNode[] = [];
    this.nodes.forEach((node) => {
      if (
        node.birthStep <= upToStep &&
        (node.deathStep === null || node.deathStep > upToStep)
      ) {
        alive.push(node);
      }
    });
    return alive;
  }

  reset(): void {
    this.nodes.clear();
    this.pointerEdges.clear();
    this.frameStack = [];
    this.stepCounter = 0;

    this.root = this.createNode('root', 'root', null, {});
    this.nodes.set('root', this.root);

    const mainFrame = this.createNode('frame-main-0', 'stack_frame', 'root', {
      functionName: 'main',
      frameId: 'main-0',
      callDepth: 0,
      isActive: true,
    });
    this.addChild('root', mainFrame.id);
    this.frameStack.push(mainFrame.id);
  }

  // -----------------------------------------------------------------------
  // Private: Node helpers
  // -----------------------------------------------------------------------

  private createNode(
    id: string,
    type: RelationNodeType,
    parentId: string | null,
    data: Record<string, any>,
  ): RelationNode {
    const node: RelationNode = {
      id,
      type,
      parentId,
      children: [],
      data,
      birthStep: this.stepCounter,
      deathStep: null,
      lastUpdateStep: this.stepCounter,
    };
    this.nodes.set(id, node);
    return node;
  }

  private addChild(parentId: string, childId: string): void {
    const parent = this.nodes.get(parentId);
    if (parent && !parent.children.includes(childId)) {
      parent.children.push(childId);
    }
  }

  private getCurrentFrameId(): string {
    return this.frameStack[this.frameStack.length - 1] || 'frame-main-0';
  }

  // -----------------------------------------------------------------------
  // Private: Step handlers
  // -----------------------------------------------------------------------

  private handleFuncEnter(raw: any, index: number, _executionTrace?: ExecutionTrace): void {
    const frameId = raw.frameId;
    const functionName = raw.function || '';
    const callDepth = raw.callDepth || 0;
    const parentFrameId = raw.parentFrameId;
    const nodeId = `frame-${frameId}`;

    if (this.nodes.has(nodeId)) return;

    const parentNodeId = parentFrameId
      ? `frame-${parentFrameId}`
      : this.getCurrentFrameId();

    const frame = this.createNode(nodeId, 'stack_frame', parentNodeId, {
      functionName,
      frameId,
      callDepth,
      parentFrameId,
      isActive: true,
      isReturning: false,
    });

    this.addChild(parentNodeId, frame.id);
    this.frameStack.push(nodeId);
  }

  private handleFuncExit(raw: any, index: number, _executionTrace?: ExecutionTrace): void {
    const frameId = raw.frameId;
    const nodeId = `frame-${frameId}`;
    const node = this.nodes.get(nodeId);

    if (node) {
      node.data.isActive = false;
      node.data.isReturning = true;
      node.data.returnValue = raw.returnValue ?? raw.value;
      node.lastUpdateStep = index;

      // Create return element
      const returnId = `return-${frameId}-${index}`;
      this.createNode(returnId, 'function_return', nodeId, {
        frameId,
        functionName: raw.function || node.data.functionName,
        returnValue: raw.returnValue ?? raw.value,
      });
      this.addChild(nodeId, returnId);
    }

    // Pop from frame stack
    const idx = this.frameStack.indexOf(nodeId);
    if (idx !== -1) this.frameStack.splice(idx, 1);
  }

  private handleVarDeclare(raw: any, index: number, frameId: string): void {
    const varName = raw.name || raw.symbol;
    if (!varName) return;

    const nodeId = `var-${frameId}-${varName}-${index}`;
    const parentNodeId = `frame-${frameId}`;

    // Determine if this is a pointer
    const varType = raw.varType || 'int';
    const isPointer = varType.includes('*') || varType.toLowerCase().includes('ptr');
    const nodeType: RelationNodeType = isPointer ? 'pointer' : 'variable';

    this.createNode(nodeId, nodeType, parentNodeId, {
      name: varName,
      value: '',
      type: varType,
      primitive: varType,
      address: raw.address || raw.addr || '0x0',
      scope: 'local',
      isInitialized: false,
      isAlive: true,
      birthStep: index,
      frameId,
      explanation: raw.explanation,
    });

    this.addChild(parentNodeId, nodeId);
  }

  private handleVarAssign(raw: any, index: number, frameId: string): void {
    const varName = raw.name || raw.symbol;
    if (!varName) return;

    // Try to find existing variable — search backwards for most recent
    let existing: RelationNode | undefined;
    const parentNodeId = `frame-${frameId}`;
    const parent = this.nodes.get(parentNodeId);
    if (parent) {
      for (let i = parent.children.length - 1; i >= 0; i--) {
        const child = this.nodes.get(parent.children[i]);
        if (child && child.data.name === varName && child.deathStep === null) {
          existing = child;
          break;
        }
      }
    }

    if (existing) {
      existing.data.value = raw.value;
      existing.data.isInitialized = true;
      existing.lastUpdateStep = index;

      if (existing.type === 'pointer' && raw.pointsTo) {
        this.pointerEdges.set(existing.id, raw.pointsTo);
      }
    } else {
      // Create as new variable (initial load)
      const nodeId = `var-${frameId}-${varName}-${index}`;
      const varType = raw.varType || raw.type || 'int';
      const isPointer = varType.includes('*');
      this.createNode(nodeId, isPointer ? 'pointer' : 'variable', parentNodeId, {
        name: varName,
        value: raw.value,
        type: varType,
        primitive: varType,
        address: raw.address || raw.addr || '0x0',
        scope: 'local',
        isInitialized: true,
        isAlive: true,
        birthStep: index,
        frameId,
        explanation: raw.explanation,
      });
      this.addChild(parentNodeId, nodeId);
    }
  }

  private handleArrayCreate(raw: any, index: number, frameId: string): void {
    const name = raw.name;
    if (!name) return;

    const nodeId = `array-${frameId}-${name}-${index}`;
    const parentNodeId = `frame-${frameId}`;
    const dims = raw.dimensions || [1];

    this.createNode(nodeId, 'array', parentNodeId, {
      name,
      baseType: raw.baseType || 'int',
      dimensions: dims,
      values: raw.values || new Array(dims.reduce((a: number, b: number) => a * b, 1)).fill(0),
      address: raw.address || '0x0',
      birthStep: index,
      owner: frameId,
    });

    this.addChild(parentNodeId, nodeId);
  }

  private handleArrayUpdate(raw: any, index: number): void {
    // Find the array node by name
    const name = raw.name;
    if (!name) return;

    for (const [id, node] of this.nodes) {
      if (node.type === 'array' && node.data.name === name && node.deathStep === null) {
        const indices = raw.indices || [];
        const dims = node.data.dimensions || [1];
        const flat = this.calcFlatIndex(indices, dims);
        if (flat >= 0 && flat < node.data.values.length) {
          node.data.values[flat] = raw.value;
        }
        node.lastUpdateStep = index;
        break;
      }
    }
  }

  private handleHeapAlloc(raw: any, index: number, frameId: string): void {
    const nodeId = `heap-${raw.address || index}`;
    this.createNode(nodeId, 'heap_object', 'root', {
      address: raw.address,
      size: raw.size,
      type: raw.varType || 'void',
      allocFrame: frameId,
      birthStep: index,
    });
    this.addChild('root', nodeId);
  }

  private handleHeapFree(raw: any, index: number): void {
    const nodeId = `heap-${raw.address}`;
    const node = this.nodes.get(nodeId);
    if (node) {
      node.deathStep = index;
      node.lastUpdateStep = index;
    }
  }

  private handleOutput(raw: any, index: number, frameId: string): void {
    const nodeId = `output-${frameId}-${index}`;
    const parentNodeId = `frame-${frameId}`;
    this.createNode(nodeId, 'output', parentNodeId, {
      text: raw.value || raw.stdout || '',
      birthStep: index,
      explanation: raw.explanation,
    });
    this.addChild(parentNodeId, nodeId);
  }

  private handleInput(raw: any, index: number, frameId: string): void {
    const nodeId = `input-${frameId}-${index}`;
    const parentNodeId = `frame-${frameId}`;
    this.createNode(nodeId, 'input', parentNodeId, {
      prompt: raw.prompt || '',
      format: raw.format || '',
      varName: raw.varName || '',
      birthStep: index,
    });
    this.addChild(parentNodeId, nodeId);
  }

  private handleLoopStart(raw: any, index: number, frameId: string): void {
    const loopId = raw.loopId ?? index;
    const nodeId = `loop-${frameId}-${loopId}`;
    const parentNodeId = `frame-${frameId}`;
    this.createNode(nodeId, 'loop', parentNodeId, {
      loopId,
      loopType: raw.loopType || 'for',
      currentIteration: 0,
      totalIterations: raw.totalIterations || 0,
      birthStep: index,
      parentFrameId: frameId,
    });
    this.addChild(parentNodeId, nodeId);
  }

  private handleLoopIteration(raw: any, index: number): void {
    const loopId = raw.loopId;
    for (const [id, node] of this.nodes) {
      if (node.type === 'loop' && node.data.loopId === loopId && node.deathStep === null) {
        node.data.currentIteration = (node.data.currentIteration || 0) + 1;
        node.lastUpdateStep = index;
        break;
      }
    }
  }

  private handleLoopEnd(raw: any, index: number): void {
    const loopId = raw.loopId;
    for (const [id, node] of this.nodes) {
      if (node.type === 'loop' && node.data.loopId === loopId && node.deathStep === null) {
        node.deathStep = index;
        node.lastUpdateStep = index;
        break;
      }
    }
  }

  private handleConditionStart(raw: any, index: number, frameId: string): void {
    const condId = raw.conditionId || `cond-${index}`;
    const nodeId = `condition-${frameId}-${condId}`;
    const parentNodeId = `frame-${frameId}`;
    this.createNode(nodeId, 'condition', parentNodeId, {
      conditionId: condId,
      conditionType: raw.conditionType || 'if',
      birthStep: index,
      parentFrameId: frameId,
    });
    this.addChild(parentNodeId, nodeId);
  }

  private handleConditionBranch(raw: any, index: number): void {
    const condId = raw.conditionId;
    for (const [id, node] of this.nodes) {
      if (
        node.type === 'condition' &&
        node.data.conditionId === condId &&
        node.deathStep === null
      ) {
        node.data.conditionResult = raw.result;
        node.data.branchTaken = raw.branch;
        node.lastUpdateStep = index;
        break;
      }
    }
  }

  private calcFlatIndex(indices: number[], dimensions: number[]): number {
    if (indices.length === 1) return indices[0];
    if (indices.length === 2) return indices[0] * dimensions[1] + indices[1];
    return indices[0];
  }
}
