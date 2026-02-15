// src/engine/position.ts
// ============================================================================
// PositionManager — Deterministic layout engine (relation tree → coordinates)
//
// Converts the logical RelationTree from RelationManager into X/Y positions.
// Same tree always produces the same coordinates (deterministic).
//
// API:
//   updateFromRelation(tree, upToStep)  — Recompute positions
//   getPosition(id)                     — Lookup single element position
//   getAllPositions()                    — Snapshot of all positions
//   getDelta(previousPositions)         — Returns only changed positions
// ============================================================================

import type { RelationTree, RelationNode } from './relation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ElementPosition {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parentId: string | null;
  data: Record<string, any>;
  stepId: number;
  children: string[];
}

export interface PositionDelta {
  added: Map<string, ElementPosition>;
  updated: Map<string, ElementPosition>;
  removed: Set<string>;
}

// ---------------------------------------------------------------------------
// Layout constants (extracted from LayoutEngine)
// ---------------------------------------------------------------------------

const LAYOUT = {
  MAIN_FUNCTION_X: 40,
  MAIN_FUNCTION_Y: 40,
  MAIN_FUNCTION_WIDTH: 400,
  GLOBAL_PANEL_WIDTH: 400,
  PANEL_GAP: 40,
  FUNCTION_BOX_WIDTH: 400,
  FUNCTION_VERTICAL_SPACING: 200,
  HEADER_HEIGHT: 50,
  VARIABLE_HEIGHT: 140,
  EXPLANATION_HEIGHT: 40,
  ELEMENT_SPACING: 8,
  MAIN_INDENT: -10,
  FUNCTION_INDENT: 20,
} as const;

// ---------------------------------------------------------------------------
// PositionManager
// ---------------------------------------------------------------------------

export class PositionManager {
  private positions: Map<string, ElementPosition> = new Map();
  private previousPositions: Map<string, ElementPosition> = new Map();
  private functionOrderMap: Map<string, number> = new Map();
  private functionOrder: number = 0;

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Compute positions from the relation tree up to the given step.
   *
   * @param tree     The current relation tree
   * @param upToStep Only include nodes alive at this step
   */
  updateFromRelation(tree: RelationTree, upToStep: number): void {
    // Store previous for delta calculation
    this.previousPositions = new Map(this.positions);
    this.positions.clear();
    this.functionOrderMap.clear();
    this.functionOrder = 0;

    // Walk from root → children recursively
    this.layoutNode(tree, tree.root, upToStep);
  }

  getPosition(id: string): ElementPosition | undefined {
    return this.positions.get(id);
  }

  getAllPositions(): Map<string, ElementPosition> {
    return this.positions;
  }

  /**
   * Compute delta between current and previous positions.
   */
  getDelta(): PositionDelta {
    const added = new Map<string, ElementPosition>();
    const updated = new Map<string, ElementPosition>();
    const removed = new Set<string>();

    // Find new & updated
    this.positions.forEach((pos, id) => {
      const prev = this.previousPositions.get(id);
      if (!prev) {
        added.set(id, pos);
      } else if (
        prev.x !== pos.x ||
        prev.y !== pos.y ||
        prev.width !== pos.width ||
        prev.height !== pos.height ||
        JSON.stringify(prev.data) !== JSON.stringify(pos.data)
      ) {
        updated.set(id, pos);
      }
    });

    // Find removed
    this.previousPositions.forEach((_, id) => {
      if (!this.positions.has(id)) {
        removed.add(id);
      }
    });

    return { added, updated, removed };
  }

  // -----------------------------------------------------------------------
  // Private: Layout recursion
  // -----------------------------------------------------------------------

  private layoutNode(tree: RelationTree, node: RelationNode, upToStep: number): void {
    if (node.type === 'root') {
      // Layout all direct children of root (stack_frame, heap_object)
      for (const childId of node.children) {
        const child = tree.nodes.get(childId);
        if (!child) continue;
        if (child.birthStep > upToStep) continue;
        if (child.deathStep !== null && child.deathStep <= upToStep) continue;
        this.layoutNode(tree, child, upToStep);
      }
      return;
    }

    if (node.type === 'stack_frame') {
      this.layoutStackFrame(tree, node, upToStep);
    }
    // Heap objects are positioned separately
    if (node.type === 'heap_object') {
      this.layoutHeapObject(tree, node, upToStep);
    }
  }

  private layoutStackFrame(tree: RelationTree, frame: RelationNode, upToStep: number): void {
    const frameId = frame.data.frameId;
    const callDepth = frame.data.callDepth || 0;
    const isMain = frameId === 'main-0';

    // Calculate frame position
    let frameX: number;
    let frameY: number;
    let frameWidth: number;

    if (isMain) {
      frameX = LAYOUT.MAIN_FUNCTION_X;
      frameY = LAYOUT.MAIN_FUNCTION_Y;
      frameWidth = LAYOUT.MAIN_FUNCTION_WIDTH;
    } else {
      if (!this.functionOrderMap.has(frameId)) {
        this.functionOrderMap.set(frameId, this.functionOrder++);
      }
      const orderIndex = this.functionOrderMap.get(frameId)!;
      const baseX = LAYOUT.MAIN_FUNCTION_X + LAYOUT.MAIN_FUNCTION_WIDTH + LAYOUT.PANEL_GAP;
      frameX = baseX + (callDepth - 1) * (LAYOUT.FUNCTION_BOX_WIDTH + 60);
      frameY = LAYOUT.MAIN_FUNCTION_Y + orderIndex * LAYOUT.FUNCTION_VERTICAL_SPACING;
      frameWidth = LAYOUT.FUNCTION_BOX_WIDTH;
    }

    const indent = isMain ? LAYOUT.MAIN_INDENT : LAYOUT.FUNCTION_INDENT;
    let cursorY = LAYOUT.HEADER_HEIGHT;

    // Layout children (variables, outputs, loops, etc.)
    const aliveChildren: RelationNode[] = [];
    for (const childId of frame.children) {
      const child = tree.nodes.get(childId);
      if (!child) continue;
      if (child.birthStep > upToStep) continue;
      // Don't filter dead children for function_return elements
      if (child.type !== 'function_return' && child.deathStep !== null && child.deathStep <= upToStep) continue;
      aliveChildren.push(child);
    }

    const childPositionIds: string[] = [];

    for (const child of aliveChildren) {
      const childX = frameX + indent;
      const childY = frameY + cursorY;
      const childWidth = frameWidth - indent * 2;

      let childHeight = LAYOUT.VARIABLE_HEIGHT;
      if (child.data.explanation) childHeight += LAYOUT.EXPLANATION_HEIGHT;

      const childType = this.mapRelationTypeToLayoutType(child.type);


      const pos: ElementPosition = {
        id: child.id,
        type: childType,
        x: childX,
        y: childY,
        width: childWidth,
        height: childHeight,
        parentId: frame.id,
        data: { ...child.data },
        stepId: child.birthStep,
        children: [],
      };

      this.positions.set(child.id, pos);
      childPositionIds.push(child.id);
      cursorY += childHeight + LAYOUT.ELEMENT_SPACING;
    }

    // Create the frame position element
    const frameHeight = Math.max(80, cursorY + 20);
    const framePos: ElementPosition = {
      id: frame.id,
      type: isMain ? 'main' : 'function_call',
      x: frameX,
      y: frameY,
      width: frameWidth,
      height: frameHeight,
      parentId: frame.parentId,
      data: { ...frame.data },
      stepId: frame.birthStep,
      children: childPositionIds,
    };
    this.positions.set(frame.id, framePos);
  }

  private layoutHeapObject(tree: RelationTree, node: RelationNode, upToStep: number): void {
    // Position heap objects in a separate panel area
    const heapX = LAYOUT.MAIN_FUNCTION_X + LAYOUT.MAIN_FUNCTION_WIDTH + LAYOUT.PANEL_GAP;
    const heapY = LAYOUT.MAIN_FUNCTION_Y + 600; // Below function frames

    const pos: ElementPosition = {
      id: node.id,
      type: 'heap_object',
      x: heapX,
      y: heapY,
      width: 200,
      height: 80,
      parentId: 'root',
      data: { ...node.data },
      stepId: node.birthStep,
      children: [],
    };
    this.positions.set(node.id, pos);
  }

  private mapRelationTypeToLayoutType(type: string): string {
    switch (type) {
      case 'variable': return 'variable';
      case 'pointer': return 'heap_pointer';
      case 'array': return 'array';
      case 'output': return 'output';
      case 'input': return 'input';
      case 'loop': return 'loop';
      case 'condition': return 'condition';
      case 'function_return': return 'function_return';
      case 'call_site': return 'call_site';
      default: return type;
    }
  }
}
