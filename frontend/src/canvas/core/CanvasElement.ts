// frontend/src/canvas/core/CanvasElement.ts
import Konva from 'konva';
import AnimationEngine from '../../animations/AnimationEngine';
import { ElementDestroyAnimation } from '../../types/animation.types';

export interface LayoutInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  cursorY?: number; // Current Y position for next child (for vertical flow)
  indent?: number; // Indentation level for nested blocks
}

export type AnimationType = 'create' | 'update' | 'destroy';

export abstract class CanvasElement {
  id: string;
  elementType: string;
  subType: string;
  parentId: string | null;
  children: CanvasElement[] = [];
  
  container: Konva.Group;
  layer: Konva.Layer;

  layout: LayoutInfo;

  constructor(id: string, parentId: string | null, layer: Konva.Layer) {
    this.id = id;
    this.parentId = parentId;
    this.layer = layer;
    this.container = new Konva.Group({ id });
    this.elementType = 'base';
    this.subType = 'base';
    this.layout = { x: 0, y: 0, width: 0, height: 0 };
    
    this.layer.add(this.container);
  }

  // Methods to set the final state of the element (non-animating)
  abstract create(payload: any): void;
  abstract update(payload: any): void;

  // Methods to describe the animations for creation/update
  abstract getCreateAnimation(payload: any): Animation;
  abstract getUpdateAnimation(payload: any): Animation;
  
  destroy(): Promise<void> {
    return new Promise(resolve => {
        const animation: ElementDestroyAnimation = {
            type: 'element_destroy',
            target: this.id,
            konvaObject: this.container,
            duration: 500, // example duration
        };
        const timeline = AnimationEngine.createSequence([animation]);
        // The onComplete of the destroy animation in Timelines.ts will handle konvaObject.destroy()
        timeline.eventCallback('onComplete', resolve); // Resolve the promise when animation completes
        AnimationEngine.addSequence(timeline);
    });
  }

  addChild(child: CanvasElement) {
    this.children.push(child);
    this.container.add(child.container);
  }
}
