// frontend/src/canvas/renderers/VerticalFlowRenderer.ts
import { MemoryState, Variable as VariableData } from '@types/index';
import Konva from 'konva';
import { ProgramRoot } from '../elements/ProgramRoot';
import { MainFunction } from '../elements/MainFunction';
import { GlobalPanel } from '../elements/GlobalPanel';
import { Variable } from '../elements/Variable';
import { Class } from '../elements/Class';
import { FunctionCall } from '../elements/FunctionCall';
import { VerticalFlowLayout } from '../managers/VerticalFlowLayout';
import { CanvasElement } from '../core/CanvasElement';

export interface CanvasState {
  root: CanvasElement | null;
  mainFunction: CanvasElement | null;
  globalPanel: CanvasElement | null;
  elements: Map<string, CanvasElement>;
  currentStep: number;
}

export class VerticalFlowRenderer {
  private layer: Konva.Layer;
  private state: CanvasState;

  constructor(layer: Konva.Layer) {
    this.layer = layer;
    this.state = {
      root: null,
      mainFunction: null,
      globalPanel: null,
      elements: new Map(),
      currentStep: -1,
    };
    this.initialize();
  }

  public initialize(): void {
    if (this.state.root) {
      this.clearNonRootElements();
      return;
    }
    const root = new ProgramRoot(this.layer);
    this.state.root = root;
    this.state.elements.set(root.id, root);

    const main = new MainFunction(root.id, this.layer);
    VerticalFlowLayout.place(main, root);
    root.addChild(main);
    this.state.mainFunction = main;
    this.state.elements.set(main.id, main);

    const globals = new GlobalPanel(root.id, this.layer);
    globals.container.position({ x: 720, y: 40 });
    globals.layout = { x: 720, y: 40, width: 300, height: 0, cursorY: 60 };
    root.addChild(globals);
    this.state.globalPanel = globals;
    this.state.elements.set(globals.id, globals);
  }

  public renderScene(memoryState: MemoryState, currentStep: number): void {
    console.log(`[VerticalFlowRenderer] Rendering scene for step ${currentStep}`);
    this.clearNonRootElements();

    if (!memoryState) {
        this.layer.draw();
        return;
    }

    // Render globals
    if (memoryState.globals && this.state.globalPanel) {
      for (const variable of Object.values(memoryState.globals)) {
        if (variable.birthStep <= currentStep) {
          this.renderVariable(variable, this.state.globalPanel);
        }
      }
    }

    // Render stack frames
    if (memoryState.callStack && this.state.mainFunction) {
      // We iterate in reverse to draw from top of the stack down
      for (let i = memoryState.callStack.length - 1; i >= 0; i--) {
        const frame = memoryState.callStack[i];
        
        // TODO: This assumes the top-level function is the main entry point.
        const parent = this.state.mainFunction;

        // Create a container for the function frame
        const frameId = `frame-${frame.function}-${i}`;
        const frameElement = new FunctionCall(frameId, parent.id, this.layer, frame);
        VerticalFlowLayout.place(frameElement, parent);
        parent.addChild(frameElement);
        this.state.elements.set(frameId, frameElement);

        for (const variable of Object.values(frame.locals)) {
          if (variable.birthStep <= currentStep) {
            this.renderVariable(variable, frameElement);
          }
        }
        // After adding all locals, update the frame's size
        VerticalFlowLayout.updateParentSize(frameElement);
      }
    }
    
    // TODO: Render heap elements

    this.layer.batchDraw();
    this.state.currentStep = currentStep;
  }

  private renderVariable(variable: VariableData, parent: CanvasElement): void {
    const elementId = `var-${variable.address}`;
    if (this.state.elements.has(elementId)) {
      // Element already exists, maybe update it
      const existingElement = this.state.elements.get(elementId);
      existingElement?.update(variable);
      return;
    }

    let newElement: CanvasElement;

    if (variable.primitive === 'class') {
      newElement = new Class(elementId, parent.id, this.layer, variable);
    } else {
      newElement = new Variable(elementId, parent.id, this.layer, variable);
    }

    VerticalFlowLayout.place(newElement, parent);
    parent.addChild(newElement);
    this.state.elements.set(elementId, newElement);
  }

  public clearNonRootElements(): void {
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
        const parent = this.state.elements.get(element.parentId || '');
        if (parent) {
          parent.children = parent.children.filter(child => child.id !== id);
        }
        element.container.destroy();
        this.state.elements.delete(id);
      }
    });

    if (this.state.mainFunction) this.state.mainFunction.layout.cursorY = 60;
    if (this.state.globalPanel) this.state.globalPanel.layout.cursorY = 60;
  }

  public getElement(id: string): CanvasElement | undefined {
    return this.state.elements.get(id);
  }
}

