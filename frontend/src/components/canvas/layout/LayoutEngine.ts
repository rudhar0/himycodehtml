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
    | "call_site";
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
  private static frameDepthMap: Map<string, number> = new Map();
  private static frameOrderMap: Map<string, number> = new Map();
  private static frameOrder: number = 0;

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
  }> = new Map();

  private static activeConditions: Map<string, {
    conditionId: string;
    conditionType: 'if' | 'if-else' | 'if-else-if' | 'switch';
    startStep: number;
    endStep?: number;
    elementId?: string;
    parentFrameId: string;
    conditionResult?: boolean;
    branchTaken?: string;
  }> = new Map();

  // ============================================
  // LANE MANAGEMENT
  // ============================================
  private static getLane(frame: LayoutElement, laneName: string): LaneState {
    if (!frame.metadata) frame.metadata = {};
    if (!frame.metadata.lanes) {
      // Initialize lanes if they don't exist
      frame.metadata.lanes = {
        HEADER: { startY: 0, usedHeight: HEADER_HEIGHT },
        PARAMS: { startY: HEADER_HEIGHT, usedHeight: 0 },
        LOCALS: { startY: HEADER_HEIGHT, usedHeight: 0 }, 
        RETURN: { startY: HEADER_HEIGHT, usedHeight: 0 },
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
    for (const loop of this.activeLoops.values()) {
      if (loop.parentFrameId === frameId) {
        return loop;
      }
    }
    return null;
  }

  /**
   * Find a child element inside a loop by variable name
   * Used for toggle mode to update existing elements
   */
  private static findLoopChildElement(loopElementId: string, varName: string) {
    const loopElement = this.elementHistory.get(loopElementId);
    if (!loopElement || !loopElement.children) return null;
    
    return loopElement.children.find(
      child => child.data?.name === varName
    );
  }

  // NEW METHOD: Sort children by stepId
  private static sortChildrenByStep(children: LayoutElement[]): void {
    children.sort((a, b) => {
      const aStep = a.stepId ?? a.data?.birthStep ?? 0;
      const bStep = b.stepId ?? b.data?.birthStep ?? 0;
      return aStep - bStep;
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
    let returnValue = step.returnValue ?? step.value;
    
    if (returnValue === undefined) {
      for (let i = stepIndex - 1; i >= 0; i--) {
        const prevStep = executionTrace.steps[i] as any;
        if (prevStep.frameId !== frameId) break;
        if (prevStep.eventType === 'var_assign' && 
            (prevStep.name === 'result' || prevStep.name === 'sum')) {
          returnValue = prevStep.value;
          break;
        }
      }
    }
    
    return returnValue;
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
    this.frameDepthMap.clear();
    this.frameOrderMap.clear();
    this.frameOrder = 0;

    this.functionFrames.set("main-0", layout.mainFunction);
    this.frameDepthMap.set("main-0", 0);
    this.frameOrderMap.set("main-0", this.frameOrder++);

    for (
      let i = 0;
      i <= currentStep && i < executionTrace.steps.length;
      i++
    ) {
      const step = executionTrace.steps[i];
      this.processStep(step, layout, i, currentStep, executionTrace);
    }

    this.createArrayPanel(layout, currentStep);
    this.positionGlobalPanel(layout);
    this.createArrayReferences(layout, currentStep);
    this.createUpdateArrows(layout, currentStep);
    this.updateContainerHeights(layout);
    layout.functionArrows = this.functionArrows;

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
        const funcX = baseX + (callDepth - 1) * (FUNCTION_BOX_WIDTH + 60);
        const orderIndex = this.frameOrderMap.get(frameId) || 0;
        const funcY =
          MAIN_FUNCTION_Y + (orderIndex - 1) * FUNCTION_VERTICAL_SPACING;
        
        // Extract parameters
        const parameters = this.extractParameters(executionTrace, frameId, stepIndex);
        
        // Determine arrow source
        let arrowFromX = parentFrame ? parentFrame.x + parentFrame.width : 0;
        let arrowFromY = parentFrame ? parentFrame.y + 75 : 0;

        if (parentFrame) {
          // Check if previous step was var_declare (inline call)
          const prevStep = stepIndex > 0 ? executionTrace.steps[stepIndex - 1] : null;
          const isInlineCall = prevStep && 
                              (prevStep as any).eventType === 'var_declare' &&
                              (prevStep as any).frameId === parentFrameId;

          if (!isInlineCall) {
            // Create standalone call_site
            const indent = getIndentSize(parentFrame);
            const lane = this.getLane(parentFrame, 'LOCALS');
            
            const callElement: LayoutElement = {
              id: `call-${parentFrameId}-to-${frameId}`,
              type: "call_site",
              subtype: "standalone",
              x: parentFrame.x + indent,
              y: parentFrame.y + lane.startY + lane.usedHeight,
              width: parentFrame.width - indent * 2,
              height: 50,
              parentId: parentFrame.id,
              stepId: stepIndex,
              data: {
                functionName: functionName,
                args: "()",
                targetFrameId: frameId
              }
            };
            
            lane.usedHeight += callElement.height + ELEMENT_SPACING;
            
            parentFrame.children?.push(callElement);
            layout.elements.push(callElement);
            this.elementHistory.set(callElement.id, callElement);
            
            arrowFromX = callElement.x + callElement.width;
            arrowFromY = callElement.y + callElement.height / 2;
          } else {
            // Arrow from variable
            const varId = `var-${parentFrameId}-${(prevStep as any).name || (prevStep as any).symbol}-${stepIndex - 1}`;
            const varElement = this.elementHistory.get(varId);
            if (varElement) {
              arrowFromX = varElement.x + varElement.width;
              arrowFromY = varElement.y + varElement.height / 2;
            }
          }
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
              toX: funcX,
              toY: funcY + 75,
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

      // *** NEW: Get return value properly ***
      const returnValue = this.getReturnValue(executionTrace, frameId, stepIndex);
      const functionName = (step as any).function;

      if (funcFrame) {
        const lane = this.getLane(funcFrame, 'RETURN');
        const indent = getIndentSize(funcFrame);
        
        const returnElement: LayoutElement = {
          id: `return-${frameId}-${stepIndex}`,
          type: "function_return",
          x: funcFrame.x + indent,
          y: funcFrame.y + lane.startY + lane.usedHeight,
          width: funcFrame.width - indent * 2,
          height: 70, // *** CHANGED: was 60 ***
          stepId: stepIndex,
          parentId: funcFrame.id,
          data: {
            frameId: frameId,
            functionName: functionName,
            returnValue: returnValue, // *** NEW: Proper value ***
            explanation: `return ${returnValue ?? 'void'}`,
          },
        };
        
        lane.usedHeight += returnElement.height + ELEMENT_SPACING;

        funcFrame.children?.push(returnElement);
        layout.elements.push(returnElement);
        this.elementHistory.set(returnElement.id, returnElement);
      }
      return;
    }

    const ownerFrame = this.functionFrames.get(frameId);
    if (!ownerFrame) {
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

      // LANE: LOCALS (or PARAMS if new)
      const indent = getIndentSize(ownerFrame);
      const laneName = 'LOCALS';
      const lane = this.getLane(ownerFrame, laneName);
      
      const elementHeight = explanation ? VARIABLE_HEIGHT + EXPLANATION_HEIGHT : VARIABLE_HEIGHT;
      
      // CHECK FOR ACTIVE LOOP PARENT
      const activeLoop = this.getActiveLoopForFrame(frameId);
      
      const varElement: LayoutElement = {
        id: varId,
        type: "variable",
        subtype: "variable_load",
        x: activeLoop 
           ? this.elementHistory.get(activeLoop.elementId!)!.x + 20 
           : ownerFrame.x + indent,
        y: activeLoop 
           ? this.getNextCursorY(this.elementHistory.get(activeLoop.elementId!)!) 
           : ownerFrame.y + lane.startY + lane.usedHeight,
        width: (activeLoop 
           ? this.elementHistory.get(activeLoop.elementId!)!.width 
           : ownerFrame.width - indent * 2) - 40,
        height: elementHeight,
        parentId: activeLoop ? activeLoop.elementId : ownerFrame.id,
        stepId: stepIndex,
        data: {
            ...variable,
            explanation: explanation,
        },
      };

      if (activeLoop) {
        // CHECK FOR ITERATION CONTAINER (Expanded Mode)
        if (activeLoop.currentIterationElementId) {
             const iterationElement = this.elementHistory.get(activeLoop.currentIterationElementId)!;
             iterationElement.children!.push(varElement);
        } else {
             // Add to loop container (Collapsed Mode)
             const loopElement = this.elementHistory.get(activeLoop.elementId!)!;
             loopElement.children!.push(varElement);
        }
        // We don't increment lane height here because loop height will grow dynamically
      } else {
        lane.usedHeight += varElement.height + ELEMENT_SPACING;
        ownerFrame.children!.push(varElement);
      }

      layout.elements.push(varElement);
      this.elementHistory.set(varId, varElement);
      this.createdInStep.set(varId, stepIndex);
      
      if (ownerFrame.type === "function_call" && ownerFrame.data) {
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

      // Check if we're in toggle mode and inside a loop
      const { toggleMode } = useLoopStore.getState();
      const currentLoop = this.getActiveLoopForFrame(frameId);

      if (currentLoop && toggleMode) {
        // Try to find existing element with this variable name
        const existingElement = this.findLoopChildElement(currentLoop.elementId!, varName);
        
        if (existingElement) {
          // UPDATE existing element instead of creating new one
          existingElement.data.value = value;
          existingElement.data.isUpdated = true;
          existingElement.stepId = stepIndex;
          this.createdInStep.set(existingElement.id, stepIndex); // Update "created" step to current for animation focus
          return; // Don't create new element
        }
      }

      const varId = `var-${frameId}-${varName}-${stepIndex}`;

      // NEW: Detect if this is a function return assignment
      // Look for function exit in previous steps
      const isFunctionReturnAssignment = 
        stepIndex > 0 && 
        executionTrace.steps[stepIndex - 1]?.eventType === 'func_exit';

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

      const indent = getIndentSize(ownerFrame);
      
      // Calculate height based on explanation and function call
      const baseHeight = VARIABLE_HEIGHT;
      const hasExplanation = !!explanation;
      const hasFunctionCall = isFunctionReturnAssignment;
      
      // If function call, add extra space for inline call element
      const extraHeight = (hasExplanation ? EXPLANATION_HEIGHT : 0) + 
                         (hasFunctionCall ? 60 : 0); // 60px for inline call
      const elementHeight = baseHeight + extraHeight;
      
      const activeLoop = this.getActiveLoopForFrame(frameId);

      const varElement: LayoutElement = {
        id: varId,
        type: "variable",
        subtype: isFunctionReturnAssignment ? "variable_with_call" : "variable_load",
        x: activeLoop 
           ? this.elementHistory.get(activeLoop.elementId!)!.x + 20 
           : ownerFrame.x + indent,
        y: activeLoop 
           ? this.getNextCursorY(this.elementHistory.get(activeLoop.elementId!)!) 
           : this.getNextCursorY(ownerFrame),
        width: (activeLoop 
           ? this.elementHistory.get(activeLoop.elementId!)!.width 
           : ownerFrame.width - indent * 2) - 40,
        height: elementHeight,
        parentId: activeLoop ? activeLoop.elementId : ownerFrame.id,
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

      if (activeLoop) {
        // CHECK FOR ITERATION CONTAINER (Expanded Mode)
        if (activeLoop.currentIterationElementId) {
             const iterationElement = this.elementHistory.get(activeLoop.currentIterationElementId)!;
             iterationElement.children!.push(varElement);
        } else {
             const loopElement = this.elementHistory.get(activeLoop.elementId!)!;
             loopElement.children!.push(varElement);
        }
      } else {
        ownerFrame.children!.push(varElement);
      }

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

        const indent = getIndentSize(ownerFrame);
        const elementHeight = explanation ? VARIABLE_HEIGHT + EXPLANATION_HEIGHT : VARIABLE_HEIGHT;
        const ptrElement: LayoutElement = {
          id: ptrId,
          type: "heap_pointer",
          subtype: decayedFromArray ? "array_alias" : "pointer",
          x: ownerFrame.x + indent,
          y: this.getNextCursorY(ownerFrame),
          width: ownerFrame.width - indent * 2,
          height: elementHeight,
          parentId: ownerFrame.id,
          stepId: stepIndex,
          data: {
            ...pointerData,
            explanation: explanation,
          },
          metadata: {
            referencesArray: aliasOf,
          },
        };

        ownerFrame.children!.push(ptrElement);
        layout.elements.push(ptrElement);
        this.elementHistory.set(ptrId, ptrElement);
        this.createdInStep.set(ptrId, stepIndex);
      }
      return;
    }

    // Handle pointer dereference write events to update pointer value display
    if (stepType === "pointer_deref_write") {
      const { name, symbol, value } = step as any;
      const ptrName = name || symbol;
      if (!ptrName) return;

      const ptrId = `ptr-${frameId}-${ptrName}`;
      if (this.elementHistory.has(ptrId)) {
        const existingElement = this.elementHistory.get(ptrId)!;
        existingElement.data = {
          ...existingElement.data,
          // Store written value as string for UI consistency
          value: value !== undefined ? String(value) : undefined,
        };
      }
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

        const indent = getIndentSize(ownerFrame);
        const varElement: LayoutElement = {
          id: varId,
          type: "variable",
          subtype: "array_reference",
          x: ownerFrame.x + indent,
          y: this.getNextCursorY(ownerFrame),
          width: ownerFrame.width - indent * 2,
          height: VARIABLE_HEIGHT,
          parentId: ownerFrame.id,
          stepId: stepIndex,
          data: arrayRefVar,
          metadata: {
            referencesArray: arrayName,
          },
        };

        ownerFrame.children!.push(varElement);
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
      if (this.elementHistory.has(outputId)) return;

      const indent = getIndentSize(ownerFrame);
      const baseHeight = 60;
      const elementHeight = explanation ? baseHeight + EXPLANATION_HEIGHT : baseHeight;
      const outputElement: LayoutElement = {
        id: outputId,
        type: "output",
        x: ownerFrame.x + indent,
        y: this.getNextCursorY(ownerFrame),
        width: ownerFrame.width - indent * 2,
        height: elementHeight,
        parentId: ownerFrame.id,
        stepId: stepIndex,
        data: {
          text: (step as any).text || (step as any).rawText,
          rawText: (step as any).rawText,
          frameId: frameId,
          explanation: explanation,
        },
      };

      ownerFrame.children!.push(outputElement);
      layout.elements.push(outputElement);
      this.elementHistory.set(outputId, outputElement);
      return;
    }

    // LOOP START
    if (stepType === "loop_start") {
      const { loopId, loopType } = step as any;
      const ownerFrame = this.functionFrames.get(frameId);
      if (!ownerFrame) return;

      const loopElementId = `loop-${frameId}-${loopId}-${stepIndex}`;
      
      // Look ahead to find end step for skip functionality
      let endStep: number | undefined;
      for (let i = stepIndex + 1; i < executionTrace.steps.length; i++) {
        const s = executionTrace.steps[i] as any;
        if (s.eventType === 'loop_end' && s.loopId === loopId) {
          endStep = i;
          break;
        }
      }

      this.activeLoops.set(loopId, {
        loopId,
        loopType,
        startStep: stepIndex,
        endStep: endStep,
        currentIteration: 0,
        totalIterations: 0,
        elementId: loopElementId,
        parentFrameId: frameId,
      });

      // SYNC WITH STORE
      // We only want to sync if this is the "current" step being processed for the first time
      // to avoid dispatching actions during historical re-renders.
      // However, calculating layout usually implies "current state".
      // We use a small timeout or check if we are near the end of the trace?
      // Better: Just sync. The store handles updates.
      if (stepIndex === currentStep) { // RENAMED
         try {
           useLoopStore.getState().enterLoop({
             loopId,
             loopType,
             currentIteration: 0,
             totalIterations: 0, // Will be updated
             startStepIndex: stepIndex,
             endStepIndex: endStep,
           });
         } catch (e) { console.error("Failed to sync loop start", e); }
      }

      const indent = getIndentSize(ownerFrame);
      const lane = this.getLane(ownerFrame, 'LOCALS');

      const loopElement: LayoutElement = {
        id: loopElementId,
        type: 'loop',
        subtype: loopType,
        x: ownerFrame.x + indent,
        y: ownerFrame.y + lane.startY + lane.usedHeight,
        width: ownerFrame.width - indent * 2,
        height: 150,
        parentId: ownerFrame.id,
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
        },
      };

      ownerFrame.children!.push(loopElement);
      layout.elements.push(loopElement);
      this.elementHistory.set(loopElementId, loopElement);
      this.createdInStep.set(loopElementId, stepIndex);
      
      lane.usedHeight += 60;
      
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
        }

        // TOGGLE MODE CHECK
        const { toggleMode } = useLoopStore.getState();
        
        if (!toggleMode) {
            // EXPANDED MODE: Create new Iteration Container
            const iterationId = `iter-${loopId}-${iteration}-${stepIndex}`;
            
            const iterationElement: LayoutElement = {
                id: iterationId,
                type: 'loop', // We use 'loop' type but subtype 'iteration'
                subtype: 'iteration',
                x: 20, // Relative to Loop Container
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
        } else {
            // COLLAPSED MODE: Reuse loop container, clear specific iteration ID
            loopState.currentIterationElementId = undefined;
        }
        
        if (stepIndex === currentStep) { // RENAMED
           useLoopStore.getState().updateLoopIteration(loopId, iteration);
        }
      }
      return;
    }

    // CONDITIONAL START (SWITCH/IF)
    if (stepType === "conditional_start") {
        const { conditionId, conditionType, expression } = step as any; // Assuming fields
        const frameId = (step as any).frameId;
        const ownerFrame = this.functionFrames.get(frameId);
        if (!ownerFrame) return;

        // Only handle Switch for now as per task, or generic Conditions later
        if (conditionType === 'switch') {
             const switchId = `switch-${conditionId}-${stepIndex}`;
             
             // Check for active loop parent
             const activeLoop = this.getActiveLoopForFrame(frameId);
             
             const indent = getIndentSize(ownerFrame);
             const lane = this.getLane(ownerFrame, 'LOCALS');

             // Determine Parent & Position
             let parent = ownerFrame;
             let relativeX = ownerFrame.x + indent;
             let relativeY = ownerFrame.y + lane.startY + lane.usedHeight;
             let availableWidth = ownerFrame.width - indent * 2;

             if (activeLoop) {
                 const loopEl = this.elementHistory.get(activeLoop.elementId!)!;
                 if (activeLoop.currentIterationElementId) {
                     const iterEl = this.elementHistory.get(activeLoop.currentIterationElementId)!;
                     parent = iterEl;
                     relativeX = iterEl.x + 20; // Relative to Iteration
                     relativeY = this.getNextCursorY(iterEl);
                     availableWidth = iterEl.width - 40;
                 } else {
                     parent = loopEl;
                     relativeX = loopEl.x + 20; // Relative to Loop
                     relativeY = this.getNextCursorY(loopEl);
                     availableWidth = loopEl.width - 40;
                 }
             }

             const switchElement: LayoutElement = {
                 id: switchId,
                 type: 'condition', // Generic type
                 subtype: 'switch',
                 x: activeLoop ? 20 : relativeX, // If in loop, relative coords handled by renderer? 
                 // Wait, LayoutEngine calculates ABSOLUTE x/y usually, unless renderer handles relativity.
                 // Just sticking to absolute X/Y logic or simple relative if parented.
                 // Existing generic logic: `x: ownerFrame.x + indent`.
                 // If activeLoop, we use `this.elementHistory.get(activeLoop.elementId!)!.x + 20`.
                 
                 // Let's rely on standard positioning logic used for variables:
                 // "x: activeLoop ? this.elementHistory.get(activeLoop.elementId!)!.x + 20 : ownerFrame.x + indent"
                 
                 y: activeLoop 
                    ? (activeLoop.currentIterationElementId 
                        ? this.getNextCursorY(this.elementHistory.get(activeLoop.currentIterationElementId!)!) 
                        : this.getNextCursorY(this.elementHistory.get(activeLoop.elementId!)!))
                    : relativeY,
                 
                 x: activeLoop 
                    ? (activeLoop.currentIterationElementId 
                        ? this.elementHistory.get(activeLoop.currentIterationElementId!)!.x + 20 
                        : this.elementHistory.get(activeLoop.elementId!)!.x + 20)
                    : relativeX,

                 width: availableWidth,
                 height: 100,
                 parentId: parent.id,
                 stepId: stepIndex,
                 children: [],
                 data: {
                     expression: expression,
                     conditionId: conditionId
                 }
             };
             
             parent.children!.push(switchElement);
             this.elementHistory.set(switchId, switchElement);
             
             // Update lane used height if not in loop
             if (!activeLoop) {
                 lane.usedHeight += 100 + ELEMENT_SPACING;
             }
             
             // Add to active conditions stack setup if needed, 
             // but 'conditional_branch' usually comes next immediately or nested.
             this.activeConditions.set(conditionId, {
                 conditionId,
                 conditionType,
                 startStep: stepIndex,
                 elementId: switchId,
                 parentFrameId: frameId
             });
        }
        return;
    }

    // CONDITIONAL BRANCH (CASE)
    if (stepType === "conditional_branch") {
        const { conditionId, label, isMatched } = step as any; // Assuming
        const conditionState = this.activeConditions.get(conditionId);
        
        if (conditionState && conditionState.conditionType === 'switch') {
             const switchEl = this.elementHistory.get(conditionState.elementId!)!;
             
             const caseId = `case-${conditionId}-${label}-${stepIndex}`;
             const caseElement: LayoutElement = {
                 id: caseId,
                 type: 'condition',
                 subtype: 'case',
                 x: switchEl.x + 10,
                 y: this.getNextCursorY(switchEl),
                 width: switchEl.width - 20,
                 height: 50,
                 parentId: switchEl.id,
                 stepId: stepIndex,
                 children: [],
                 data: {
                     label: label || 'default',
                     isMatched: isMatched
                 }
             };
             
             switchEl.children!.push(caseElement);
             this.elementHistory.set(caseId, caseElement);
             // We could set this as "Active Scope" for variables?
             // But valid C++ scoping in switch is tricky.
             // For now, let's just make sure variables declared here land in this case?
             // If we want that, we need to track "activeCase".
             
             // Simplification: Variables in switch cases usually have block scope or function scope.
             // If block scope, we'd need `block_enter` logic.
             // User rules: "Variables declared inside an iteration belong ONLY to that iteration". 
             // Switch scoping is similar. 
             // For NOW, variables in cases might just float in the switch if we don't track case scope.
             // We can assume they land in the parent (Switch) or Iteration.
             // Ideally we'd add `currentCaseElementId` to `activeConditions`, 
             // and check `activeConditions` in var_declare.
             // Let's SKIP strictly creating a new scope for now to avoid complexity explosion,
             // unless user explicitly asked for Switch Scoping.
             // User said: "Non-executed cases appear dimmed/skipped".
             // "Only executed case body is visually active".
             
             // If we want visual nesting:
             conditionState.branchTaken = caseId; // Track active branch
        }
        return;
    }

    // LOOP CONDITION
    if (stepType === "loop_condition") {
      const { loopId, result } = step as any;
      const loopState = this.activeLoops.get(loopId);
      
      if (loopState) {
        const loopElement = this.elementHistory.get(loopState.elementId!);
        if (loopElement && loopElement.data) {
          loopElement.data.conditionResult = result === 1;
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
        
        const loopElement = this.elementHistory.get(loopState.elementId!);
        if (loopElement && loopElement.data) {
          loopElement.data.isActive = false;
          loopElement.data.isComplete = true;
        }
        
        this.activeLoops.delete(loopId);
        
        if (stepIndex === currentStep) { // RENAMED
           useLoopStore.getState().exitLoop(loopId);
        }
      }
      return;
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

  private static getNextCursorY(parent: LayoutElement): number {
    if (!parent.children || parent.children.length === 0) {
      return parent.y + HEADER_HEIGHT;
    }
    const lastChild = parent.children[parent.children.length - 1];
    return lastChild.y + lastChild.height + ELEMENT_SPACING;
  }

  private static updateContainerHeights(layout: Layout): void {
    const updateHeight = (element: LayoutElement): number => {
      // *** NEW: Sort children by stepId FIRST ***
      if (element.children && element.children.length > 0) {
        this.sortChildrenByStep(element.children);
        
        // *** NEW: Recalculate Y positions after sorting ***
        let currentY = element.y + HEADER_HEIGHT;
        element.children.forEach(child => {
          child.y = currentY;
          currentY += child.height + ELEMENT_SPACING;
        });
      }
      
      // If has lanes, calculate based on lanes
      if (element.metadata && element.metadata.lanes) {
        const lanes = element.metadata.lanes;
        const contentHeight = lanes.HEADER.usedHeight + 
                            lanes.PARAMS.usedHeight + 
                            lanes.LOCALS.usedHeight + 
                            lanes.RETURN.usedHeight;
        const newHeight = Math.max(element.height, contentHeight + 40);
        element.height = newHeight;
        return element.y + newHeight;
      }
      
      if (!element.children || element.children.length === 0) {
        return element.y + element.height;
      }

      let maxChildBottom = element.y + HEADER_HEIGHT;

      element.children.forEach((child) => {
        const childBottom = updateHeight(child);
        maxChildBottom = Math.max(maxChildBottom, childBottom);
      });

      element.height = Math.max(
        80,
        maxChildBottom - element.y + ELEMENT_SPACING,
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
}
