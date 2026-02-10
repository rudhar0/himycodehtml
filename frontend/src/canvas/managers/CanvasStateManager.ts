// frontend/src/canvas/managers/CanvasStateManager.ts
/**
 * CanvasStateManager - Deterministic canvas state management
 * 
 * This manager maintains a source-of-truth canvas state that can be rebuilt
 * for any step. It ensures that jumping to any step will correctly render
 * all elements up to that point.
 */

import { CanvasElement } from '../core/CanvasElement';
import { ProgramRoot } from '../elements/ProgramRoot';
import { MainFunction } from '../elements/MainFunction';
import { GlobalPanel } from '../elements/GlobalPanel';
import { Variable } from '../elements/Variable';
import { CanvasArray } from '../elements/CanvasArray';
import { Pointer } from '../elements/Pointer';
import { Loop } from '../elements/Loop';
import { Condition } from '../elements/Condition';
import { Output } from '../elements/Output';
import { ExecutionStep } from '@types/index';
import Konva from 'konva';

const elementFactory: Record<string, any> = {
  variable_declaration: Variable,
  array_declaration: CanvasArray,
  pointer_declaration: Pointer,
  loop_start: Loop,
  conditional_start: Condition,
  output: Output,
};

export interface CanvasState {
  elements: Map<string, CanvasElement>;
  currentStep: number;
  isInitialized: boolean;
}

export class CanvasStateManager {
  private state: CanvasState;
  private layer: Konva.Layer;
  private rootElement: CanvasElement | null = null;

  constructor(layer: Konva.Layer) {
    this.layer = layer;
    this.state = {
      elements: new Map(),
      currentStep: -1,
      isInitialized: false,
    };
  }

  /**
   * Initialize the canvas with root elements (ProgramRoot, MainFunction, GlobalPanel)
   */
  public initialize(): void {
    if (this.state.isInitialized) {
      return;
    }

    console.log('[CanvasStateManager] Initializing root elements...');
    
    const root = new ProgramRoot(this.layer);
    const main = new MainFunction(root.id, this.layer);
    const globals = new GlobalPanel(root.id, this.layer);
    
    root.addChild(main);
    root.addChild(globals);
    
    this.state.elements.set(root.id, root);
    this.state.elements.set(main.id, main);
    this.state.elements.set(globals.id, globals);
    
    this.rootElement = root;
    this.state.isInitialized = true;
    
    console.log('[CanvasStateManager] Root elements initialized');
  }

  /**
   * Rebuild canvas state up to a specific step
   * This is called when jumping to a step or when resuming playback
   */
  public async rebuildToStep(executionTrace: ExecutionStep[], targetStep: number): Promise<void> {
    console.log(`[CanvasStateManager] Rebuilding canvas to step ${targetStep}`);
    
    // Ensure initialized
    if (!this.state.isInitialized) {
      this.initialize();
    }

    // Clear all elements except root elements
    this.clearNonRootElements();

    // Process each step from 0 to targetStep
    for (let stepIndex = 0; stepIndex <= targetStep && stepIndex < executionTrace.length; stepIndex++) {
      const step = executionTrace[stepIndex];
      await this.processStep(step, false); // false = skip animations during rebuild
    }

    this.state.currentStep = targetStep;
    console.log(`[CanvasStateManager] Canvas rebuilt to step ${targetStep}`);
  }

  /**
   * Process a single step and update canvas state
   */
  public async processStep(step: ExecutionStep, animate: boolean = true): Promise<void> {
    if (!this.state.isInitialized) {
      this.initialize();
    }

    const { type, ...payload } = step;
    const parentId = 'main-function'; // This should be dynamic based on call stack
    const parent = this.state.elements.get(parentId);
    
    if (!parent) {
      console.warn(`[CanvasStateManager] Parent element ${parentId} not found`);
      return;
    }

    // Handle element creation
    const ElementClass = elementFactory[type];
    if (ElementClass) {
      let elementId: string;
      
      // Determine ID based on element type
      if (type === 'variable_declaration' || type === 'array_declaration' || type === 'pointer_declaration') {
        elementId = `var-${(payload as any).address || step.id}`;
      } else {
        elementId = `step-${step.id}`;
      }

      // Skip if element already exists (for rebuild scenarios)
      if (this.state.elements.has(elementId)) {
        return;
      }

      const newElement = new ElementClass(elementId, parentId, this.layer, payload);
      
      // Create element (with or without animation)
      if (animate) {
        await newElement.create(payload);
      } else {
        // Create immediately without animation for rebuild
        await newElement.create(payload);
        // Force immediate render
        this.layer.draw();
      }
      
      parent.addChild(newElement);
      this.state.elements.set(elementId, newElement);
      
      // Update parent layout
      parent.update({});
    } 
    // Handle element updates (e.g., assignments)
    else if (type === 'assignment') {
      const varName = (payload as any).name;
      const elementToUpdate = Array.from(this.state.elements.values()).find(
        el => el.elementType === 'Variable' && el.id.includes(varName)
      );
      
      if (elementToUpdate) {
        if (animate) {
          await elementToUpdate.update(payload);
        } else {
          await elementToUpdate.update(payload);
          this.layer.draw();
        }
      }
    }

    this.state.currentStep = step.id;
  }

  /**
   * Clear all elements except root elements (ProgramRoot, MainFunction, GlobalPanel)
   */
  private clearNonRootElements(): void {
    const rootIds = ['program-root', 'main-function', 'global-panel'];
    const elementsToRemove: string[] = [];

    this.state.elements.forEach((element, id) => {
      if (!rootIds.includes(id)) {
        elementsToRemove.push(id);
      }
    });

    elementsToRemove.forEach(id => {
      const element = this.state.elements.get(id);
      if (element) {
        // Remove from parent
        const parent = this.state.elements.get(element.parentId || '');
        if (parent) {
          parent.children = parent.children.filter(child => child.id !== id);
          element.container.destroy();
        }
        this.state.elements.delete(id);
      }
    });

    // Clear children from root elements
    const main = this.state.elements.get('main-function');
    if (main) {
      main.children.forEach(child => {
        if (!rootIds.includes(child.id)) {
          child.container.destroy();
        }
      });
      main.children = [];
    }

    this.layer.draw();
  }

  /**
   * Get current canvas state
   */
  public getState(): CanvasState {
    return {
      elements: new Map(this.state.elements),
      currentStep: this.state.currentStep,
      isInitialized: this.state.isInitialized,
    };
  }

  /**
   * Get element by ID
   */
  public getElement(id: string): CanvasElement | undefined {
    return this.state.elements.get(id);
  }

  /**
   * Get all elements
   */
  public getAllElements(): Map<string, CanvasElement> {
    return new Map(this.state.elements);
  }

  /**
   * Reset canvas to initial state
   */
  public reset(): void {
    this.clearNonRootElements();
    this.state.currentStep = -1;
  }
}

