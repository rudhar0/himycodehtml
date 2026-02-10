// frontend/src/canvas/elements/Output.ts
import { CanvasElement } from '../core/CanvasElement';
import Konva from 'konva';
import { Animation, VariableCreateAnimation, VariableUpdateAnimation } from '../../types/animation.types';
import { COLORS } from '../../config/theme.config';

export class Output extends CanvasElement {
  private textNode: Konva.Text;
  private backgroundRect: Konva.Rect;
  private iconGroup: Konva.Group;

  constructor(id: string, parentId: string, layer: Konva.Layer, payload: any) {
    super(id, parentId, layer);
    this.elementType = 'Output';
    this.subType = 'stdout';
    
    const outputValue = payload.value !== undefined ? String(payload.value) : '';
    const outputText = `Output: ${outputValue}`;

    this.layout = {
      x: 0,
      y: 0,
      width: 500,
      height: 50,
      cursorY: 0,
    };

    // Background with distinct output styling
    this.backgroundRect = new Konva.Rect({
      name: 'box-bg',
      width: this.layout.width,
      height: this.layout.height,
      fill: COLORS.state.success, // Using theme color
      stroke: COLORS.state.active, // Using theme color
      strokeWidth: 2,
      cornerRadius: 8,
      shadowColor: 'rgba(16, 185, 129, 0.3)',
      shadowBlur: 8,
      shadowOpacity: 0.5,
    });

    // Icon group (console/terminal icon)
    this.iconGroup = new Konva.Group({
      x: 15,
      y: 15,
    });

    // Simple console icon (rectangle with lines)
    const iconRect = new Konva.Rect({
      width: 20,
      height: 15,
      fill: COLORS.dark.background.primary, // Using theme color
      stroke: COLORS.dark.background.secondary, // Using theme color
      strokeWidth: 1,
      cornerRadius: 2,
    });

    const iconLine1 = new Konva.Line({
      points: [5, 5, 15, 5],
      stroke: COLORS.dark.text.primary, // Using theme color
      strokeWidth: 1,
    });

    const iconLine2 = new Konva.Line({
      points: [5, 8, 12, 8],
      stroke: COLORS.dark.text.primary, // Using theme color
      strokeWidth: 1,
    });

    this.iconGroup.add(iconRect, iconLine1, iconLine2);

    // Output text
    this.textNode = new Konva.Text({
      name: 'output-text',
      text: outputText,
      x: 45,
      y: 15,
      fontSize: 14,
      fontFamily: 'monospace',
      fill: COLORS.dark.text.primary, // Using theme color
      fontStyle: 'bold',
    });

    // Set initial state for non-animated rendering
    this.container.opacity(1);
    this.container.scaleX(1);
    this.container.scaleY(1);

    this.container.add(this.backgroundRect, this.iconGroup, this.textNode);
  }

  // Non-animating creation: set the final state immediately
  create(payload: any): void {
    console.log('[Output] Creating output (non-animated) with payload:', payload);
    const outputValue = payload.value !== undefined ? String(payload.value) : '';
    this.textNode.text(`Output: ${outputValue}`);
    this.container.opacity(1);
    this.container.scaleX(1);
    this.container.scaleY(1);
  }

  // Non-animating update: set the final state immediately
  update(payload: any): void {
    console.log('[Output] Updating output (non-animated) with payload:', payload);
    if (payload.value !== undefined) {
      this.textNode.text(`Output: ${String(payload.value)}`);
    }
  }

  getCreateAnimation(payload: any): Animation {
    this.container.opacity(0);
    this.container.scaleX(0.9);
    this.container.scaleY(0.9);
    this.create(payload); // Apply final state for text

    const animation: VariableCreateAnimation = { // Re-using for now, consider a specific OutputCreateAnimation
      type: 'variable_create',
      target: this.id,
      duration: 400,
      konvaObject: this.container,
    };
    return animation;
  }

  getUpdateAnimation(payload: any): Animation {
    const oldValue = this.textNode.text();
    this.update(payload); // Apply final state for text
    const newValue = this.textNode.text();

    const animation: VariableUpdateAnimation = { // Re-using VariableUpdateAnimation for now
      type: 'variable_update',
      target: this.id,
      duration: 300,
      from: oldValue,
      to: newValue,
      konvaContainer: this.container,
      valueTextNode: this.textNode,
    };
    return animation;
  }
}
