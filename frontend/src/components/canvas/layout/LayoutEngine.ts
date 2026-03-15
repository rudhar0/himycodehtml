// frontend/src/components/canvas/layout/LayoutEngine.ts

import type { ExecutionStep, ExecutionTrace } from "../../../types";
import { useLoopStore } from "../../../store/slices/loopSlice";

export interface LayoutElement {
  id: string;
  type:
    | "main"
    | "variable"
    | "array"
    | "pointer"
    | "heap_pointer"
    | "loop"
    | "condition"
    | "output"
    | "input"
    | "global"
    | "function"
    | "function_call"
    | "function_return"
    | "struct"
    | "class"
    | "array_panel"
    | "array_reference"
    | "call_site"
    | "condition_caller"
    | "loop_caller";
  subtype?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parentId?: string;
  children?: LayoutElement[];
  data?: any;
  stepId?: number;
  metadata?: {
    isMultiple?: boolean;
    relatedElements?: string[];
    referencesArray?: string;
    firstCellX?: number;
    firstCellY?: number;
    // Lane support
    lanes?: Record<string, LaneState>;
    stackIndex?: number; // For Z-Index
    [key: string]: any;
  };
}

// Lane Definition
export interface LaneState {
  startY: number;
  usedHeight: number;
}

export interface Layout {
  mainFunction: LayoutElement;
  globalPanel: LayoutElement;
  arrayPanel: LayoutElement | null;
  elements: LayoutElement[];
  arrayReferences: LayoutElement[];
  updateArrows: LayoutElement[];
  functionArrows: LayoutElement[];
  controlArrows: LayoutElement[];
  width: number;
  height: number;
}

const ELEMENT_SPACING = 8;
const MAIN_INDENT_SIZE = -10;
const FUNCTION_INDENT_SIZE = 20;

// Z-Index Constants
export const BASE_FUNCTION_Z = 10;
export const STACK_Z_STEP = 10;

// Helper to determine indent based on frame type
const getIndentSize = (frame: LayoutElement) => {
  return frame.type === 'main' ? MAIN_INDENT_SIZE : FUNCTION_INDENT_SIZE;
};

const HEADER_HEIGHT = 50;
const MAIN_FUNCTION_X = 40;
const MAIN_FUNCTION_Y = 40;
const MAIN_FUNCTION_WIDTH = 400;
const GLOBAL_PANEL_WIDTH = 400;
const PANEL_GAP = 40;
const VARIABLE_HEIGHT = 140;
const EXPLANATION_HEIGHT = 40;
const FUNCTION_BOX_WIDTH = 400;
const FUNCTION_VERTICAL_SPACING = 200;
const PARAMS_HEIGHT = 0;
const LOCALS_HEIGHT = 0;
const CONTROL_HORIZONTAL_GAP = 160;
const CONTROL_SAFE_MARGIN = 24;
const CONTROL_CURVE_OFFSET = 60;
const CONTROL_SUBTREE_SHIFT_X = 120;
const CONTROL_BASE_WIDTH = 320;
const CONTROL_CALLER_HEIGHT = 44;
const CONTROL_HEADER_HEIGHT = 58;
const CONTROL_BODY_HEIGHT = 120;
const CONTROL_CALLER_BODY_GAP = 20;
const CONTROL_CHAIN_VERTICAL_GAP = 14;
const MAX_PARENT_FLOW_WIDTH = 600;


interface ArrayTrackerData {
  name: string;
  baseType: string;
  dimensions: number[];
  address: string;
  owner: string;
  birthStep: number;
  values: Map<string, any>;
  lastUpdateStep: number;
}

type ControlKind =
  | "if"
  | "else_if"
  | "else"
  | "switch"
  | "case"
  | "default"
  | "group";

type BranchState = "active" | "skipped" | "pending";

interface ControlGroupState {
  groupId: string;
  frameId: string;
  scopeDepth: number;
  containerElementId: string;
  controlType: "if_chain" | "switch";
  parentControlElementId?: string;
  parentContainerId: string;
  parentContainerDepth: number;
  members: string[];
  activeCallerId?: string;
  activeBodyId?: string;
  lastStep: number;
  lastLine: number;
  switchStartStepIndex?: number;
  switchExpression?: string;
  switchCaseIds?: string[];
}

class ProgressiveArrayTracker {
  private arrays: Map<string, ArrayTrackerData> = new Map();
  private stateCache: Map<string, any> = new Map();

  createArray(
    name: string,
    baseType: string,
    dimensions: number[],
    address: string,
    owner: string,
    stepIndex: number,
    initializerValues?: any[],
  ) {
    if (!Array.isArray(dimensions) || dimensions.length === 0) {
      dimensions = [1];
    }

    const totalSize = dimensions.reduce((a, b) => a * b, 1);
    const valuesMap = new Map<string, any>();

    if (initializerValues && Array.isArray(initializerValues)) {
      initializerValues.forEach((val, flatIdx) => {
        if (flatIdx >= totalSize) return;
        const indices = this.flatIndexToIndices(flatIdx, dimensions);
        const key = indices.join(",");
        valuesMap.set(key, val);
      });
    }

    this.arrays.set(name, {
      name,
      baseType,
      dimensions,
      address,
      owner,
      birthStep: stepIndex,
      values: valuesMap,
      lastUpdateStep: stepIndex,
    });
    this.invalidateCache(name);
  }

  private flatIndexToIndices(flatIdx: number, dimensions: number[]): number[] {
    const indices: number[] = new Array(dimensions.length).fill(0);
    let remainder = flatIdx;
    for (let d = dimensions.length - 1; d >= 0; d--) {
      const dimSize = dimensions[d];
      indices[d] = remainder % dimSize;
      remainder = Math.floor(remainder / dimSize);
    }
    return indices;
  }

  updateArrayElement(
    name: string,
    indices: number[],
    value: any,
    stepIndex: number,
  ) {
    const arr = this.arrays.get(name);
    if (!arr) {
      console.warn(`Array ${name} not found, creating it...`);
      const dimensions = indices.map((idx) => idx + 1);
      this.createArray(name, "int", dimensions, "0x0", "main", stepIndex);
      const newArr = this.arrays.get(name);
      if (!newArr) return;

      const key = indices.join(",");
      newArr.values.set(key, value);
      newArr.lastUpdateStep = stepIndex;
      this.invalidateCache(name);
      return;
    }

    const key = indices.join(",");
    arr.values.set(key, value);
    arr.lastUpdateStep = stepIndex;
    this.invalidateCache(name);
  }

  private invalidateCache(name: string) {
    for (const key of this.stateCache.keys()) {
      if (key.startsWith(name + "-")) {
        this.stateCache.delete(key);
      }
    }
  }

  getArrayState(name: string, upToStep: number) {
    const cacheKey = `${name}-${upToStep}`;

    if (this.stateCache.has(cacheKey)) {
      return this.stateCache.get(cacheKey);
    }

    const arr = this.arrays.get(name);
    if (!arr || arr.birthStep > upToStep) return null;

    const totalSize = arr.dimensions.reduce((a, b) => a * b, 1);
    const progressiveValues: any[] = new Array(totalSize).fill(null);

    arr.values.forEach((value, key) => {
      const indices = key.split(",").map(Number);
      const flatIdx = this.calculateFlatIndex(indices, arr.dimensions);

      if (flatIdx >= 0 && flatIdx < totalSize) {
        progressiveValues[flatIdx] = value;
      }
    });

    const state = {
      ...arr,
      values: progressiveValues,
    };

    this.stateCache.set(cacheKey, state);
    return state;
  }

  getAllArrays(upToStep: number) {
    const result: any[] = [];
    // Iterate over stored arrays; we only need the name (key) to retrieve state
    this.arrays.forEach((_, name) => {
      const state = this.getArrayState(name, upToStep);
      if (state) {
        result.push(state);
      }
    });
    return result;
  }

  private calculateFlatIndex(indices: number[], dimensions: number[]): number {
    if (dimensions.length === 1) {
      return indices[0];
    }
    if (dimensions.length === 2) {
      const [i, j] = indices;
      return i * dimensions[1] + j;
    }
    if (dimensions.length === 3) {
      const [i, j, k] = indices;
      return i * dimensions[1] * dimensions[2] + j * dimensions[2] + k;
    }

    let flatIdx = 0;
    let multiplier = 1;
    for (let d = dimensions.length - 1; d >= 0; d--) {
      flatIdx += indices[d] * multiplier;
      multiplier *= dimensions[d];
    }
    return flatIdx;
  }
}

export class LayoutEngine {
  private static elementHistory: Map<string, LayoutElement> = new Map();
  private static arrayTracker = new ProgressiveArrayTracker();
  private static createdInStep: Map<string, number> = new Map();
  private static updateArrows: Map<number, LayoutElement[]> = new Map();
  private static functionFrames: Map<string, LayoutElement> = new Map();
  private static functionArrows: LayoutElement[] = [];
  private static controlArrows: LayoutElement[] = [];
  private static frameDepthMap: Map<string, number> = new Map();
  private static frameOrderMap: Map<string, number> = new Map();
  private static frameOrder: number = 0;
  private static activeControlGroups: Map<string, ControlGroupState> = new Map();
  private static activeControlByDepth: Map<string, Map<number, string>> = new Map();
  private static ephemeralControlByDepth: Map<
    string,
    Map<number, { elementId: string; usedAtStep?: number; statementLine?: number }>
  > = new Map();
  private static recentIfGroupByFrame: Map<
    string,
    { groupId: string; stepIndex: number; line: number; scopeDepth: number }
  > = new Map();
  private static currentScopeDepth: Map<string, number> = new Map();
  private static bodyByStepKey: Map<string, LayoutElement> = new Map();
  private static containerByConditionId: Map<string, LayoutElement> = new Map();
  private static conditionTree: { nodes: Map<string, any> } | null = null;
  private static rightFlowOccupancy: Map<
    string,
    Array<{ x: number; y: number; width: number; height: number }>
  > = new Map();

  /**
   * Lane-based frames (main/function_call) use LOCALS.usedHeight as the vertical cursor.
   * When we render children inside non-lane containers (loops/iterations), we still must advance the
   * owning frame cursor, otherwise subsequent siblings can be placed "above" existing content.
   */
  private static bumpFrameLocalsCursorToInclude(
    frame: LayoutElement,
    childBottomY: number,
  ): void {
    const localsLane = this.getLane(frame, "LOCALS");
    const localsTopY = frame.y + localsLane.startY;
    const requiredUsedHeight = Math.max(
      0,
      childBottomY - localsTopY + ELEMENT_SPACING,
    );

    if (requiredUsedHeight > localsLane.usedHeight) {
      localsLane.usedHeight = requiredUsedHeight;
    }
  }

  private static activeLoops: Map<number, {
    loopId: number;
    loopType: 'for' | 'while' | 'do-while';
    startStep: number;
    endStep?: number;
    currentIteration: number;
    totalIterations: number;
    elementId?: string;
    currentIterationElementId?: string; // NEW: For expanded view
    parentFrameId: string;
    baseScopeDepth: number; // NEW: To handle relative nesting
  }> = new Map();

  private static activeConditions: Map<string, {
    conditionId: string;
    conditionType: 'if' | 'if-else' | 'if-else-if' | 'switch';
    startStep: number;
    endStep?: number;
    elementId?: string;
    parentFrameId: string;
    conditionResult?: boolean;
    isConditionStep?: boolean;
    branchTaken?: string;
    expression?: string;
    kind?: string;
  }> = new Map();

  // ============================================
  // LANE MANAGEMENT
  // ============================================
  private static getFrameHeaderHeight(frame: LayoutElement): number {
    switch (frame.type) {
      case 'main':
      case 'function':
        return 40; // StackFrame header height
      case 'function_call':
        return 55; // FunctionElement header height
      default:
        return HEADER_HEIGHT;
    }
  }

  private static getBodyOffsetY(element: LayoutElement): number {
    switch (element.type) {
      case 'main':
      case 'function':
        return 40;
      case 'function_call':
        return 55;
      case 'loop':
        return element.subtype === 'iteration' ? 25 : 80;
      case 'condition':
        if (element.subtype === "group" && element.data?.controlRole === "group") {
          return 0;
        }
        if (
          element.subtype === "group" ||
          element.subtype === "if" ||
          element.subtype === "else_if" ||
          element.subtype === "else" ||
          element.subtype === "switch" ||
          element.subtype === "case" ||
          element.subtype === "default"
        ) {
          return CONTROL_HEADER_HEIGHT + 10;
        }
        return 85;
      case 'struct':
      case 'class':
        return 30;
      default:
        return HEADER_HEIGHT;
    }
  }

  private static getLane(frame: LayoutElement, laneName: string): LaneState {
    if (!frame.metadata) frame.metadata = {};
    if (!frame.metadata.lanes) {
      const headerHeight = this.getFrameHeaderHeight(frame);
      // Initialize lanes if they don't exist
      frame.metadata.lanes = {
        HEADER: { startY: 0, usedHeight: headerHeight },
        PARAMS: { startY: headerHeight, usedHeight: 0 },
        LOCALS: { startY: headerHeight, usedHeight: 0 },
        RETURN: { startY: headerHeight, usedHeight: 0 },
        EXPLANATION: { startY: 0, usedHeight: 0, }
      };
    }
    
    // Auto-adjust startY based on previous lanes
    const lanes = frame.metadata.lanes;
    if (laneName === 'LOCALS') {
        lanes.LOCALS.startY = lanes.HEADER.usedHeight + lanes.PARAMS.usedHeight;
    } else if (laneName === 'RETURN') {
        lanes.RETURN.startY = lanes.HEADER.usedHeight + lanes.PARAMS.usedHeight + lanes.LOCALS.usedHeight;
    }

    if (!lanes[laneName]) {
        lanes[laneName] = { startY: 0, usedHeight: 0 };
    }
    return lanes[laneName];
  }

  /**
   * Get the active loop for a given frame (if any)
   * Used to check if we're currently inside a loop
   */
  private static getActiveLoopForFrame(frameId: string) {
    let match: any = null;
    for (const loop of this.activeLoops.values()) {
      if (loop.parentFrameId === frameId) {
        match = loop;
      }
    }
    return match;
  }


  private static getScopeDepth(step: ExecutionStep, frameId?: string): number {
    const rawDepth = Number(
      (step as any).scopeDepth ??
        (step as any).blockDepth ??
        (frameId ? this.currentScopeDepth.get(frameId) : undefined) ??
        0,
    );
    if (!Number.isFinite(rawDepth)) return 0;
    return Math.max(0, Math.floor(rawDepth));
  }

  private static getFrameScopeDepthSnapshot(frameId: string): number {
    const rawDepth = Number(this.currentScopeDepth.get(frameId) ?? 0);
    if (!Number.isFinite(rawDepth)) return 0;
    return Math.max(0, Math.floor(rawDepth));
  }

  private static isReturnExpressionFlowStep(
    executionTrace: ExecutionTrace,
    stepIndex: number,
    frameId: string,
    stepLine: number,
    stepType: string,
  ): boolean {
    const normalizedType = String(stepType || "").toLowerCase();
    if (
      normalizedType !== "var_load" &&
      normalizedType !== "var_assign" &&
      normalizedType !== "func_enter"
    ) {
      return false;
    }
    if (!Number.isFinite(stepLine) || stepLine <= 0) return false;

    const maxForwardSameFrameSteps = 6;
    let sameFrameSeen = 0;

    for (let i = stepIndex + 1; i < executionTrace.steps.length; i++) {
      const candidate = executionTrace.steps[i] as any;
      if (String(candidate?.frameId ?? "") !== String(frameId)) continue;
      sameFrameSeen += 1;
      if (sameFrameSeen > maxForwardSameFrameSteps) break;

      const candidateLine = Number(candidate?.line ?? -1);
      if (
        Number.isFinite(candidateLine) &&
        candidateLine > 0 &&
        candidateLine !== stepLine
      ) {
        break;
      }

      const candidateType = String(
        candidate?.eventType || candidate?.type || "",
      ).toLowerCase();
      if (candidateType === "return") {
        return true;
      }
    }

    return false;
  }

  private static resolvePlacementScopeDepth(
    executionTrace: ExecutionTrace,
    stepIndex: number,
    frameId: string,
    stepLine: number,
    stepType: string,
    stepScopeDepth: number,
  ): number {
    if (
      !this.isReturnExpressionFlowStep(
        executionTrace,
        stepIndex,
        frameId,
        stepLine,
        stepType,
      )
    ) {
      return stepScopeDepth;
    }
    return Math.max(stepScopeDepth, this.getFrameScopeDepthSnapshot(frameId));
  }

  private static resolveCallSiteScopeDepth(
    executionTrace: ExecutionTrace,
    stepIndex: number,
    parentFrameId: string,
    prevStep: ExecutionStep | null,
    callLine: number,
  ): number {
    const prevDepth = prevStep ? this.getScopeDepth(prevStep, parentFrameId) : 0;
    const frameDepth = this.getFrameScopeDepthSnapshot(parentFrameId);
    const baseDepth = Math.max(prevDepth, frameDepth);

    if (
      !this.isReturnExpressionFlowStep(
        executionTrace,
        stepIndex,
        parentFrameId,
        callLine,
        "func_enter",
      )
    ) {
      return baseDepth;
    }
    return Math.max(baseDepth, frameDepth);
  }

  private static getFrameControlDepthMap(frameId: string): Map<number, string> {
    if (!this.activeControlByDepth.has(frameId)) {
      this.activeControlByDepth.set(frameId, new Map());
    }
    return this.activeControlByDepth.get(frameId)!;
  }

  private static getActiveControlParent(frameId: string, scopeDepth: number): LayoutElement | null {
    const depthMap = this.getFrameControlDepthMap(frameId);
    
    // Find the nearest living container at or above current depth
    let bestDepth = -1;
    for (const d of depthMap.keys()) {
      if (d <= scopeDepth && d > bestDepth) {
        bestDepth = d;
      }
    }
    
    if (bestDepth !== -1) {
      const elementId = depthMap.get(bestDepth);
      if (elementId) return this.elementHistory.get(elementId) || null;
    }
    return null;
  }

  private static getLoopContainerParent(frameId: string): LayoutElement | null {
    const activeLoop = this.getActiveLoopForFrame(frameId);
    if (activeLoop) {
      if (activeLoop.currentIterationElementId) {
        return this.elementHistory.get(activeLoop.currentIterationElementId) || null;
      }
      if (activeLoop.elementId) {
        return this.elementHistory.get(activeLoop.elementId) || null;
      }
    }
    return null;
  }

  private static getFrameEphemeralControlDepthMap(
    frameId: string,
  ): Map<number, { elementId: string; usedAtStep?: number; statementLine?: number }> {
    if (!this.ephemeralControlByDepth.has(frameId)) {
      this.ephemeralControlByDepth.set(frameId, new Map());
    }
    return this.ephemeralControlByDepth.get(frameId)!;
  }

  private static pruneControlDepthForScope(frameId: string, scopeDepth: number): string[] {
    const depthMap = this.getFrameControlDepthMap(frameId);
    const removed: string[] = [];

    // Collect keys first to avoid modification during iteration
    // Corrected logic: only remove if currentScopeDepth actually FINISHED that depth.
    // Meaning the currentScopeDepth is now LESS than the depth of the control.
    const depthsToRemove = Array.from(depthMap.keys()).filter(d => d > scopeDepth);
    
    depthsToRemove.forEach((depth) => {
      const elementId = depthMap.get(depth);
      if (elementId) {
        removed.push(elementId);
        depthMap.delete(depth);
      }
    });

    const ephemeralMap = this.ephemeralControlByDepth.get(frameId);
    if (ephemeralMap) {
      const ephemeralDepthsToRemove = Array.from(ephemeralMap.keys()).filter(d => d > scopeDepth);
      ephemeralDepthsToRemove.forEach((depth) => {
        ephemeralMap.delete(depth);
      });
    }

    if (removed.length > 0) {
      console.log(`[PLACEMENT_DEBUG] Pruned controls for scopeDepth: ${scopeDepth} in frame: ${frameId}. Removed:`, removed);
    }

    return removed;
  }

  private static setActiveControlForDepth(
    frameId: string,
    scopeDepth: number,
    elementId?: string,
  ): void {
    const depthMap = this.getFrameControlDepthMap(frameId);
    
    // Safety: whenever we set or clear a control at depth D, 
    // any existing controls at depth D+1, D+2 etc are now orphans.
    for (const d of Array.from(depthMap.keys())) {
      if (d > scopeDepth) depthMap.delete(d);
    }
    const ephemeralMap = this.ephemeralControlByDepth.get(frameId);
    if (ephemeralMap) {
      for (const d of Array.from(ephemeralMap.keys())) {
        if (d > scopeDepth) ephemeralMap.delete(d);
      }
    }

    if (!elementId) {
      depthMap.delete(scopeDepth);
      ephemeralMap?.delete(scopeDepth);
      return;
    }
    depthMap.set(scopeDepth, elementId);
  }

  private static setEphemeralControlForDepth(
    frameId: string,
    scopeDepth: number,
    elementId: string,
    statementLine?: number,
  ): void {
    const map = this.getFrameEphemeralControlDepthMap(frameId);
    map.set(scopeDepth, {
      elementId,
      statementLine:
        Number.isFinite(Number(statementLine)) && Number(statementLine) > 0
          ? Number(statementLine)
          : undefined,
    });
  }

  private static markEphemeralControlUsed(
    frameId: string,
    scopeDepth: number,
    parentId: string,
    stepIndex: number,
    stepLine?: number,
  ): void {
    const map = this.ephemeralControlByDepth.get(frameId);
    if (!map) return;

    const entry = map.get(scopeDepth);
    if (!entry) return;
    if (entry.elementId !== parentId) return;
    if (typeof entry.usedAtStep === "number") return;

    entry.usedAtStep = stepIndex;
    if (
      entry.statementLine === undefined &&
      Number.isFinite(Number(stepLine)) &&
      Number(stepLine) > 0
    ) {
      entry.statementLine = Number(stepLine);
    }
  }

  private static pruneEphemeralControls(
    frameId: string,
    stepIndex: number,
    stepLine?: number,
  ): string[] {
    const map = this.ephemeralControlByDepth.get(frameId);
    if (!map || map.size === 0) return [];

    const removed: string[] = [];
    map.forEach((entry, depth) => {
      if (typeof entry.usedAtStep !== "number") return;
      if (stepIndex <= entry.usedAtStep) return;
      if (
        Number.isFinite(Number(stepLine)) &&
        Number(stepLine) > 0 &&
        Number.isFinite(Number(entry.statementLine)) &&
        Number(entry.statementLine) > 0 &&
        Number(stepLine) === Number(entry.statementLine)
      ) {
        return;
      }

      const depthMap = this.getFrameControlDepthMap(frameId);
      if (depthMap.get(depth) === entry.elementId) {
        depthMap.delete(depth);
        removed.push(entry.elementId);
      }
      map.delete(depth);
    });

    return removed;
  }

  private static resolveControlBodyActivation(
    step: ExecutionStep,
    scopeDepth: number,
  ): { activationDepth: number; ephemeral: boolean } {
    const activationDepth = this.resolveBranchActivationDepth(step, scopeDepth);
    const isDepthTagged = this.hasExplicitScopeDepth(step);
    return { activationDepth, ephemeral: !isDepthTagged };
  }


  private static resolvePlacementParent(
    ownerFrame: LayoutElement,
    frameId: string,
    scopeDepth: number,
    step?: any,
  ): LayoutElement {
    const debugType = step ? String((step as any).eventType || (step as any).type || '?') : '?';
    const debugKey = step?.stepKey ?? 'none';
    const debugParentKey = step?.placementParentKey ?? 'none';

    // Layer 1 — StepKey: direct lookup via placementParentKey
    if (step?.placementParentKey) {
      const body = this.bodyByStepKey.get(step.placementParentKey);
      if (body) {
        console.log('[PLACEMENT] Layer1-StepKey', debugType, debugKey, '→ parent:', debugParentKey, 'bodyId:', body.id);
        return body;
      }
    }

    // Layer 1.1 — ConditionId: lookup via conditionId
    if (step?.conditionId) {
      const conditionContainer = this.containerByConditionId.get(String(step.conditionId));
      if (conditionContainer) {
        console.log('[PLACEMENT] Layer1.1-ConditionId', debugType, debugKey, '→ parentId:', conditionContainer.id);
        return conditionContainer;
      }
    }

    // Layer 2 — ConditionTree: lookup via conditionId
    let Layer2Result: LayoutElement | null = null;
    if (step?.conditionId && this.conditionTree) {
      const node = this.conditionTree.nodes.get(String(step.conditionId));
      if (node?.takenBranchStepKey) {
        Layer2Result = this.bodyByStepKey.get(node.takenBranchStepKey) || null;
      }

      // If we didn't find a direct container for THIS condition, check if its parent in the tree has a container.
      // This is crucial for condition_eval steps which are siblings of the condition body.
      if (!Layer2Result && node?.parentConditionId) {
        const parentContainer = this.containerByConditionId.get(String(node.parentConditionId));
        if (parentContainer) {
          console.log('[PLACEMENT] Layer2-Tree-Parent', debugType, debugKey, '→ parentId:', parentContainer.id);
          return parentContainer;
        }
      }
    }

    // Layer 2.5: Loop ID Resolution (Explicit loopId mapping)
    const loopId = step && (step as any).loopId;
    if (loopId !== undefined) {
      const loop = this.activeLoops.get(loopId);
      if (loop) {
        if (loop.currentIterationElementId) {
          const iterEl = this.elementHistory.get(loop.currentIterationElementId);
          if (iterEl) return iterEl;
        }
        if (loop.elementId) {
          const loopEl = this.elementHistory.get(loop.elementId);
          if (loopEl) return loopEl;
        }
      }
    }

    if (Layer2Result) {
      console.log(`[PLACEMENT] Frame: ${frameId} -> Layer2-Tree ${debugType} ${debugKey} conditionId: ${step.conditionId} → bodyId: ${Layer2Result.id}`);
      return Layer2Result;
    }

    // Layer 3: Persistent Scope Mapping (Fallback)
    const Layer3Result = this.getActiveControlParent(frameId, scopeDepth);
    if (Layer3Result) {
      console.log(`[PLACEMENT] Frame: ${frameId} -> Layer3-Depth ${debugType} ${debugKey} → bodyId: ${Layer3Result.id} (scopeDepth: ${scopeDepth})`);
      return Layer3Result;
    }

    const loopParent = this.getLoopContainerParent(frameId);
    if (loopParent) return loopParent;

    console.log(`[PLACEMENT] Frame: ${frameId} -> Layer3-Frame fallback ${debugType} ${debugKey} → ownerFrame: ${ownerFrame.id}`);
    return ownerFrame;
  }

  private static getPlacementContext(
    ownerFrame: LayoutElement,
    frameId: string,
    scopeDepth: number,
    step?: any,
  ): {
    parent: LayoutElement;
    x: number;
    y: number;
    width: number;
    isFrameParent: boolean;
    lane?: LaneState;
  } {
    const parent = this.resolvePlacementParent(ownerFrame, frameId, scopeDepth, step);
    const isFrameParent = parent.id === ownerFrame.id;
    const indent = getIndentSize(ownerFrame);

    if (isFrameParent) {
      const lane = this.getLane(ownerFrame, "LOCALS");
      return {
        parent,
        x: ownerFrame.x + indent,
        y: ownerFrame.y + lane.startY + lane.usedHeight,
        width: ownerFrame.width - indent * 2,
        isFrameParent: true,
        lane,
      };
    }

    return {
      parent,
      x: parent.x + 20,
      y: this.getNextCursorY(parent),
      width: Math.max(220, parent.width - 40),
      isFrameParent: false,
    };
  }

  private static appendElementToPlacement(
    ownerFrame: LayoutElement,
    placement: {
      parent: LayoutElement;
      isFrameParent: boolean;
      lane?: LaneState;
    },
    element: LayoutElement,
    reserveSpace: boolean = true,
  ): void {
    if (!placement.parent.children) {
      placement.parent.children = [];
    }

    placement.parent.children.push(element);
    
    if (!reserveSpace) return;

    if (placement.isFrameParent && placement.lane) {
      placement.lane.usedHeight += element.height + ELEMENT_SPACING;
      // Also advance the shared ownerFrame cursor if this is an in-flow node
      if (!this.isRightFlowControlNode(element)) {
         this.bumpFrameLocalsCursorToInclude(ownerFrame, element.y + element.height);
      }
      return;
    }

    // Keep right-flow control subtree growth isolated from frame flow.
    // If the parent is a right-flow node, its children (and sub-children)
    // should not affect the ownerFrame's main vertical cursor.
    if (this.isRightFlowControlNode(placement.parent)) {
      return;
    }

    if (!this.isRightFlowControlNode(element)) {
        this.bumpFrameLocalsCursorToInclude(
          ownerFrame,
          element.y + element.height,
        );
    }
  }

  private static pushControlArrow(
    id: string,
    stepIndex: number,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    options?: {
      kind?: "caller_to_condition" | "condition_to_body" | "loop_to_body" | "return_flow" | "case_fallthrough";
      dashed?: boolean;
      opacity?: number;
      strokeWidth?: number;
      animated?: boolean;
      pointerLength?: number;
      pointerWidth?: number;
      curveOffset?: number;
      c1x?: number;
      c1y?: number;
      c2x?: number;
      c2y?: number;
      sourceNodeId?: string;
      targetNodeId?: string;
    },
  ): void {
    const direction = toX >= fromX ? 1 : -1;
    const curveOffset = options?.curveOffset ?? CONTROL_CURVE_OFFSET;

    this.controlArrows.push({
      id,
      type: "array_reference",
      subtype: "control_arrow",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      stepId: stepIndex,
      data: {
        fromX,
        fromY,
        toX,
        toY,
        c1x: options?.c1x ?? fromX + curveOffset * direction,
        c1y: options?.c1y ?? fromY,
        c2x: options?.c2x ?? toX - curveOffset * direction,
        c2y: options?.c2y ?? toY,
        arrowKind: options?.kind || "caller_to_condition",
        dashed: Boolean(options?.dashed),
        opacity: options?.opacity,
        strokeWidth: options?.strokeWidth,
        animated: options?.animated,
        pointerLength: options?.pointerLength,
        pointerWidth: options?.pointerWidth,
        sourceNodeId: options?.sourceNodeId,
        targetNodeId: options?.targetNodeId,
      },
    });
  }

  private static getFrameOccupancy(frameId: string) {
    if (!this.rightFlowOccupancy.has(frameId)) {
      this.rightFlowOccupancy.set(frameId, []);
    }
    return this.rightFlowOccupancy.get(frameId)!;
  }

  private static resolveRightFlowRect(
    frameId: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): { x: number; y: number; width: number; height: number } {
    const occupancy = this.getFrameOccupancy(frameId);
    const rect = { x, y, width, height };
    const overlaps = (a: typeof rect, b: typeof rect) =>
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y;

    // Change: Shift Y instead of X for vertical stacking of "outside" elements
    while (occupancy.some((entry) => overlaps(rect, entry))) {
      rect.y += (height + CONTROL_CHAIN_VERTICAL_GAP);
    }

    occupancy.push({ ...rect });
    return rect;
  }

  private static findLastRenderableChild(parent: LayoutElement): LayoutElement | null {
    if (!parent.children || parent.children.length === 0) return null;

    const candidates = parent.children.filter(
      (child) => !this.shouldIgnoreChildForParentFlow(parent, child),
    );
    if (candidates.length === 0) return null;

    const sorted = [...candidates].sort((a, b) => {
      const aStep = this.getElementStep(a) ?? -1;
      const bStep = this.getElementStep(b) ?? -1;
      if (aStep !== bStep) return bStep - aStep;
      return String(a.id).localeCompare(String(b.id));
    });

    return sorted[0] || null;
  }

  private static getNextCursorY(parent: LayoutElement): number {
    const lastChild = this.findLastRenderableChild(parent);
    return lastChild
      ? lastChild.y + lastChild.height + ELEMENT_SPACING
      : parent.y + this.getBodyOffsetY(parent);
  }

  // NEW METHOD: Sort children by stepId
  private static sortChildrenByStep(children: LayoutElement[]): void {
    children.sort((a, b) => {
      const aStep = a.stepId ?? a.data?.birthStep ?? 0;
      const bStep = b.stepId ?? b.data?.birthStep ?? 0;
      if (aStep !== bStep) return aStep - bStep;
      return String(a.id).localeCompare(String(b.id));
    });
  }

  private static getElementStep(element: LayoutElement): number | undefined {
    if (typeof element.data?.birthStep === "number") {
      return element.data.birthStep;
    }
    if (typeof element.stepId === "number") {
      return element.stepId;
    }
    return undefined;
  }

  private static isEmptyValue(value: any): boolean {
    return value === undefined || value === null || value === "";
  }

  private static isImmediateDeclarationInitialization(
    executionTrace: ExecutionTrace,
    stepIndex: number,
    frameId: string,
    variableName: string,
  ): boolean {
    const nextStep = executionTrace.steps[stepIndex + 1] as any;
    if (!nextStep) return false;

    const nextType = (nextStep.eventType || nextStep.type || "").toLowerCase();
    if (nextType !== "var_assign" && nextType !== "var_load") return false;

    const nextName = nextStep.name || nextStep.symbol;
    if (nextName !== variableName) return false;

    return (nextStep.frameId || "") === frameId;
  }

  private static findDeclarationOnlyDuplicateIds(
    children: LayoutElement[],
  ): Set<string> {
    const idsToRemove = new Set<string>();
    const varGroups = new Map<string, LayoutElement[]>();

    children.forEach((child) => {
      if (child.type === "variable" && child.data?.name) {
        const name = child.data.name as string;
        if (!varGroups.has(name)) {
          varGroups.set(name, []);
        }
        varGroups.get(name)!.push(child);
      }
    });

    varGroups.forEach((vars) => {
      if (vars.length < 2) return;

      vars.sort((a, b) => {
        const aStep = this.getElementStep(a);
        const bStep = this.getElementStep(b);
        if (aStep === undefined && bStep === undefined) return 0;
        if (aStep === undefined) return 1;
        if (bStep === undefined) return -1;
        return aStep - bStep;
      });

      for (let i = 0; i < vars.length - 1; i++) {
        const current = vars[i];
        const next = vars[i + 1];
        const currentStep = this.getElementStep(current);
        const nextStep = this.getElementStep(next);

        if (
          !this.isEmptyValue(current.data?.value) ||
          this.isEmptyValue(next.data?.value) ||
          currentStep === undefined ||
          nextStep === undefined
        ) {
          continue;
        }

        if (nextStep - currentStep <= 1) {
          idsToRemove.add(current.id);
        }
      }
    });

    return idsToRemove;
  }

  private static pruneDeclarationOnlyDuplicates(layout: Layout): void {
    const removedIds = new Set<string>();
    const visited = new Set<string>();

    const pruneTree = (element?: LayoutElement | null) => {
      if (!element || visited.has(element.id)) return;
      visited.add(element.id);

      if (!element.children || element.children.length === 0) return;

      element.children.forEach((child) => pruneTree(child));

      const idsToRemove = this.findDeclarationOnlyDuplicateIds(element.children);
      if (idsToRemove.size === 0) return;

      element.children = element.children.filter((child) => {
        if (!idsToRemove.has(child.id)) {
          return true;
        }
        removedIds.add(child.id);
        return false;
      });
    };

    pruneTree(layout.mainFunction);
    pruneTree(layout.globalPanel);
    if (layout.arrayPanel) {
      pruneTree(layout.arrayPanel);
    }
    layout.elements.forEach((element) => pruneTree(element));

    if (removedIds.size === 0) return;

    layout.elements = layout.elements.filter((element) => !removedIds.has(element.id));
    removedIds.forEach((id) => {
      this.elementHistory.delete(id);
      this.createdInStep.delete(id);
    });
  }

  // NEW METHOD: Extract parameters from trace
  private static extractParameters(
    executionTrace: ExecutionTrace,
    frameId: string,
    startIndex: number
  ): Array<{name: string; type: string; value?: any}> {
    const parameters: Array<{name: string; type: string; value?: any}> = [];
    
    for (let i = startIndex + 1; i < Math.min(startIndex + 10, executionTrace.steps.length); i++) {
      const step = executionTrace.steps[i] as any;
      if (step.frameId !== frameId) break;
      
      if (step.eventType === 'var_declare') {
        const paramName = step.name || step.symbol;
        const paramType = step.varType || 'int';
        
        const valueStep = i + 1 < executionTrace.steps.length ? 
                         executionTrace.steps[i + 1] as any : null;
        const paramValue = (valueStep?.eventType === 'var_assign' && 
                           valueStep?.name === paramName) ? 
                           valueStep.value : undefined;
        
        parameters.push({
          name: paramName,
          type: paramType,
          value: paramValue
        });
      }
    }
    
    return parameters;
  }

  // NEW METHOD: Get return value from trace
  private static getReturnValue(
    executionTrace: ExecutionTrace,
    frameId: string,
    stepIndex: number
  ): any {
    const step = executionTrace.steps[stepIndex] as any;
    // Prefer the return event's own value (populated by __trace_return)
    if (step.returnValue !== undefined && step.returnValue !== null) {
      return step.returnValue;
    }
    if (step.value !== undefined && step.value !== null) {
      return step.value;
    }
    // Fallback: scan backward for any var_assign in this frame
    for (let i = stepIndex - 1; i >= Math.max(0, stepIndex - 20); i--) {
      const prev = executionTrace.steps[i] as any;
      if ((prev.frameId || '') !== frameId) break;
      if (prev.eventType === 'return') {
        return prev.returnValue ?? prev.value;
      }
      if (prev.eventType === 'var_assign') {
        return prev.value;
      }
    }
    return undefined;
  }

  private static appendReturnElement(
    layout: Layout,
    funcFrame: LayoutElement,
    frameId: string,
    stepIndex: number,
    functionName: string,
    returnValue: any,
    scopeDepth: number,
    step?: any,
    stepLine?: number,
  ): void {
    const hasRecentReturn = (funcFrame.children || []).some((child) => {
      if (child.type !== "function_return") return false;
      if (typeof child.stepId !== "number") return false;
      return child.stepId === stepIndex || child.stepId === stepIndex - 1;
    });
    if (hasRecentReturn) return;

    if (funcFrame && funcFrame.data) {
      if (typeof funcFrame.data.isReturning !== "undefined") {
        funcFrame.data.isReturning = true;
      }
    }

    const placement = this.getPlacementContext(funcFrame, frameId, scopeDepth, step);

    const returnElement: LayoutElement = {
      id: `return-${frameId}-${stepIndex}`,
      type: "function_return",
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: 70,
      stepId: stepIndex,
      parentId: placement.parent.id,
      data: {
        frameId,
        functionName,
        returnValue: returnValue ?? null,
        explanation: `return ${returnValue ?? "void"}`,
        birthStep: stepIndex,
      },
      metadata: {
        suppressLayoutSpacing: true
      },
    };

    this.appendElementToPlacement(funcFrame, placement, returnElement);
    this.markEphemeralControlUsed(
      frameId,
      scopeDepth,
      placement.parent.id,
      stepIndex,
      stepLine,
    );

    layout.elements.push(returnElement);
    this.elementHistory.set(returnElement.id, returnElement);
  }

  private static isControlEvaluationStep(stepType: string, step: ExecutionStep): boolean {
    if (stepType === "condition_eval" || stepType === "condition" || stepType === "else_eval") return true;
    if (stepType === "conditional_start" && (step as any).conditionType === "switch") {
      return true;
    }
    return false;
  }

  private static isControlBranchStep(stepType: string): boolean {
    return (
      stepType === "branch_taken" ||
      stepType === "branch" ||
      stepType === "conditional_branch"
    );
  }

  private static resolveIfGroupId(
    frameId: string,
    scopeDepth: number,
    stepIndex: number,
    line: number,
  ): string {
    const { toggleMode } = useLoopStore.getState();
    const currentLoop = this.getActiveLoopForFrame(frameId);

    if (!toggleMode && currentLoop) {
      // Use stable ID for Update Mode to ensure container reuse across iterations
      return `if-group-${frameId}-loop-${currentLoop.loopId}-line-${line}`;
    }

    const recent = this.recentIfGroupByFrame.get(frameId);
    const hasActiveParent = Boolean(
      this.getActiveControlParent(frameId, scopeDepth),
    );

    if (
      recent &&
      stepIndex - recent.stepIndex <= 20 &&
      scopeDepth === recent.scopeDepth &&
      !hasActiveParent &&
      this.activeControlGroups.has(recent.groupId)
    ) {
      this.recentIfGroupByFrame.set(frameId, {
        ...recent,
        stepIndex,
        line,
        scopeDepth,
      });
      return recent.groupId;
    }

    const groupId = `if-group-${frameId}-${stepIndex}`;
    this.recentIfGroupByFrame.set(frameId, {
      groupId,
      stepIndex,
      line,
      scopeDepth,
      
    });
    return groupId;
  }

  private static normalizeBranchLabel(label: string | undefined): string {
    const raw = String(label || "").trim().toLowerCase();
    if (raw === "else-if" || raw === "elseif") return "else_if";
    if (raw === "if") return "if";
    if (raw === "else") return "else";
    if (raw === "default") return "default";
    if (raw === "case") return "case";
    return raw;
  }

  private static resolveSwitchExpression(groupState: ControlGroupState): string {
    if (groupState.switchExpression) return groupState.switchExpression;

    for (let i = groupState.members.length - 1; i >= 0; i--) {
      const el = this.elementHistory.get(groupState.members[i]);
      if (!el) continue;
      if (el.data?.controlKind !== "switch") continue;
      const expr = String(el.data?.expression || el.data?.condition || "");
      if (expr) {
        groupState.switchExpression = expr;
        return expr;
      }
    }

    return "";
  }

  private static formatSwitchCaseExpression(
    groupState: ControlGroupState,
    label: string,
  ): string {
    const trimmed = String(label || "").trim();
    if (trimmed.toLowerCase() === "default") return "default";

    const switchExpr = this.resolveSwitchExpression(groupState);
    if (!switchExpr) return trimmed;

    if (
      trimmed.includes("==") ||
      trimmed.includes("!=") ||
      trimmed.includes("<") ||
      trimmed.includes(">")
    ) {
      return trimmed;
    }

    return `${switchExpr} == ${trimmed}`;
  }

  private static findSwitchCaseCaller(
    groupState: ControlGroupState,
    label: string,
  ): LayoutElement | null {
    const normalized = String(label || "").trim().toLowerCase();
    for (let i = groupState.members.length - 1; i >= 0; i--) {
      const el = this.elementHistory.get(groupState.members[i]);
      if (!el) continue;
      if (el.data?.controlKind !== "case" && el.data?.controlKind !== "default") {
        continue;
      }
      const candidateRaw = String(el.data?.label ?? el.data?.caseValue ?? "").trim().toLowerCase();
      if (candidateRaw === normalized) {
        return el;
      }
    }
    return null;
  }

  private static maybeLinkSwitchFallthrough(
    groupState: ControlGroupState,
    caseIndex: number,
    stepIndex: number,
  ): void {
    if (!Number.isFinite(caseIndex)) return;
    if (!groupState.switchCaseIds || caseIndex <= 0) return;

    const currentId = groupState.switchCaseIds[caseIndex];
    const prevId = groupState.switchCaseIds[caseIndex - 1];
    if (!currentId || !prevId) return;

    const prevCaller = this.elementHistory.get(prevId);
    const nextCaller = this.elementHistory.get(currentId);
    if (!prevCaller || !nextCaller) return;

    if (!prevCaller.data?.fallsThrough) return;

    const arrowId = `switch-fallthrough-${groupState.groupId}-${prevCaller.id}-${nextCaller.id}`;
    if (this.controlArrows.some((arrow) => arrow.id === arrowId)) {
      return;
    }

    const from = this.getControlConnectorPoint(prevCaller);
    const to = this.getControlConnectorPoint(nextCaller);

    this.pushControlArrow(
      arrowId,
      stepIndex,
      from.x,
      from.y,
      to.x,
      to.y,
      {
        kind: "case_fallthrough",
        dashed: true,
        opacity: 0.7,
        strokeWidth: 1.8,
        animated: false,
        c1x: from.x + 40,
        c1y: from.y + 12,
        c2x: to.x + 40,
        c2y: to.y - 12,
        sourceNodeId: prevCaller.id,
        targetNodeId: nextCaller.id,
      },
    );
  }

  private static getControlParentForDepth(
    ownerFrame: LayoutElement,
    frameId: string,
    scopeDepth: number,
  ): LayoutElement {
    const controlParent = this.getActiveControlParent(frameId, scopeDepth);
    if (controlParent) return controlParent;

    const loopParent = this.getLoopContainerParent(frameId);
    if (loopParent) return loopParent;

    return ownerFrame;
  }

  private static hasExplicitScopeDepth(step: ExecutionStep): boolean {
    const rawDepth = (step as any).scopeDepth ?? (step as any).blockDepth;
    return Number.isFinite(Number(rawDepth));
  }

  private static resolveBranchActivationDepth(
    step: ExecutionStep,
    scopeDepth: number,
  ): number {
    // 🔧 FIX: Bodies should be at depth scopeDepth.
    // TraceProcessor already increments depth on block_enter.
    // Adding +1 here causes an off-by-one error where containers are pruned too early.
    return scopeDepth;
  }

  private static resolveIfGroupForBranch(
    frameId: string,
    conditionId: string | undefined,
  ): ControlGroupState | undefined {
    if (!conditionId) {
      const recent = this.recentIfGroupByFrame.get(frameId);
      return recent ? this.activeControlGroups.get(recent.groupId) : undefined;
    }

    let selected: ControlGroupState | undefined;
    this.activeControlGroups.forEach((groupState) => {
      if (groupState.frameId !== frameId) return;
      if (groupState.controlType !== "if_chain") return;

      const matches = groupState.members.some((memberId) => {
        const member = this.elementHistory.get(memberId);
        if (!member) return false;
        return String(member.data?.conditionId ?? "") === conditionId;
      });
      if (!matches) return;

      if (!selected || groupState.lastStep > selected.lastStep) {
        selected = groupState;
      }
    });

    if (selected) return selected;

    const recent = this.recentIfGroupByFrame.get(frameId);
    return recent ? this.activeControlGroups.get(recent.groupId) : undefined;
  }

  private static resolveCallerOriginElement(
    step: ExecutionStep,
    ownerFrame: LayoutElement,
    frameId: string,
    scopeDepth: number,
  ): LayoutElement {
    const explicitId = String((step as any).triggerElementId || "");
    if (explicitId) {
      const found = this.elementHistory.get(explicitId);
      if (found) return found;
    }

    const parent = this.getControlParentForDepth(ownerFrame, frameId, scopeDepth);
    const last = this.findLastRenderableChild(parent);
    if (last) return last;

    return ownerFrame;
  }

  private static getControlConnectorPoint(element: LayoutElement): { x: number; y: number } {
    if (element.type === "condition" && element.data?.controlKind) {
      return {
        x: element.x + element.width + 6,
        y: element.y + CONTROL_HEADER_HEIGHT / 2,
      };
    }

    if (element.type === "main" || element.type === "function_call") {
      const headerHeight = this.getFrameHeaderHeight(element);
      return {
        x: element.x + element.width + 6,
        y: element.y + headerHeight / 2,
      };
    }

    return {
      x: element.x + element.width + 6,
      y: element.y + element.height / 2,
    };
  }

  private static maybeCreateBranchReturnFlow(
    executionTrace: ExecutionTrace,
    frameId: string,
    stepType: string,
    stepIndex: number,
    exitedControlIds: string[],
  ): void {
    return;
  }

  private static resolveControlContainerPlacement(
    ownerFrame: LayoutElement,
    parent: LayoutElement,
    frameId: string,
  ): {
    x: number;
    y: number;
    width: number;
    triggerElementId: string;
    triggerStepId?: number;
  } {
    const width =
      parent.id === ownerFrame.id
        ? Math.max(240, Math.min(CONTROL_BASE_WIDTH, ownerFrame.width - 80))
        : Math.max(240, Math.min(CONTROL_BASE_WIDTH, parent.width - 40));

    let trigger: LayoutElement | undefined;
    if (parent.data?.controlRole === "body") {
      const callerId = String(parent.data?.callerId || "");
      trigger = callerId ? this.elementHistory.get(callerId) : undefined;
    }
    if (!trigger) {
      trigger = this.findLastRenderableChild(parent) || parent;
    }

    const baseX = trigger.x + trigger.width + CONTROL_HORIZONTAL_GAP;
    const baseY = trigger.y + trigger.height / 2 - CONTROL_CALLER_HEIGHT / 2;
    const rect = this.resolveRightFlowRect(
      frameId,
      baseX,
      baseY,
      width,
      CONTROL_CALLER_HEIGHT,
    );

    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      triggerElementId: trigger.id,
      triggerStepId: this.getElementStep(trigger),
    };
  }

  private static getNextControlGroupY(container: LayoutElement): number {
    if (!container.children || container.children.length === 0) {
      return container.y;
    }

    let maxBottom = container.y;
    container.children.forEach((child) => {
      maxBottom = Math.max(maxBottom, this.getEffectiveBottom(child));
    });
    return maxBottom + CONTROL_CHAIN_VERTICAL_GAP;
  }

  private static syncControlGroupHeight(container: LayoutElement): void {
    if (!container.children || container.children.length === 0) {
      container.height = Math.max(container.height, CONTROL_CALLER_HEIGHT);
      return;
    }

    let maxBottom = container.y;
    container.children.forEach((child) => {
      maxBottom = Math.max(maxBottom, this.getEffectiveBottom(child));
    });
    container.height = Math.max(
      CONTROL_CALLER_HEIGHT,
      maxBottom - container.y + ELEMENT_SPACING,
    );
  }

  private static appendControlCaller(
    layout: Layout,
    groupState: ControlGroupState,
    container: LayoutElement,
    kind: Exclude<ControlKind, "group">,
    step: ExecutionStep,
    stepIndex: number,
    expression: string,
    conditionResult: boolean | undefined,
    branchTaken: string | undefined,
    line: number,
    branchState: BranchState,
    isActive: boolean,
    triggerElementId?: string,
  ): LayoutElement {
    const { toggleMode } = useLoopStore.getState();
    const currentLoop = this.getActiveLoopForFrame(groupState.frameId);
    
    // UPDATE MODE REUSE: Reuse existing caller if in a loop with Toggle OFF
    if (!toggleMode && currentLoop) {
       const existing = this.findGroupMemberByKind(groupState, kind, expression);
       if (existing) {
         existing.data.isActive = isActive;
         existing.data.branchState = branchState;
         existing.data.conditionResult = conditionResult;
         existing.stepId = stepIndex;
         
         // Update trigger info for the arrow
         existing.data.triggerStepId = stepIndex;
         
         return existing;
       }
    }

    const childCount = container.children?.length ?? 0;
    const y =
      childCount === 0
        ? container.y
        : this.getNextControlGroupY(container);

    const callerId = `control-caller-${kind}-${groupState.groupId}-${stepIndex}-${childCount}`;
    const caller: LayoutElement = {
      id: callerId,
      type: "condition",
      subtype: kind,
      x: container.x,
      y,
      width: container.width,
      height: CONTROL_CALLER_HEIGHT,
      parentId: container.id,
      stepId: stepIndex,
      children: [],
      data: {
        conditionId: (step as any).conditionId,
        conditionType:
          kind === "switch" || kind === "case" || kind === "default"
            ? "switch"
            : "if",
        condition: expression,
        expression,
        conditionResult,
        branchTaken,
        controlKind: kind,
        controlRole: "caller",
        controlGroupId: groupState.groupId,
        branchState,
        triggerStepId: stepIndex,
        triggerElementId:
          triggerElementId || container.data?.triggerElementId || container.parentId,
        headerOnly: true,
        isActive,
        birthStep: stepIndex,
        explanation: (step as any).explanation,
        branchLabel: kind === "else_if" ? "else if" : kind,
        isControlNode: true,
      },
    };

    if (!container.children) {
      container.children = [];
    }
    container.children.push(caller);
    groupState.members.push(caller.id);
    groupState.lastStep = stepIndex;
    groupState.lastLine = line;

    this.syncControlGroupHeight(container);
    layout.elements.push(caller);
    this.elementHistory.set(caller.id, caller);
    this.createdInStep.set(caller.id, stepIndex);

    const resolvedTriggerElementId = String(caller.data?.triggerElementId || "");
    const triggerElement = resolvedTriggerElementId
      ? this.elementHistory.get(resolvedTriggerElementId)
      : null;
    if (triggerElement) {
      const from = this.getControlConnectorPoint(triggerElement);
      const toX = caller.x;
      const toY = caller.y + CONTROL_HEADER_HEIGHT / 2;
      this.pushControlArrow(
        `control-arrow-trigger-caller-${caller.id}`,
        stepIndex,
        from.x,
        from.y,
        toX,
        toY,
        {
          kind: "caller_to_condition",
          dashed: false,
          opacity: 0.92,
          strokeWidth: 2.2,
          animated: true,
          c1x: from.x + 60,
          c1y: from.y,
          c2x: toX - 60,
          c2y: toY,
          sourceNodeId: triggerElement.id,
          targetNodeId: caller.id,
        },
      );
    }

    return caller;
  }

  private static createControlBodyForCaller(
    layout: Layout,
    groupState: ControlGroupState,
    container: LayoutElement,
    caller: LayoutElement,
    stepIndex: number,
  ): LayoutElement {
    const existingBodyId = String(caller.data?.bodyId || "");
    if (existingBodyId) {
      const existingBody = this.elementHistory.get(existingBodyId);
      if (existingBody) {
        return existingBody;
      }
    }

    const bodyId = `control-body-${caller.id}`;
    const body: LayoutElement = {
      id: bodyId,
      type: "condition",
      subtype: caller.subtype,
      x: caller.x,
      y: caller.y + CONTROL_HEADER_HEIGHT + 10,
      width: caller.width,
      height: CONTROL_BODY_HEIGHT,
      parentId: caller.id,
      stepId: stepIndex,
      children: [],
      data: {
        ...caller.data,
        controlRole: "body",
        callerId: caller.id,
        headerOnly: false,
        isActive: true,
        branchState: "active" as BranchState,
        isControlNode: true,
      },
    };

    if (!caller.children) {
      caller.children = [];
    }
    caller.children.push(body);

    layout.elements.push(body);
    this.elementHistory.set(body.id, body);
    this.createdInStep.set(body.id, stepIndex);

    caller.data = {
      ...caller.data,
      bodyId: body.id,
      isActive: true,
      branchState: "active" as BranchState,
      headerOnly: true,
    };
    caller.stepId = stepIndex;

    groupState.activeCallerId = caller.id;
    groupState.activeBodyId = body.id;
    this.syncControlGroupHeight(container);
    return body;
  }

  private static createOrGetControlGroupContainer(
    layout: Layout,
    ownerFrame: LayoutElement,
    step: any,
    frameId: string,
    scopeDepth: number,
    stepIndex: number,
    groupId: string,
    controlType: "if_chain" | "switch",
  ): { groupState: ControlGroupState; container: LayoutElement } {
    const existing = this.activeControlGroups.get(groupId);
    if (existing) {
      const container = this.elementHistory.get(existing.containerElementId);
      if (container) {
        return { groupState: existing, container };
      }
    }

    const placement = this.getPlacementContext(ownerFrame, frameId, scopeDepth, step);
    
    const resolvePlacement = this.resolveControlContainerPlacement(
      ownerFrame,
      placement.parent,
      frameId,
    );

    const container: LayoutElement = {
      id: `control-group-${groupId}`,
      type: "condition",
      subtype: "group",
      x: resolvePlacement.x,
      y: resolvePlacement.y,
      width: Math.max(240, Math.min(CONTROL_BASE_WIDTH, resolvePlacement.width)),
      height: CONTROL_CALLER_HEIGHT,
      parentId: ownerFrame.id,
      stepId: stepIndex,
      children: [],
      data: {
        controlKind: "group",
        controlRole: "group",
        controlGroupId: groupId,
        branchState: "active",
        triggerStepId: resolvePlacement.triggerStepId ?? stepIndex,
        triggerElementId: resolvePlacement.triggerElementId,
        isActive: true,
        headerOnly: true,
        isControlNode: true,
      },
    };

    if (!ownerFrame.children) {
      ownerFrame.children = [];
    }
    ownerFrame.children.push(container);

    layout.elements.push(container);
    this.elementHistory.set(container.id, container);
    this.createdInStep.set(container.id, stepIndex);

    const groupState: ControlGroupState = {
      groupId,
      frameId,
      scopeDepth,
      containerElementId: container.id,
      controlType,
      parentControlElementId:
        placement.parent.type === "condition" ? placement.parent.id : undefined,
      parentContainerId: placement.parent.id,
      parentContainerDepth: scopeDepth,
      members: [],
      lastStep: stepIndex,
      lastLine: 0,
    };
    if (controlType === "switch") {
      groupState.switchCaseIds = [];
    }

    this.activeControlGroups.set(groupId, groupState);
    return { groupState, container };
  }

  private static findGroupMemberByConditionId(
    groupState: ControlGroupState,
    conditionId: string | undefined,
  ): LayoutElement | null {
    if (!conditionId) return null;
    for (let i = groupState.members.length - 1; i >= 0; i--) {
      const el = this.elementHistory.get(groupState.members[i]);
      if (!el) continue;
      if (String(el.data?.conditionId ?? "") === String(conditionId)) {
        return el;
      }
    }
    return null;
  }

  private static findGroupMemberByKind(
    groupState: ControlGroupState,
    kind: string,
    expression: string,
  ): LayoutElement | null {
    for (const memberId of groupState.members) {
      const el = this.elementHistory.get(memberId);
      if (el && el.data?.controlKind === kind && el.data?.expression === expression) {
        return el;
      }
    }
    return null;
  }

  private static processControlStep(
    step: ExecutionStep,
    executionTrace: ExecutionTrace,
    layout: Layout,
    stepIndex: number,
    ownerFrame: LayoutElement,
    frameId: string,
  ): boolean {
    const stepType = ((step as any).eventType || (step as any).type || "").toLowerCase();
    const scopeDepth = this.getScopeDepth(step, frameId);
    const line = Number((step as any).line ?? 0);

    if (!this.isControlEvaluationStep(stepType, step) && !this.isControlBranchStep(stepType)) {
      return false;
    }

    if (stepType === "conditional_start" && (step as any).conditionType !== "switch") {
      return true;
    }

    if (stepType === "else_eval") {
      const conditionIdRaw = (step as any).conditionId ?? `${frameId}-cond-${stepIndex - 1}`;
      const conditionId = String(conditionIdRaw);
      const groupState = this.resolveIfGroupForBranch(frameId, conditionId);
      if (!groupState) return true;

      const placement = this.getPlacementContext(ownerFrame, frameId, scopeDepth, step);
      const inFlowElseId = `condition-caller-${groupState.groupId}-${stepIndex}-else`;

      const inFlowElseCaller: LayoutElement = {
        id: inFlowElseId,
        type: "condition_caller",
        x: placement.x,
        y: placement.y,
        width: placement.width - 40,
        height: 50,
        parentId: placement.parent.id,
        stepId: stepIndex,
        data: {
          condition: "else",
          conditionResult: true,
          conditionId: conditionId,
          controlGroupId: groupState.groupId,
          controlKind: "else",
          controlRole: "caller",
          birthStep: stepIndex,
          isActive: true
        }
      };

      this.appendElementToPlacement(ownerFrame, placement, inFlowElseCaller);
      layout.elements.push(inFlowElseCaller);
      this.elementHistory.set(inFlowElseId, inFlowElseCaller);
      this.createdInStep.set(inFlowElseId, stepIndex);
      groupState.members.push(inFlowElseId);

      this.activeConditions.set(conditionId, {
        conditionId,
        conditionType: "if",
        startStep: stepIndex,
        elementId: inFlowElseId,
        parentFrameId: frameId,
        conditionResult: true,
        expression: "else",
        kind: "else"
      });

      return true;
    }

    if (stepType === "condition_eval" || stepType === "condition") {
      const expression = String((step as any).condition || (step as any).expression || "");
      const rawResult = (step as any).result ?? (step as any).value;
      const conditionResult =
        rawResult === undefined || rawResult === null
          ? undefined
          : Boolean(rawResult);
      
      const line = Number((step as any).line ?? 0);
      const conditionIdRaw = (step as any).conditionId ?? `${frameId}-cond-${stepIndex}`;
      const conditionId = String(conditionIdRaw);
      const groupId = this.resolveIfGroupId(frameId, scopeDepth, stepIndex, line);

      // Step 1: Create the in-flow caller (the "if" chip inside the frame) FIRST.
      // This must exist before createOrGetControlGroupContainer runs so that
      // resolveControlContainerPlacement can use it as the arrow trigger.
      const placement = this.getPlacementContext(ownerFrame, frameId, scopeDepth, step);
      const callerId = `condition-caller-${groupId}-${stepIndex}`;

      const callerElement: LayoutElement = {
        id: callerId,
        type: "condition_caller",
        x: placement.x,
        y: placement.y,
        width: placement.width - 40,
        height: 50,
        parentId: placement.parent.id,
        stepId: stepIndex,
        data: {
          condition: expression,
          conditionResult: conditionResult,
          conditionId: conditionId,
          controlGroupId: groupId,
          controlKind: "if",
          controlRole: "caller",
          birthStep: stepIndex,
          isActive: true,
        },
      };

      this.appendElementToPlacement(ownerFrame, placement, callerElement);
      layout.elements.push(callerElement);
      this.elementHistory.set(callerElement.id, callerElement);
      this.createdInStep.set(callerElement.id, stepIndex);

      // Step 2: NOW create (or retrieve) the right-flow group container.
      // findLastRenderableChild will now see the callerElement as the trigger.
      const { groupState } = this.createOrGetControlGroupContainer(
        layout,
        ownerFrame,
        step,
        frameId,
        scopeDepth,
        stepIndex,
        groupId,
        "if_chain",
      );

      // Determine kind AFTER we know the group exists.
      const kind: ControlKind = groupState.members.length === 0 ? "if" : "else_if";

      // Update callerElement with the resolved group id and kind.
      callerElement.data.controlGroupId = groupState.groupId;
      callerElement.data.controlKind = kind;

      // Register caller in group.
      groupState.members.push(callerElement.id);

      this.activeConditions.set(conditionId, {
        conditionId,
        conditionType: "if",
        startStep: stepIndex,
        elementId: callerElement.id,
        parentFrameId: frameId,
        conditionResult,
        expression,
        kind,
      });

      return true;
    }


    if (stepType === "branch_taken" || stepType === "branch") {
      const conditionIdRaw = (step as any).conditionId ?? `${frameId}-cond-${stepIndex - 1}`;
      const conditionId = String(conditionIdRaw);
      const branchTakenRaw = String(
        (step as any).branch || (step as any).branchType || (step as any).branchTaken || "if",
      );
      const branchTaken = this.normalizeBranchLabel(branchTakenRaw);

      const groupState = this.resolveIfGroupForBranch(frameId, conditionId);
      if (!groupState) return true;
      const container = this.elementHistory.get(groupState.containerElementId);
      if (!container) return true;

      if (branchTaken === "else") {
        const origin = this.resolveCallerOriginElement(step, ownerFrame, frameId, scopeDepth);
        const elseCaller = this.appendControlCaller(
          layout,
          groupState,
          container,
          "else",
          step,
          stepIndex,
          "else",
          true,
          "else",
          line,
          "active",
          true,
          origin.id,
        );
        const elseBody = this.createControlBodyForCaller(
          layout,
          groupState,
          container,
          elseCaller,
          stepIndex,
        );
        // Layer 1: Register else body by stepKey for downstream placement
        if ((step as any).stepKey) {
          this.bodyByStepKey.set((step as any).stepKey, elseBody);
        }
        const activation = this.resolveControlBodyActivation(step, scopeDepth);
        this.setActiveControlForDepth(frameId, activation.activationDepth, elseBody.id);
        this.currentScopeDepth.set(frameId, activation.activationDepth);
        if (activation.ephemeral) {
          this.setEphemeralControlForDepth(
            frameId,
            activation.activationDepth,
            elseBody.id,
            line,
          );
        }

        // Layer 1.1: Register container by conditionId for robust parent resolution
        this.containerByConditionId.set(conditionId, elseBody);
        return true;
      }

      const condState = this.activeConditions.get(conditionId);
      let target = this.findGroupMemberByConditionId(groupState, conditionId);

      const shouldExpand =
        target?.data?.conditionResult === true ||
        condState?.conditionResult === true;

      // If we only have the in-flow caller (type: condition_caller), we still need to
      // create the actual execution caller and body on the right-flow canvas.
      const isOnlyInFlow = target?.type === "condition_caller";

      if ((!target || isOnlyInFlow) && condState && shouldExpand) {
        target = this.appendControlCaller(
          layout,
          groupState,
          container,
          (condState.kind as Exclude<ControlKind, "group">) || "if",
          step,
          stepIndex,
          condState.expression || branchTaken,
          true,
          branchTakenRaw,
          line,
          "active",
          true,
          isOnlyInFlow ? target?.id : condState.elementId
        );
      }

      if (!target) return true;

      const nextBranchState: BranchState = shouldExpand ? "active" : "skipped";
      target.stepId = stepIndex;
      if (target.type === "condition") {
        target.height = CONTROL_CALLER_HEIGHT;
      }
      target.data = {
        ...target.data,
        branchTaken: branchTakenRaw,
        branchLabel: branchTakenRaw,
        branchState: nextBranchState,
        headerOnly: true,
        isActive: shouldExpand,
      };
      
      if (!this.createdInStep.has(target.id)) {
        this.createdInStep.set(target.id, stepIndex);
      }
      
      if (shouldExpand) {
        const targetBody = this.createControlBodyForCaller(
          layout,
          groupState,
          container,
          target,
          stepIndex,
        );
        // Layer 1: Register if/else-if body by stepKey for downstream placement
        if ((step as any).stepKey) {
          this.bodyByStepKey.set((step as any).stepKey, targetBody);
        }
        const activation = this.resolveControlBodyActivation(step, scopeDepth);
        this.setActiveControlForDepth(frameId, activation.activationDepth, targetBody.id);
        this.currentScopeDepth.set(frameId, activation.activationDepth);
        if (activation.ephemeral) {
          this.setEphemeralControlForDepth(
            frameId,
            activation.activationDepth,
            targetBody.id,
            line,
          );
        }

        // Layer 1.1: Register container by conditionId for robust parent resolution
        this.containerByConditionId.set(conditionId, targetBody);
      }
      this.syncControlGroupHeight(container);
      return true;
    }

    if (stepType === "conditional_start") {
      const conditionIdRaw = (step as any).conditionId ?? `${frameId}-switch-${stepIndex}`;
      const conditionId = String(conditionIdRaw);
      const expression = String((step as any).expression || (step as any).condition || "switch");
      const groupId = `switch-group-${frameId}-${conditionId}`;
      const { groupState, container } = this.createOrGetControlGroupContainer(
        layout,
        ownerFrame,
        step,
        frameId,
        scopeDepth,
        stepIndex,
        groupId,
        "switch",
      );
      groupState.switchStartStepIndex = stepIndex;
      groupState.switchExpression = expression;
      container.data = {
        ...container.data,
        switchExpression: expression,
      };

      if (groupState.members.length === 0) {
        const origin = this.resolveCallerOriginElement(step, ownerFrame, frameId, scopeDepth);
        const switchCaller = this.appendControlCaller(
          layout,
          groupState,
          container,
          "switch",
          step,
          stepIndex,
          expression,
          undefined,
          undefined,
          line,
          "pending",
          false,
          origin.id,
        );
        switchCaller.data = {
          ...switchCaller.data,
          conditionType: "switch",
          headerOnly: true,
          branchState: "pending" as BranchState,
        };
        this.activeConditions.set(conditionId, {
          conditionId,
          conditionType: "switch",
          startStep: stepIndex,
          elementId: switchCaller.id,
          parentFrameId: frameId,
        });
      }
      return true;
    }

    if (stepType === "conditional_branch") {
      const explicitConditionId = (step as any).conditionId;
      let groupState: ControlGroupState | undefined;
      let conditionIdRaw = explicitConditionId;

      if (!explicitConditionId) {
        let latestSwitchGroup: ControlGroupState | undefined;
        for (const [id, state] of this.activeControlGroups.entries()) {
          if (state.frameId === frameId && state.controlType === "switch") {
            if (!latestSwitchGroup || (state.switchStartStepIndex ?? -1) >= (latestSwitchGroup.switchStartStepIndex ?? -1)) {
              latestSwitchGroup = state;
            }
          }
        }
        groupState = latestSwitchGroup;
        conditionIdRaw = groupState?.switchStartStepIndex
          ? `${frameId}-switch-${groupState.switchStartStepIndex}`
          : `${frameId}-switch-${stepIndex}`;
      }

      const conditionId = String(conditionIdRaw);
      const branchLabel = String((step as any).label || "default");
      const isMatched = Boolean((step as any).isMatched);
      const isDeclaration = Boolean((step as any).isDeclaration);
      const fallsThroughRaw = (step as any).fallsThrough ?? (step as any).fallthrough;
      const fallsThrough = Boolean(fallsThroughRaw);
      const caseIndexRaw = (step as any).caseIndex;
      const caseIndex =
        caseIndexRaw === undefined || caseIndexRaw === null || Number.isNaN(Number(caseIndexRaw))
          ? undefined
          : Number(caseIndexRaw);
      const groupId = `switch-group-${frameId}-${conditionId}`;
      if (!groupState) {
        groupState = this.activeControlGroups.get(groupId);
      }
      if (!groupState) return true;
      const container = this.elementHistory.get(groupState.containerElementId);
      if (!container) return true;

      const kind: ControlKind =
        branchLabel.toLowerCase() === "default" ? "default" : "case";

      const displayExpression = this.formatSwitchCaseExpression(groupState, branchLabel);

      let caseCaller = this.findSwitchCaseCaller(groupState, branchLabel);
      if (!caseCaller) {
        const origin = this.resolveCallerOriginElement(step, ownerFrame, frameId, scopeDepth);
        caseCaller = this.appendControlCaller(
          layout,
          groupState,
          container,
          kind as Exclude<ControlKind, "group">,
          step,
          stepIndex,
          displayExpression,
          isMatched,
          branchLabel,
          line,
          isMatched ? "active" : "skipped",
          isMatched,
          origin.id,
        );
      }

      const existingBranchState = caseCaller.data?.branchState as BranchState | undefined;
      const nextBranchState: BranchState = isMatched
        ? "active"
        : existingBranchState === "active"
          ? "active"
          : isDeclaration
            ? "skipped"
            : existingBranchState || "pending";

      caseCaller.stepId = stepIndex;
      caseCaller.data = {
        ...caseCaller.data,
        label: branchLabel,
        caseValue: branchLabel,
        condition: displayExpression,
        expression: displayExpression,
        conditionResult: Boolean(caseCaller.data?.conditionResult) || isMatched,
        isMatched: Boolean(caseCaller.data?.isMatched || isMatched),
        fallsThrough:
          caseCaller.data?.fallsThrough !== undefined
            ? caseCaller.data.fallsThrough
            : fallsThrough,
        caseIndex:
          caseCaller.data?.caseIndex !== undefined
            ? caseCaller.data.caseIndex
            : caseIndex,
        branchTaken: branchLabel,
        branchLabel,
        branchState: nextBranchState,
        headerOnly: true,
        isActive: nextBranchState === "active",
      };

      if (caseIndex !== undefined) {
        if (!groupState.switchCaseIds) groupState.switchCaseIds = [];
        groupState.switchCaseIds[caseIndex] = caseCaller.id;
        this.maybeLinkSwitchFallthrough(groupState, caseIndex, stepIndex);
      }
      if (isMatched) {
        const caseBody = this.createControlBodyForCaller(
          layout,
          groupState,
          container,
          caseCaller,
          stepIndex,
        );
        const activation = this.resolveControlBodyActivation(step, scopeDepth);
        this.setActiveControlForDepth(frameId, activation.activationDepth, caseBody.id);
        this.currentScopeDepth.set(frameId, activation.activationDepth);
        if (activation.ephemeral) {
          this.setEphemeralControlForDepth(
            frameId,
            activation.activationDepth,
            caseBody.id,
            line,
          );
        }

        // Layer 1.1: Register container by conditionId for robust parent resolution
        this.containerByConditionId.set(conditionId, caseBody);
      }
      groupState.lastStep = stepIndex;
      groupState.lastLine = line;
      return true;
    }

    return false;
  }

  public static calculateLayout(
    executionTrace: ExecutionTrace,
    currentStep: number, // RENAMED from currentStepIndex
    canvasWidth: number,
    canvasHeight: number,
  ): Layout {
    const layout: Layout = {
      mainFunction: {
        id: "main-function",
        type: "main",
        x: MAIN_FUNCTION_X,
        y: MAIN_FUNCTION_Y,
        width: MAIN_FUNCTION_WIDTH,
        height: 80,
        children: [],
        stepId: 0,
        data: { frameId: "main-0" },
      },
      globalPanel: {
        id: "global-panel",
        type: "global",
        x: 0,
        y: 0,
        width: GLOBAL_PANEL_WIDTH,
        height: 60,
        children: [],
        stepId: 0,
      },
      arrayPanel: null,
      elements: [],
      arrayReferences: [],
      updateArrows: [],
      functionArrows: [],
      controlArrows: [],
      width: canvasWidth,
      height: canvasHeight,
    };

    this.elementHistory.clear();
    this.activeLoops.clear();
    this.activeConditions.clear();
    this.arrayTracker = new ProgressiveArrayTracker();
    this.createdInStep.clear();
    this.updateArrows.clear();
    this.functionFrames.clear();
    this.functionArrows = [];
    this.controlArrows = [];
    this.frameDepthMap.clear();
    this.frameOrderMap.clear();
    this.frameOrder = 0;
    this.activeControlGroups.clear();
    this.activeControlByDepth.clear();
    this.ephemeralControlByDepth.clear();
    this.recentIfGroupByFrame.clear();
    this.currentScopeDepth.clear();
    this.rightFlowOccupancy.clear();
    this.bodyByStepKey.clear();
    this.containerByConditionId.clear();
    this.conditionTree = (executionTrace as any).conditionTree ?? null;

    this.functionFrames.set("main-0", layout.mainFunction);
    this.frameDepthMap.set("main-0", 0);
    this.frameOrderMap.set("main-0", this.frameOrder++);

    // NEW: Restore camera and initial state tracking
    if (currentStep === 0) {
        // Handle camera reset or initial positioning if needed
    }

    for (
      let i = 0;
      i <= currentStep && i < executionTrace.steps.length;
      i++
    ) {
      const step = executionTrace.steps[i];
      this.processStep(step, layout, i, currentStep, executionTrace);
      
      // Update camera focus for relevant steps
      if (i === currentStep) {
          this.updateCameraFocus(step, layout, i);
      }
    }

    this.createArrayPanel(layout, currentStep);
    this.positionGlobalPanel(layout);
    this.createArrayReferences(layout, currentStep);
    this.createUpdateArrows(layout, currentStep);
    this.pruneDeclarationOnlyDuplicates(layout);
    this.updateContainerHeights(layout);
    layout.functionArrows = this.functionArrows;
    layout.controlArrows = this.controlArrows;

    // Validate layout in development mode
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
      this.validateLayout(layout);
    }

    return layout;
  }

  private static processStep(
    step: ExecutionStep,
    layout: Layout,
    stepIndex: number,
    currentStep: number,
    executionTrace: ExecutionTrace,
  ): void {
    const stepType: string = (step as any).eventType || (step as any).type;
    const frameId = (step as any).frameId;
    const callDepth = (step as any).callDepth || 0;
    const parentFrameId = (step as any).parentFrameId;
    const isFunctionEntry = (step as any).isFunctionEntry;
    const isFunctionExit = (step as any).isFunctionExit;
    const explanation = (step as any).explanation; // Extract explanation

    if (stepType === "func_enter" && isFunctionEntry) {
      const functionName = (step as any).function;

      if (!this.functionFrames.has(frameId)) {
        this.frameDepthMap.set(frameId, callDepth);
        this.frameOrderMap.set(frameId, this.frameOrder++);

        const parentFrame = parentFrameId
          ? this.functionFrames.get(parentFrameId)
          : null;
        const isRecursive = functionName === parentFrame?.data?.functionName;

        const baseX = MAIN_FUNCTION_X + MAIN_FUNCTION_WIDTH + PANEL_GAP;
        let funcX = baseX + (callDepth - 1) * (FUNCTION_BOX_WIDTH + 60);
        const orderIndex = this.frameOrderMap.get(frameId) || 0;
        let funcY =
          MAIN_FUNCTION_Y + (orderIndex - 1) * FUNCTION_VERTICAL_SPACING;
        
        // Extract parameters
        const parameters = this.extractParameters(executionTrace, frameId, stepIndex);
        
        // Determine arrow source
        let arrowFromX = parentFrame ? parentFrame.x + parentFrame.width : 0;
        let arrowFromY = parentFrame ? parentFrame.y + 75 : 0;
        let callElement: LayoutElement | null = null;
        let callScopeDepth = 0;

        if (parentFrame) {
          const prevStep = stepIndex > 0 ? executionTrace.steps[stepIndex - 1] : null;
          const prevType = String(
            (prevStep as any)?.eventType || (prevStep as any)?.type || "",
          ).toLowerCase();
          const callStyle = prevType === 'var_declare' ? 'inline' : 'standalone';
          const callLine = Number((step as any).line ?? (prevStep as any)?.line ?? -1);
          
          // Use the stronger of previous-step depth and caller frame's persisted depth.
          // This keeps call_site inside the active control container for single-line branches.
          callScopeDepth = this.resolveCallSiteScopeDepth(
            executionTrace,
            stepIndex,
            parentFrameId,
            prevStep as ExecutionStep | null,
            callLine,
          );
          const placement = this.getPlacementContext(parentFrame, parentFrameId, callScopeDepth);

          callElement = {
            id: `call-${parentFrameId}-to-${frameId}`,
            type: "call_site",
            subtype: callStyle,
            x: placement.x,
            y: placement.y,
            width: placement.width,
            height: 50,
            parentId: placement.parent.id,
            stepId: stepIndex,
            data: {
              functionName: functionName,
              args: "()",
            callStyle: callStyle,
            targetFrameId: frameId
            }
          };

          this.appendElementToPlacement(parentFrame, placement, callElement);
          this.markEphemeralControlUsed(
            parentFrameId,
            callScopeDepth,
            placement.parent.id,
            stepIndex,
            callLine,
          );

          layout.elements.push(callElement);
          this.elementHistory.set(callElement.id, callElement);

          arrowFromX = callElement.x + callElement.width;
          arrowFromY = callElement.y + callElement.height / 2;

          if (callStyle === 'inline') {
            const varId = `var-${parentFrameId}-${(prevStep as any)?.name || (prevStep as any)?.symbol}-${stepIndex - 1}`;
            const varElement = this.elementHistory.get(varId);
            if (varElement) {
              arrowFromX = varElement.x + varElement.width;
              arrowFromY = varElement.y + varElement.height / 2;
            }
          }
        }

        if (callElement && parentFrameId) {
          const anchoredRect = this.resolveRightFlowRect(
            parentFrameId,
            callElement.x + callElement.width + CONTROL_HORIZONTAL_GAP,
            callElement.y,
            FUNCTION_BOX_WIDTH,
            150,
          );
          funcX = anchoredRect.x;
          funcY = anchoredRect.y;
        }

        const functionElement: LayoutElement = {
          id: `function-${frameId}`,
          type: "function_call",
          x: funcX,
          y: funcY,
          width: FUNCTION_BOX_WIDTH,
          height: 150,
          children: [],
          stepId: stepIndex,
          data: {
            frameId: frameId,
            functionName: functionName,
            returnType: "int",
            isRecursive: isRecursive,
            depth: callDepth,
            calledFrom: parentFrameId || "main",
            parameters: parameters, // NEW
            localVarCount: 0,
            isActive: true,
            isReturning: false,
          },
          metadata: {
            stackIndex: callDepth,
          },
        };

        this.getLane(functionElement, 'HEADER');
        
        // Reserve space for parameters
        if (parameters.length > 0) {
          const paramLane = this.getLane(functionElement, 'PARAMS');
          paramLane.usedHeight = 25 + (parameters.length * 28) + 10;
        }

        layout.elements.push(functionElement);
        this.elementHistory.set(functionElement.id, functionElement);
        this.functionFrames.set(frameId, functionElement);

        if (parentFrame) {
          const arrow: LayoutElement = {
            id: `arrow-${parentFrameId}-to-${frameId}`,
            type: "array_reference",
            subtype: "function_arrow",
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            stepId: stepIndex,
            data: {
              fromX: arrowFromX,
              fromY: arrowFromY,
              toX: funcX + functionElement.width / 2,
              toY: funcY,
              label: `call ${functionName}()`,
              isRecursive: isRecursive,
            },
          };
          this.functionArrows.push(arrow);
        }
      }
      return;
    }

    if (stepType === "func_exit" && isFunctionExit) {
      const funcFrame = this.functionFrames.get(frameId);
      if (funcFrame && funcFrame.data) {
        funcFrame.data.isActive = false;
        funcFrame.data.isReturning = true;
      }
      
      // Compute scope depth BEFORE deleting the frame's state!
      const scopeDepth = this.getScopeDepth(step, frameId);
      
      this.activeControlByDepth.delete(frameId);
      this.recentIfGroupByFrame.delete(frameId);
      this.currentScopeDepth.delete(frameId);

      // *** NEW: Get return value properly ***
      const returnValue = this.getReturnValue(executionTrace, frameId, stepIndex);
      const functionName = (step as any).function;

      if (funcFrame) {
        this.appendReturnElement(
          layout,
          funcFrame,
          frameId,
          stepIndex,
          functionName || funcFrame.data?.functionName || "function",
          returnValue,
          scopeDepth,
          step,
          Number((step as any).line ?? -1),
        );
      }
      return;
    }

    if (stepType === "return") {
      const funcFrame = this.functionFrames.get(frameId);
      if (!funcFrame) return;

      const functionName =
        (step as any).function || funcFrame.data?.functionName || "function";
      const returnValue = (step as any).returnValue ?? (step as any).value ?? null;
      const scopeDepth = this.getScopeDepth(step, frameId);

      this.appendReturnElement(
        layout,
        funcFrame,
        frameId,
        stepIndex,
        functionName,
        returnValue,
        scopeDepth,
        step,
        Number((step as any).line ?? -1),
      );
      return;
    }

    const ownerFrame = this.functionFrames.get(frameId);
    if (!ownerFrame) {
      return;
    }

    const normalizedStepType = String(stepType || "").toLowerCase();
    const stepLine = Number((step as any).line ?? -1);

    // NEW: Handle block scope events to maintain persistent scope depth
    let rawScopeDepth = this.getScopeDepth(step, frameId);
    
    // NORMALIZE depth if inside a loop iteration to prevent leakage
    const currentLoop = this.getActiveLoopForFrame(frameId);
    let scopeDepth = rawScopeDepth;
    if (currentLoop && rawScopeDepth > currentLoop.baseScopeDepth) {
        scopeDepth = currentLoop.baseScopeDepth + (rawScopeDepth - currentLoop.baseScopeDepth);
        // If the tracer is accumulating depth iteration-on-iteration (1, 2, 3...)
        // we can force it back to the loop's context if it's over a threshold.
        // However, for pure preservation, we will strictly use the logic:
        // if the tracer doesn't pop, we manually cap the depth for placement
        // while allowing block_enter/exit to still track correctly.
    }

    if (normalizedStepType === "block_enter") {
      this.currentScopeDepth.set(frameId, scopeDepth);
    } else if (normalizedStepType === "block_exit" || normalizedStepType === "scope_exit") {
      // block_exit carries the depth of the scope that is CLOSING.
      // After exit, current depth = that value minus 1.
      const blockDepthFromEvent = (step as any).blockDepth ?? scopeDepth;
      scopeDepth = Math.max(0, blockDepthFromEvent - 1);
      this.currentScopeDepth.set(frameId, scopeDepth);
    }
    this.currentScopeDepth.set(frameId, scopeDepth);
    
    if (normalizedStepType === "scope_exit") {
        console.log(`[PLACEMENT_DEBUG] scope_exit in frame: ${frameId} -> scopeDepth: ${scopeDepth}`);
    }
    const exitedControlIds = [
      ...this.pruneControlDepthForScope(frameId, scopeDepth),
      ...this.pruneEphemeralControls(frameId, stepIndex, stepLine),
    ];
    this.maybeCreateBranchReturnFlow(
      executionTrace,
      frameId,
      normalizedStepType,
      stepIndex,
      exitedControlIds,
    );

    if (this.processControlStep(step, executionTrace, layout, stepIndex, ownerFrame, frameId)) {
      return;
    }

    if (stepType === "var_declare") {
      const { name, symbol, varType } = step as any;
      const varName = name || symbol;

      if (!varName) return;

      const varId = `var-${frameId}-${varName}-${stepIndex}`;

      const variable: any = {
        name: varName,
        // Use empty string as placeholder to avoid showing undefined/null in UI
        value: "",
        type: varType || "int",
        primitive: varType || "int",
        address: "0x0",
        scope: "local",
        isInitialized: false,
        isAlive: true,
        birthStep: stepIndex,
        frameId: frameId,
      };

      const scopeDepth = this.getScopeDepth(step, frameId);
      const placementScopeDepth = this.resolvePlacementScopeDepth(
        executionTrace,
        stepIndex,
        frameId,
        stepLine,
        stepType,
        scopeDepth,
      );
      const placement = this.getPlacementContext(ownerFrame, frameId, placementScopeDepth, step);
      
      const elementHeight = explanation ? VARIABLE_HEIGHT + EXPLANATION_HEIGHT : VARIABLE_HEIGHT;
      const reservesCursorSpace = !this.isImmediateDeclarationInitialization(
        executionTrace,
        stepIndex,
        frameId,
        varName,
      );
       
      const varElement: LayoutElement = {
        id: varId,
        type: "variable",
        subtype: "variable_load",
        x: placement.x,
        y: placement.y,
        width: placement.width - 40,
        height: elementHeight,
        parentId: placement.parent.id,
        stepId: stepIndex,
        data: {
            ...variable,
            explanation: explanation,
            suppressLayoutSpacing: !reservesCursorSpace,
        },
      };

      // NEW: Redirect loop control variables to the loop header instead of the lane
      const currentLoop = this.getActiveLoopForFrame(frameId);
      if (currentLoop && currentLoop.elementId) {
        const loopEl = this.elementHistory.get(currentLoop.elementId);
        const updateStr = String(loopEl?.data?.update || "");
        if (updateStr.includes(varName)) {
           if (loopEl) {
             loopEl.data.updateValues = loopEl.data.updateValues || {};
             loopEl.data.updateValues[varName] = ""; // Initial placeholder
             loopEl.data.isActive = true;
             loopEl.data.isUpdateStep = true;
             loopEl.stepId = stepIndex;

             if (loopEl.data.updateCapsule) {
               loopEl.data.updateCapsule.isActive = true;
               loopEl.data.updateCapsule.updateValues = loopEl.data.updateValues;
             }
           }
           return;
        }
      }

      this.appendElementToPlacement(
        ownerFrame,
        placement,
        varElement,
        reservesCursorSpace,
      );
      this.markEphemeralControlUsed(
        frameId,
        placementScopeDepth,
        placement.parent.id,
        stepIndex,
        stepLine,
      );

      layout.elements.push(varElement);
      this.elementHistory.set(varId, varElement);
      this.createdInStep.set(varId, stepIndex);
      
      if (reservesCursorSpace && ownerFrame.type === "function_call" && ownerFrame.data) {
        ownerFrame.data.localVarCount++;
      }
      return;
    }

    // Handle variable assignment. The first assignment after a declaration is now treated as a "load"
    // (visualised as a normal variable update). Subsequent assignments update the existing element.
    if (stepType === "var_assign" || stepType === "var_load") {
      const { name, value, symbol } = step as any;
      const varName = name || symbol;

      if (!varName) return;

      const prevStep = stepIndex > 0 ? (executionTrace.steps[stepIndex - 1] as any) : null;
      const prevType = (prevStep?.eventType || prevStep?.type || "").toLowerCase();
      const prevName = prevStep?.name || prevStep?.symbol;
      const prevFrameId = prevStep?.frameId || "";
      const isImmediateInitAssignment =
        prevType === "var_declare" &&
        prevName === varName &&
        prevFrameId === frameId;

      if (isImmediateInitAssignment) {
        const declarationId = `var-${frameId}-${varName}-${stepIndex - 1}`;
        const declarationElement = this.elementHistory.get(declarationId);
        if (declarationElement && declarationElement.type === "variable") {
          const hadSuppressedSpacing = Boolean(declarationElement.data?.suppressLayoutSpacing);

          declarationElement.stepId = stepIndex;
          declarationElement.data = {
            ...declarationElement.data,
            value: value !== undefined ? String(value) : undefined,
            isInitialized: true,
            isUpdated: true,
            explanation: explanation,
            suppressLayoutSpacing: false,
          };
          this.createdInStep.set(declarationElement.id, stepIndex);

          // If declaration spacing was suppressed in frame lane, reserve it now on initialization.
          if (hadSuppressedSpacing && declarationElement.parentId === ownerFrame.id) {
            const lane = this.getLane(ownerFrame, "LOCALS");
            lane.usedHeight += declarationElement.height + ELEMENT_SPACING;
          }
          return;
        }
      }

      // Check if we're in toggle mode and inside a loop
      const { toggleMode } = useLoopStore.getState();
      const currentLoop = this.getActiveLoopForFrame(frameId);

      if (currentLoop) {
        const loopEl = this.elementHistory.get(currentLoop.elementId!);
        const updateStr = String(loopEl?.data?.update || "");
        
        // REDIRECT loop control variable updates to header
        if (updateStr.includes(varName)) {
           if (loopEl) {
             loopEl.data.updateValues = loopEl.data.updateValues || {};
             loopEl.data.updateValues[varName] = value;
             loopEl.data.isActive = true;
             loopEl.data.isUpdateStep = true;
             loopEl.stepId = stepIndex;

             if (loopEl.data.updateCapsule) {
               loopEl.data.updateCapsule.isActive = true;
               loopEl.data.updateCapsule.updateValues = loopEl.data.updateValues;
             }
           }
           return;
        }

        if (!toggleMode) {
          // UPDATE MODE (Toggle OFF): Reuse existing element instead of creating new one
          const existingElement = this.findLoopChildElement(currentLoop.elementId!, 'variable', varName);
          if (existingElement) {
            existingElement.data.value = value;
            existingElement.data.isUpdated = true;
            existingElement.stepId = stepIndex;
            this.createdInStep.set(existingElement.id, stepIndex);
            
            // Highlight the reused element if it's the current step
            existingElement.data.isActive = (stepIndex === currentStep);
            
            return;
          }
        }
      }

      const varId = `var-${frameId}-${varName}-${stepIndex}`;

      // NEW: Detect if this is a function return assignment
      // Look for function exit in previous steps
      const isFunctionReturnAssignment = 
        stepIndex > 0 && 
        ((executionTrace.steps[stepIndex - 1] as any)?.eventType === 'func_exit' || 
         executionTrace.steps[stepIndex - 1]?.type === 'function_return');

      // If the variable element does not exist yet, create it. Use the "variable_load" subtype to indicate
      // that this is the initial value being loaded onto the canvas.
      const variable: any = {
        name: varName,
        value: value,
        type: "int",
        primitive: "int",
        address: "0x0",
        scope: "local",
        isInitialized: true,
        isAlive: true,
        birthStep: stepIndex,
        frameId: frameId,
      };

      const scopeDepth = this.getScopeDepth(step, frameId);
      const placementScopeDepth = this.resolvePlacementScopeDepth(
        executionTrace,
        stepIndex,
        frameId,
        stepLine,
        stepType,
        scopeDepth,
      );
      const placement = this.getPlacementContext(
        ownerFrame,
        frameId,
        placementScopeDepth,
        step,
      );
      
      // Calculate height based on explanation and function call
      const baseHeight = VARIABLE_HEIGHT;
      const hasExplanation = !!explanation;
      const hasFunctionCall = isFunctionReturnAssignment;
      
      // If function call, add extra space for inline call element
      const extraHeight = (hasExplanation ? EXPLANATION_HEIGHT : 0) + 
                         (hasFunctionCall ? 60 : 0); // 60px for inline call
      const elementHeight = baseHeight + extraHeight;
      
      const varElement: LayoutElement = {
        id: varId,
        type: "variable",
        subtype: isFunctionReturnAssignment ? "variable_with_call" : "variable_load",
        x: placement.x,
        y: placement.y,
        width: placement.width - 40,
        height: elementHeight,
        parentId: placement.parent.id,
        stepId: stepIndex,
        data: {
          ...variable,
          value: value !== undefined ? String(value) : undefined,
          explanation: explanation,
          hasFunctionCall: isFunctionReturnAssignment,
          // Store function info if it was a call
          functionCallInfo: isFunctionReturnAssignment ? {
            functionName: executionTrace.steps[stepIndex - 1].function,
            returnValue: value
          } : null
        },
      };

      this.appendElementToPlacement(ownerFrame, placement, varElement);
      this.markEphemeralControlUsed(
        frameId,
        placementScopeDepth,
        placement.parent.id,
        stepIndex,
        stepLine,
      );

      layout.elements.push(varElement);
      this.elementHistory.set(varId, varElement);
      this.createdInStep.set(varId, stepIndex);
      return;
    }

    if (stepType === "pointer_alias") {
      const { name, symbol, aliasOf, decayedFromArray, pointsTo } = step as any;
      const ptrName = name || symbol;

      if (!ptrName) return;

      const ptrId = `ptr-${frameId}-${ptrName}`;

      if (!this.elementHistory.has(ptrId)) {
        const pointerData: any = {
          name: ptrName,
          value: aliasOf ? `→ ${aliasOf}` : "→ unresolved",
          type: decayedFromArray ? `int*` : `void*`,
          primitive: "pointer",
          address: pointsTo?.address || "0x0",
          scope: "local",
          isInitialized: true,
          isAlive: true,
          birthStep: stepIndex,
          isPointer: true,
          pointsTo: pointsTo,
          decayedFromArray: decayedFromArray,
          aliasOf: aliasOf,
          frameId: frameId,
        };

        const scopeDepth = this.getScopeDepth(step, frameId);
        const placement = this.getPlacementContext(ownerFrame, frameId, scopeDepth, step);
        const elementHeight = explanation ? VARIABLE_HEIGHT + EXPLANATION_HEIGHT : VARIABLE_HEIGHT;

        const ptrElement: LayoutElement = {
          id: ptrId,
          type: "heap_pointer",
          subtype: decayedFromArray ? "array_alias" : "pointer",
          x: placement.x,
          y: placement.y,
          width: placement.width,
          height: elementHeight,
          parentId: placement.parent.id,
          stepId: stepIndex,
          data: {
            ...pointerData,
            explanation: explanation,
          },
          metadata: {
            referencesArray: aliasOf,
          },
        };
        this.appendElementToPlacement(ownerFrame, placement, ptrElement);
        this.markEphemeralControlUsed(frameId, scopeDepth, placement.parent.id, stepIndex, stepLine);
        layout.elements.push(ptrElement);
        this.elementHistory.set(ptrId, ptrElement);
        this.createdInStep.set(ptrId, stepIndex);
      }
      return;
    }

    // Handle pointer dereference write events to update pointer value display
    if (stepType === "pointer_deref_write" || stepType === "pointer_write") {
      const { name, symbol, target, value, address } = step as any;
      const ptrName = name || symbol || target;
      if (!ptrName) return;

      const ptrId = `ptr-${frameId}-${ptrName}`;
      if (this.elementHistory.has(ptrId)) {
        const existingElement = this.elementHistory.get(ptrId)!;
        existingElement.stepId = stepIndex;
        existingElement.data = {
          ...existingElement.data,
          value: value !== undefined ? String(value) : undefined,
          address: address || existingElement.data?.address,
        };
        this.createdInStep.set(existingElement.id, stepIndex);
        return;
      }

      const pointerData: any = {
        name: ptrName,
        value: value !== undefined ? String(value) : undefined,
        type: "void*",
        primitive: "pointer",
        address: address || "0x0",
        scope: "local",
        isInitialized: true,
        isAlive: true,
        birthStep: stepIndex,
        isPointer: true,
        frameId: frameId,
      };

      const scopeDepth = this.getScopeDepth(step, frameId);
      const placement = this.getPlacementContext(ownerFrame, frameId, scopeDepth, step);
      const elementHeight = explanation
        ? VARIABLE_HEIGHT + EXPLANATION_HEIGHT
        : VARIABLE_HEIGHT;

      const ptrElement: LayoutElement = {
        id: ptrId,
        type: "heap_pointer",
        subtype: "pointer_write",
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: elementHeight,
        parentId: placement.parent.id,
        stepId: stepIndex,
        data: {
          ...pointerData,
          explanation,
        },
      };
      this.appendElementToPlacement(ownerFrame, placement, ptrElement);
      this.markEphemeralControlUsed(frameId, scopeDepth, placement.parent.id, stepIndex, stepLine);

      layout.elements.push(ptrElement);
      this.elementHistory.set(ptrId, ptrElement);
      this.createdInStep.set(ptrId, stepIndex);
      return;
    }

    if (stepType === "array_create" || stepType === "array_declaration") {
      const {
        name,
        symbol,
        baseType,
        dimensions,
        isInitializer,
        initializerValues,
      } = step as any;
      const arrayName = name || symbol;
      const owner = (step as any).function || "main";
      const address = (step as any).address || "0x0";

      this.arrayTracker.createArray(
        arrayName,
        baseType,
        dimensions,
        address,
        owner,
        stepIndex,
        isInitializer ? initializerValues : undefined,
      );

      const varId = `var-${frameId}-${arrayName}`;
      if (!this.elementHistory.has(varId)) {
        const arrayRefVar: any = {
          name: arrayName,
          value: `→ array[${dimensions.join("][")}]`,
          type: `${baseType}[]`,
          primitive: `${baseType}[]`,
          address: address,
          scope: "local",
          isInitialized: true,
          isAlive: true,
          birthStep: stepIndex,
          isArrayReference: true,
          arrayName: arrayName,
          dimensions: dimensions,
          frameId: frameId,
        };

        const scopeDepth = this.getScopeDepth(step, frameId);
        const placement = this.getPlacementContext(ownerFrame, frameId, scopeDepth, step);

        const varElement: LayoutElement = {
          id: varId,
          type: "variable",
          subtype: "array_reference",
          x: placement.x,
          y: placement.y,
          width: placement.width,
          height: VARIABLE_HEIGHT,
          parentId: placement.parent.id,
          stepId: stepIndex,
          data: arrayRefVar,
          metadata: {
            referencesArray: arrayName,
          },
        };
        this.appendElementToPlacement(ownerFrame, placement, varElement);
        this.markEphemeralControlUsed(frameId, scopeDepth, placement.parent.id, stepIndex, stepLine);
        layout.elements.push(varElement);
        this.elementHistory.set(varId, varElement);
        this.createdInStep.set(varId, stepIndex);
      }

      return;
    }

    if (stepType === "array_index_assign" || stepType === "array_assignment") {
      const { name, symbol, indices, value } = step as any;
      const arrayName = name || symbol;
      this.arrayTracker.updateArrayElement(
        arrayName,
        indices,
        value,
        stepIndex,
      );

      if (stepIndex === currentStep) {
        this.createArrayUpdateArrow(
          layout,
          arrayName,
          indices,
          stepIndex,
          frameId,
        );
      }
      return;
    }

    if (stepType === "output") {
      const outputId = `output-${stepIndex}`;
      
      const { toggleMode } = useLoopStore.getState();
      const currentLoop = this.getActiveLoopForFrame(frameId);

      if (currentLoop && !toggleMode) {
        // Find existing output element with same text/metadata in the loop
        const existing = this.findLoopChildElement(currentLoop.elementId!, 'output', (step as any).text || (step as any).rawText);
        if (existing) {
          existing.data.text = (step as any).text || (step as any).rawText;
          existing.data.isActive = (stepIndex === currentStep);
          existing.stepId = stepIndex;
          this.createdInStep.set(existing.id, stepIndex);
          return;
        }
      }

      if (this.elementHistory.has(outputId)) return;

      const scopeDepth = this.getScopeDepth(step, frameId);
      const placement = this.getPlacementContext(ownerFrame, frameId, scopeDepth, step);
      const baseHeight = 60;
      const elementHeight = explanation ? baseHeight + EXPLANATION_HEIGHT : baseHeight;

      const outputElement: LayoutElement = {
        id: outputId,
        type: "output",
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: elementHeight,
        parentId: placement.parent.id,
        stepId: stepIndex,
        data: {
          text: (step as any).text || (step as any).rawText,
          rawText: (step as any).rawText,
          frameId: frameId,
          explanation: explanation,
        },
      };
      this.appendElementToPlacement(ownerFrame, placement, outputElement);
      this.markEphemeralControlUsed(frameId, scopeDepth, placement.parent.id, stepIndex, stepLine);
      layout.elements.push(outputElement);
      this.elementHistory.set(outputId, outputElement);
      return;
    }

    if (stepType === 'input' || stepType === 'input_request' || stepType === 'input_call') {
      const inputId = `input-${stepIndex}`;
      if (this.elementHistory.has(inputId)) return;

      const scopeDepth = this.getScopeDepth(step, frameId);
      const placement = this.getPlacementContext(ownerFrame, frameId, scopeDepth, step);
      const hasAssignments = !!(step as any).assignments;
      const baseHeight = 80;
      const extraHeight = hasAssignments ? 24 : 0;

      const inputElement: LayoutElement = {
        id: inputId,
        type: 'input',
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: baseHeight + extraHeight,
        parentId: placement.parent.id,
        stepId: stepIndex,
        data: {
          format: (step as any).format || (step as any).prompt,
          prompt: (step as any).prompt || (step as any).format,
          varName: (step as any).varName || (step as any).name,
          variables: (step as any).variables,
          assignments: (step as any).assignments,
          returnValue: (step as any).returnValue,
          returnNote: (step as any).returnNote,
          value: (step as any).value,
          isWaiting: !(step as any).value && !(step as any).assignments,
          frameId,
        },
      };

      this.appendElementToPlacement(ownerFrame, placement, inputElement);
      this.markEphemeralControlUsed(frameId, scopeDepth, placement.parent.id, stepIndex, stepLine);
      layout.elements.push(inputElement);
      this.elementHistory.set(inputId, inputElement);
      return;
    }

    // LOOP START
    if (stepType === "loop_start") {
      const { loopId, loopType, initialization, condition, update, explanation } = step as any;
      const ownerFrame = this.functionFrames.get(frameId);
      if (!ownerFrame) return;

      const loopScopeDepth = this.getScopeDepth(step, frameId);
      const placement = this.getPlacementContext(ownerFrame, frameId, loopScopeDepth, step);
      
      // Look ahead to find end step
      let endStep: number | undefined;
      for (let i = stepIndex + 1; i < executionTrace.steps.length; i++) {
        const s = executionTrace.steps[i] as any;
        if (s.eventType === 'loop_end' && s.loopId === loopId) {
          endStep = i;
          break;
        }
      }

      // Step 1: Create the in-flow caller
      const callerId = `loop-caller-${frameId}-${loopId}-${stepIndex}`;
      const caller: LayoutElement = {
        id: callerId,
        type: 'loop_caller',
        x: placement.x, 
        y: placement.y,
        width: placement.width,
        height: 90,
        parentId: placement.parent.id,
        stepId: stepIndex,
        data: {
          loopId,
          loopType,
          isActive: true,
          birthStep: stepIndex,
        },
        children: [],
      };

      this.appendElementToPlacement(ownerFrame, placement, caller);
      layout.elements.push(caller);
      this.elementHistory.set(callerId, caller);
      this.createdInStep.set(callerId, stepIndex);

      // Step 2: Create the right-flow loop container
      const resolvePlacement = this.resolveControlContainerPlacement(
        ownerFrame,
        placement.parent,
        frameId,
      );

      const loopElementId = `loop-${frameId}-${loopId}-${stepIndex}`;
      const loopElement: LayoutElement = {
        id: loopElementId,
        type: 'loop',
        subtype: loopType,
        x: resolvePlacement.x,
        y: resolvePlacement.y,
        width: Math.max(300, resolvePlacement.width), // Ensure decent width for iterations
        height: 150,
        parentId: caller.id, // Parent to caller
        stepId: stepIndex,
        children: [],
        data: {
          loopId,
          loopType,
          currentIteration: 0,
          isActive: true,
          frameId: frameId,
          explanation: explanation,
          endStep: endStep,
          callerId: callerId,
          isControlNode: true, // Anchor for arrows if needed
          initialization: initialization || "",
          condition: condition || "",
          update: update || "",
          // Dual capsule data for redesigned header
          conditionCapsule: {
            value: condition || "",
            status: "pending",
            result: null,
            isActive: false
          },
          updateCapsule: {
            value: update || "",
            isActive: false,
            updateValues: {}
          }
        },
      };

      this.activeLoops.set(loopId, {
        loopId,
        loopType,
        startStep: stepIndex,
        endStep: endStep,
        currentIteration: 0,
        totalIterations: 0,
        elementId: loopElementId,
        parentFrameId: frameId,
        baseScopeDepth: rawScopeDepth,
      });

      this.appendElementToPlacement(ownerFrame, { ...placement, parent: ownerFrame }, loopElement);
      this.markEphemeralControlUsed(frameId, loopScopeDepth, placement.parent.id, stepIndex, stepLine);
      layout.elements.push(loopElement);
      this.elementHistory.set(loopElementId, loopElement);
      this.createdInStep.set(loopElementId, stepIndex);

      // Hierarchy link
      caller.children!.push(loopElement);

      // Step 3: Draw the arrow
      this.pushControlArrow(
        `arrow-loop-${loopId}-${stepIndex}`,
        stepIndex,
        caller.x + caller.width,
        caller.y + caller.height / 2,
        loopElement.x,
        loopElement.y + 25, // Anchor tip to Loop header midpoint
        {
          kind: "loop_to_body",
          sourceNodeId: caller.id,
          targetNodeId: loopElement.id,
        }
      );

      return;
    }

    // LOOP ITERATION START
    if (stepType === "loop_body_start") {
      const { loopId, iteration } = step as any;
      const loopState = this.activeLoops.get(loopId);
      
      if (loopState) {
        loopState.currentIteration = iteration;
        const loopElement = this.elementHistory.get(loopState.elementId!)!;
        
        if (loopElement && loopElement.data) {
          loopElement.data.currentIteration = iteration;
          loopElement.data.isActive = true;
          loopElement.data.isConditionStep = false; // Reset condition highlight
          loopElement.data.isUpdateStep = false; // Reset update highlight
          loopElement.stepId = stepIndex;
        }

        // TOGGLE MODE CHECK
        const { toggleMode } = useLoopStore.getState();
        
         if (toggleMode) {
             // EXPANDED MODE (Toggle ON): Create new Iteration Container
             const iterationId = `iter-${loopId}-${iteration}-${stepIndex}`;
             
             const iterationElement: LayoutElement = {
                 id: iterationId,
                 type: 'loop', // We use 'loop' type but subtype 'iteration'
                 subtype: 'iteration',
                 x: loopElement.x + 20,
                 y: this.getNextCursorY(loopElement),
                 width: loopElement.width - 40,
                 height: 40, // Will grow
                 parentId: loopElement.id,
                stepId: stepIndex,
                children: [],
                data: {
                    iteration: iteration
                }
            };
            
            loopElement.children!.push(iterationElement);
            this.elementHistory.set(iterationId, iterationElement);
            loopState.currentIterationElementId = iterationId;
            
            // REGISTER iteration as active container for subsequent steps
            const loopScopeDepth = this.getScopeDepth(step, frameId);
            this.setActiveControlForDepth(frameId, loopScopeDepth + 1, iterationId);
            this.currentScopeDepth.set(frameId, loopScopeDepth + 1);

            const ownerFrame = this.functionFrames.get(loopState.parentFrameId);
            if (ownerFrame) {
              this.bumpFrameLocalsCursorToInclude(
                ownerFrame,
                iterationElement.y + iterationElement.height,
              );
            }
        } else {
            // UPDATE MODE (Toggle OFF): Reuse loop container as parent
            loopState.currentIterationElementId = undefined;
            const loopScopeDepth = this.getScopeDepth(step, frameId);
            this.setActiveControlForDepth(frameId, loopScopeDepth + 1, loopElement.id);
            this.currentScopeDepth.set(frameId, loopScopeDepth + 1);
        }
        
       }
       return;
     }

    // Legacy conditional handling removed: all condition events are processed in processControlStep.

    // LOOP CONDITION
    if (stepType === "loop_condition") {
      const { loopId, result } = step as any;
      const loopState = this.activeLoops.get(loopId);
      
      if (loopState) {
        const loopScopeDepth = loopState.baseScopeDepth;
        this.setActiveControlForDepth(
          frameId,
          loopScopeDepth + 1,
          loopState.currentIterationElementId ?? loopState.elementId,
        );
        this.currentScopeDepth.set(frameId, loopScopeDepth + 1);

        const loopElement = this.elementHistory.get(loopState.elementId!);
        if (loopElement && loopElement.data) {
          loopElement.data.conditionResult = result === 1;
          loopElement.data.isConditionStep = true;
          loopElement.data.isUpdateStep = false; // Reset update highlight
          loopElement.stepId = stepIndex; // Crucial for camera focus
          
          // Update condition capsule
          if (loopElement.data.conditionCapsule) {
            loopElement.data.conditionCapsule.isActive = true;
            loopElement.data.conditionCapsule.result = result === 1;
            loopElement.data.conditionCapsule.status = result === 1 ? "true" : "false";
          }
        }
      }
      return;
    }

    // LOOP ITERATION END
    if (stepType === "loop_iteration_end") {
      const { loopId, iteration } = step as any;
      const loopState = this.activeLoops.get(loopId);
      
      if (loopState) {
        loopState.totalIterations = Math.max(loopState.totalIterations, iteration);
        
        const loopElement = this.elementHistory.get(loopState.elementId!);
        if (loopElement && loopElement.data) {
          loopElement.data.totalIterations = loopState.totalIterations;
        }
      }
      return;
    }

    // LOOP END
    if (stepType === "loop_end") {
        const { loopId } = step as any;
        const loopState = this.activeLoops.get(loopId);
        if (loopState) {
            loopState.endStep = stepIndex;
            const loopEl = this.elementHistory.get(loopState.elementId!);
            if (loopEl && loopEl.data) {
                loopEl.data.isActive = false;
            }
            this.activeLoops.delete(loopId);
        }
        return;
    }
  }

  private static updateCameraFocus(step: ExecutionStep, layout: Layout, stepIndex: number): void {
      const stepType = String((step as any).eventType || step.type || "").toLowerCase();
      
      // CAMERA PERSISTENCE
      // Trigger camera centering on key lifecycle events
      const isKeyFocusStep = 
          stepType === 'loop_condition' || 
          stepType === 'loop_body_start' || 
          stepType === 'func_enter' ||
          stepType === 'condition';

      if (isKeyFocusStep) {
          const frameId = (step as any).frameId;
          const ownerFrame = this.functionFrames.get(frameId);
          
          if (ownerFrame) {
              // We don't have direct access to the camera object here, 
              // but we can tag the layout or element for the UI to center on.
              (layout as any).cameraFocusElementId = ownerFrame.id;
          }
      }

      if (stepType === 'loop_condition') {
          const loopId = (step as any).loopId;
          const loopState = this.activeLoops.get(loopId);
          if (loopState?.elementId) {
              const loopEl = this.elementHistory.get(loopState.elementId);
              if (loopEl) {
                  loopEl.data.isActive = true;
                  loopEl.data.activeStepId = stepIndex;
                  loopEl.stepId = stepIndex;
                  (layout as any).cameraFocusElementId = loopEl.id;
              }
          }
      }
  }

  private static createArrayPanel(layout: Layout, currentStep: number): void {
    const arrays = this.arrayTracker.getAllArrays(currentStep);

    if (arrays.length === 0) {
      layout.arrayPanel = null;
      return;
    }

    const arrayPanelX =
      MAIN_FUNCTION_X +
      MAIN_FUNCTION_WIDTH +
      PANEL_GAP * 2 +
      FUNCTION_BOX_WIDTH * 2;
    const arrayPanelY = MAIN_FUNCTION_Y;

    layout.arrayPanel = {
      id: "array-panel",
      type: "array_panel",
      x: arrayPanelX,
      y: arrayPanelY,
      width: 400,
      height: 200,
      children: [],
      data: { arrays },
      stepId: 0,
    };
  }

  private static createArrayUpdateArrow(
    layout: Layout,
    arrayName: string,
    indices: number[],
    stepIndex: number,
    frameId: string,
  ): void {
    if (!layout.arrayPanel) return;

    let varElement: LayoutElement | undefined;

    const ownerFrame = this.functionFrames.get(frameId);
    if (ownerFrame && ownerFrame.children) {
      for (const child of ownerFrame.children) {
        if (
          (child.type === "variable" || child.type === "heap_pointer") &&
          (child.data?.name === arrayName || child.data?.aliasOf === arrayName)
        ) {
          varElement = child;
          break;
        }
      }
    }

    const fromX = varElement
      ? varElement.x + varElement.width
      : ownerFrame
        ? ownerFrame.x + ownerFrame.width
        : MAIN_FUNCTION_X + MAIN_FUNCTION_WIDTH;
    const fromY = varElement
      ? varElement.y + varElement.height / 2
      : ownerFrame
        ? ownerFrame.y + 100
        : MAIN_FUNCTION_Y + 100;

    const ARRAY_PANEL_HEADER = 50;
    const ARRAY_BOX_HEADER = 50;
    const ARRAY_BOX_PADDING = 12;
    const CELL_WIDTH = 60;
    const CELL_HEIGHT = 50;

    const firstCellX = layout.arrayPanel.x + ARRAY_BOX_PADDING + CELL_WIDTH / 2;
    const firstCellY =
      layout.arrayPanel.y +
      ARRAY_PANEL_HEADER +
      ARRAY_BOX_HEADER +
      ARRAY_BOX_PADDING +
      CELL_HEIGHT / 2;

    const arrow: LayoutElement = {
      id: `arrow-${arrayName}-${stepIndex}`,
      type: "array_reference",
      subtype: "update_arrow",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      stepId: stepIndex,
      data: {
        arrayName,
        indices,
        fromX,
        fromY,
        toX: firstCellX,
        toY: firstCellY,
      },
    };

    if (!this.updateArrows.has(stepIndex)) {
      this.updateArrows.set(stepIndex, []);
    }
    this.updateArrows.get(stepIndex)!.push(arrow);
  }

  private static createUpdateArrows(layout: Layout, currentStep: number): void {
    layout.updateArrows = this.updateArrows.get(currentStep) || [];
  }

  private static positionGlobalPanel(layout: Layout): void {
    if (layout.arrayPanel) {
      layout.globalPanel.x = layout.arrayPanel.x;
      layout.globalPanel.y =
        layout.arrayPanel.y + layout.arrayPanel.height + PANEL_GAP;
    } else {
      layout.globalPanel.x = MAIN_FUNCTION_X + MAIN_FUNCTION_WIDTH + PANEL_GAP;
      layout.globalPanel.y = MAIN_FUNCTION_Y;
    }
  }

  private static createArrayReferences(
    layout: Layout,
    currentStep: number,
  ): void {
    if (!layout.arrayPanel) return;

    const arrayRefVars = layout.elements.filter(
      (el) =>
        (el.metadata?.referencesArray || el.data?.aliasOf) &&
        el.stepId !== undefined &&
        el.stepId <= currentStep,
    );

    const ARRAY_PANEL_HEADER = 50;
    const ARRAY_BOX_HEADER = 50;
    const ARRAY_BOX_PADDING = 12;
    const CELL_WIDTH = 60;
    const CELL_HEIGHT = 50;

    arrayRefVars.forEach((refVar) => {
      const arrayName =
        refVar.metadata?.referencesArray || refVar.data?.aliasOf;
      const array = layout.arrayPanel!.data?.arrays?.find(
        (arr: any) => arr.name === arrayName,
      );

      if (array) {
        const firstCellX =
          layout.arrayPanel!.x + ARRAY_BOX_PADDING + CELL_WIDTH / 2;
        const firstCellY =
          layout.arrayPanel!.y +
          ARRAY_PANEL_HEADER +
          ARRAY_BOX_HEADER +
          ARRAY_BOX_PADDING +
          CELL_HEIGHT / 2;

        const refArrow: LayoutElement = {
          id: `ref-${refVar.id}-${arrayName}`,
          type: "array_reference",
          subtype: "reference_arrow",
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          stepId: refVar.stepId,
          data: {
            fromElement: refVar.id,
            toArray: array.id || arrayName,
            variableName: refVar.data.name,
            arrayName: arrayName,
            fromX: refVar.x + refVar.width,
            fromY: refVar.y + refVar.height / 2,
            toX: firstCellX,
            toY: firstCellY,
          },
        };

        layout.arrayReferences.push(refArrow);
      }
    });
  }


  private static getEffectiveBottom(element: LayoutElement): number {
    let maxBottom = element.y + element.height;
    if (!element.children || element.children.length === 0) {
      return maxBottom;
    }

    element.children.forEach((child) => {
      if (this.shouldIgnoreChildForParentFlow(element, child)) {
        return;
      }
      maxBottom = Math.max(maxBottom, this.getEffectiveBottom(child));
    });

    return maxBottom;
  }

  /**
   * Validates that all children fit within their parent bounds.
   * Only runs in development mode.
   */
  private static validateLayout(layout: Layout): void {
    const checkBounds = (element: LayoutElement, depth: number = 0) => {
      if (!element.children || element.children.length === 0) {
        return;
      }
      
      const indent = '  '.repeat(depth);
      
      element.children.forEach(child => {
        // Calculate boundaries
        const childTop = child.y;
        const childBottom = child.y + child.height;
        const parentTop = element.y;
        const parentBottom = element.y + element.height;
        
        // Check vertical bounds
        if (childTop < parentTop) {
          console.warn(
            `${indent}⚠️ LAYOUT: Child "${child.id}" (top: ${childTop}) ` +
            `starts above parent "${element.id}" (top: ${parentTop})`
          );
        }
        
        if (childBottom > parentBottom) {
          const overflow = childBottom - parentBottom;
          console.warn(
            `${indent}⚠️ LAYOUT: Child "${child.id}" (bottom: ${childBottom}) ` +
            `exceeds parent "${element.id}" (bottom: ${parentBottom}) ` +
            `by ${overflow.toFixed(1)}px`
          );
        }
        
        // Recurse into grandchildren
        checkBounds(child, depth + 1);
      });
    };
    
    // Check all top-level containers
    console.log('🔍 Validating Layout...');
    checkBounds(layout.mainFunction, 0);
    checkBounds(layout.globalPanel, 0);
    
    layout.elements.forEach(element => {
      if (element.type === 'function_call' || 
          element.type === 'loop' || 
          element.type === 'condition') {
        checkBounds(element, 0);
      }
    });
    
    console.log('✅ Layout validation complete');
  }

  private static updateContainerHeights(layout: Layout): void {
    const updateHeight = (element: LayoutElement): number => {
      // Sort children by step (preserves their calculated positions)
      if (element.children && element.children.length > 0) {
        this.sortChildrenByStep(element.children);
      }
      
      // If has lanes, calculate based on lanes (lane-aware elements)
      if (element.metadata && element.metadata.lanes) {
        const lanes = element.metadata.lanes;
        const laneContentHeight = lanes.HEADER.usedHeight + 
                            lanes.PARAMS.usedHeight + 
                            lanes.LOCALS.usedHeight + 
                            lanes.RETURN.usedHeight;
        
        // Safety: Also check actual flow children bottoms in case some aren't in lanes
        let maxChildBottom = element.y;
        if (element.children) {
          element.children.forEach(child => {
            if (!this.shouldIgnoreChildForParentFlow(element, child)) {
              maxChildBottom = Math.max(maxChildBottom, updateHeight(child));
            }
          });
        }
        
        const contentHeight = Math.max(laneContentHeight, maxChildBottom - element.y);
        const newHeight = Math.max(element.height, contentHeight + 40);
        element.height = newHeight;
        return element.y + newHeight;
      }
      
       // No children - return current bottom edge
       if (!element.children || element.children.length === 0) {
         return element.y + element.height;
       }

       const flowChildren = element.children.filter(
         (child) => !this.shouldIgnoreChildForParentFlow(element, child),
       );
       if (flowChildren.length === 0) {
         return element.y + element.height;
       }

       // Recursively update child heights first
       let maxChildBottom = element.y + this.getBodyOffsetY(element);
       
       flowChildren.forEach((child) => {
         const childBottom = updateHeight(child);  // Recurse
         maxChildBottom = Math.max(maxChildBottom, childBottom);
       });

      // Calculate parent height to contain all children
      // maxChildBottom is the absolute Y of the bottom-most child
      // element.y is the absolute Y of this element's top
      // Difference gives us the required height
      const requiredHeight = maxChildBottom - element.y + ELEMENT_SPACING;
      
      element.height = Math.max(
        80,  // Minimum height
        requiredHeight
      );

      return element.y + element.height;
    };

    updateHeight(layout.mainFunction);
    updateHeight(layout.globalPanel);
    if (layout.arrayPanel) {
      updateHeight(layout.arrayPanel);
    }

    // *** NEW: Update all function frames ***
    layout.elements.forEach((element) => {
      if (element.type === 'function_call' || element.type === 'struct' || element.type === 'class' || element.type === 'loop' || element.type === 'condition') {
        updateHeight(element);
      }
    });
  }

  private static isRightFlowControlNode(element: LayoutElement): boolean {
    // Callers are never right-flow nodes; they stay in the vertical sequence.
    if (element.type === "loop_caller" || element.type === "condition_caller" || element.type === "call_site") {
      return false;
    }
    if (element.data?.controlRole === "caller") {
      return false;
    }

    if (element.type === "condition" && element.data?.controlKind) return true;
    if (element.type === "loop" && element.subtype !== "iteration") return true;
    return false;
  }

  /**
   * Consolidates searching for an element within a loop container.
   * Handles both Update Mode (Toggle OFF) and Expanded Mode (Toggle ON).
   */
  private static findLoopChildElement(loopElementId: string, type: string, key?: string): LayoutElement | null {
    const loopElement = this.elementHistory.get(loopElementId);
    if (!loopElement || !loopElement.children) return null;
    
    // 1. Check direct children (for Update Mode / !toggleMode)
    const directChild = loopElement.children.find(child => {
      if (child.type !== type) return false;
      if (type === 'variable') return child.data?.name === key;
      if (type === 'output') return child.data?.text === key;
      if (type === 'input') return child.data?.varName === key;
      return false;
    });
    if (directChild) return directChild;

    // 2. Check within iterations (for Expanded Mode / toggleMode)
    for (const iter of loopElement.children) {
      if (iter.subtype === 'iteration' && iter.children) {
        const nestedChild = iter.children.find(child => {
          if (child.type !== type) return false;
          if (type === 'variable') return child.data?.name === key;
          if (type === 'output') return child.data?.text === key;
          if (type === 'input') return child.data?.varName === key;
          return false;
        });
        if (nestedChild) return nestedChild;
      }
    }

    return null;
  }

  private static shouldIgnoreChildForParentFlow(
    parent: LayoutElement,
    child: LayoutElement,
  ): boolean {
    if (!child) return false;

    // Connector elements must never affect container bounds.
    if (
      child.type === "array_reference" ||
      child.subtype === "control_arrow" ||
      child.subtype === "function_arrow" ||
      child.subtype === "connector_path"
    ) {
      return true;
    }

    // Right-flow branches are not vertical content inside parent containers.
    if (this.isRightFlowControlNode(child) && child.x >= parent.x + parent.width) {
      return true;
    }

    if (child.x > parent.x + MAX_PARENT_FLOW_WIDTH) {
      return true;
    }

    return false;
  }
}

