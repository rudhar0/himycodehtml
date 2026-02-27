// frontend/src/canvas/renderers/VerticalFlowRenderer.ts
import { MemoryState, Variable as VariableData } from '../../types';
import Konva from 'konva';
import { ProgramRoot } from '../elements/ProgramRoot';
import { MainFunction } from '../elements/MainFunction';
import { GlobalPanel } from '../elements/GlobalPanel';
import { Variable } from '../elements/Variable';
import { Class } from '../elements/Class';
import { FunctionCall } from '../elements/FunctionCall';
import { Condition } from '../elements/Condition';
import { Loop } from '../elements/Loop';
import { Output } from '../elements/Output';
import { Input } from '../elements/Input';
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

  public renderScene(tree: any, currentStep: number): void {
    const relationTree = tree as { root: any, nodes: Map<string, any> };
    console.log(`[VerticalFlowRenderer] Rendering scene from RelationTree for step ${currentStep}`);
    this.clearNonRootElements();

    if (!relationTree || !relationTree.nodes) {
        this.layer.draw();
        return;
    }

    // Process nodes by type to render appropriate elements
    // We start from root children to maintain layout order
    const root = relationTree.nodes.get('root');
    if (root) {
      this.renderChildren(root, 'root', relationTree, currentStep);
    }

    this.layer.batchDraw();
    this.state.currentStep = currentStep;
  }

  private renderChildren(parentRelationNode: any, parentCanvasId: string, tree: any, currentStep: number): void {
    const parentElement = this.state.elements.get(parentCanvasId);
    if (!parentElement) return;

    for (const childId of parentRelationNode.children) {
      const node = tree.nodes.get(childId);
      if (!node || node.birthStep > currentStep) continue;
      if (node.deathStep !== null && node.deathStep <= currentStep) continue;

      let canvasElement: CanvasElement | undefined;

      switch (node.type) {
        case 'stack_frame': {
          canvasElement = new FunctionCall(node.id, parentCanvasId, this.layer, node.data);
          break;
        }
        case 'variable':
        case 'pointer': {
          if (node.data.primitive === 'class' || node.data.type?.includes('class')) {
             canvasElement = new Class(node.id, parentCanvasId, this.layer, node.data);
          } else {
             canvasElement = new Variable(node.id, parentCanvasId, this.layer, node.data);
          }
          break;
        }
        case 'array': {
          // Placeholder for Array element if it existed in this renderer's elements
          break;
        }
        case 'condition': {
          canvasElement = new Condition(node.id, parentCanvasId, this.layer, node.data);
          break;
        }
        case 'loop': {
          canvasElement = new Loop(node.id, parentCanvasId, this.layer, node.data);
          break;
        }
        case 'output': {
          canvasElement = new Output(node.id, parentCanvasId, this.layer, node.data);
          break;
        }
        case 'input': {
          canvasElement = new Input(node.id, parentCanvasId, this.layer, node.data);
          break;
        }
        case 'function_return': {
           // Create a return-styled element if it exists, or just use a specialized variable box
           canvasElement = new Variable(node.id, parentCanvasId, this.layer, {
              ...node.data,
              type: 'return',
              isReturn: true
           });
           break;
        }
      }

      if (canvasElement) {
        VerticalFlowLayout.place(canvasElement, parentElement);
        parentElement.addChild(canvasElement);
        this.state.elements.set(node.id, canvasElement);
        
        // Recursively render children of this node
        this.renderChildren(node, node.id, tree, currentStep);
        
        // Update size after children are added
        VerticalFlowLayout.updateParentSize(canvasElement);
      } else if (node.type === 'root' && node.data.isBranchContainer) {
         // It's a branch container, just pass through to its children
         this.renderChildren(node, parentCanvasId, tree, currentStep);
      }
    }
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

