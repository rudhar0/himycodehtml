// frontend/src/canvas/managers/VerticalFlowLayout.ts
/**
 * VerticalFlowLayout - Top-to-bottom execution flow layout engine
 * 
 * This manager handles vertical positioning of elements in a parent-child hierarchy.
 * Each parent maintains its own cursorY for stacking children.
 */

import { CanvasElement } from '../core/CanvasElement';
import Konva from 'konva';

export interface LayoutInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  cursorY: number; // Current Y position for next child
  indent?: number; // Indentation level for nested blocks
}

export class VerticalFlowLayout {
  private static readonly ELEMENT_SPACING = 16; // Space between elements
  private static readonly INDENT_SIZE = 20; // Indentation per nesting level

  /**
   * Place an element inside its parent container
   * Updates parent's cursorY for next element
   */
  public static place(element: CanvasElement, parent: CanvasElement | null): void {
    if (!parent) {
      // Root element - position at top
      element.container.position({ x: 40, y: 40 });
      element.layout = {
        x: 40,
        y: 40,
        width: element.layout.width || 600,
        height: element.layout.height || 0,
        cursorY: 60, // Start cursor below header
      };
      return;
    }

    // Calculate position relative to parent
    const indent = (parent.layout.indent || 0) + 1;
    const x = parent.layout.x + (indent * this.INDENT_SIZE);
    const y = parent.layout.cursorY;

    // Position element
    element.container.position({ x, y });
    
    // Update element layout
    element.layout = {
      ...element.layout,
      x,
      y,
      indent,
      cursorY: y + (element.layout.height || 0) + this.ELEMENT_SPACING,
    };

    // Update parent's cursor for next child
    parent.layout.cursorY = y + (element.layout.height || 0) + this.ELEMENT_SPACING;
    
    // Update parent height to contain all children
    const childrenHeight = parent.children.reduce((sum, child) => {
      return sum + (child.layout.height || 0) + this.ELEMENT_SPACING;
    }, 0);
    
    parent.layout.height = Math.max(
      parent.layout.height || 0,
      childrenHeight + 40 // Add padding
    );
  }

  /**
   * Update parent container size to fit all children
   */
  public static updateParentSize(parent: CanvasElement): void {
    if (parent.children.length === 0) {
      return;
    }

    const maxChildY = Math.max(
      ...parent.children.map(child => 
        (child.layout.y || 0) + (child.layout.height || 0)
      )
    );

    parent.layout.height = maxChildY - parent.layout.y + this.ELEMENT_SPACING;
    
    // Update parent's background rect if it exists
    const bgRect = parent.container.findOne<Konva.Rect>('.parent-bg');
    if (bgRect) {
      bgRect.height(parent.layout.height);
    }
  }

  /**
   * Get next cursor position for a parent
   */
  public static getNextCursorY(parent: CanvasElement): number {
    return parent.layout.cursorY || parent.layout.y + 60;
  }
}

