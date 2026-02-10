// frontend/src/canvas/managers/LayoutManager.ts
import { CanvasElement } from '../core/CanvasElement';

class VerticalFlowLayout {
  place(element: CanvasElement, parent: CanvasElement) {
    if (parent.layout.cursorY === undefined) {
        // Initialize cursor if it doesn't exist. Add padding from parent's top.
        parent.layout.cursorY = 20; 
    }

    element.container.position({
      x: 20, // Children are positioned relative to the parent container
      y: parent.layout.cursorY
    });

    // Update parent's cursor for the next child
    parent.layout.cursorY += element.layout.height + 16; // Add padding
    
    // Expand parent height to contain the new child
    const requiredHeight = parent.layout.cursorY;
    if (parent.layout.height < requiredHeight) {
        parent.layout.height = requiredHeight;
    }
  }
}

export const layoutManager = new VerticalFlowLayout();
