// frontend/src/canvas/elements/Input.ts
import { CanvasElement } from '../core/CanvasElement';
import Konva from 'konva';
import { Animation, VariableCreateAnimation, VariableUpdateAnimation } from '../../types/animation.types';
import { COLORS } from '../../config/theme.config';

export class Input extends CanvasElement {
  private inputText: Konva.Text;
  private backgroundRect: Konva.Rect;
  private iconGroup: Konva.Group;
  private promptText: Konva.Text;
  public inputValue: string | number | null = null;
  public isWaiting: boolean = false;
  public prompt: string = '';
  public format: string = '';
  public expectedType: string = '';

  constructor(id: string, parentId: string, layer: Konva.Layer, payload: any) {
    super(id, parentId, layer);
    this.elementType = 'Input';
    this.subType = 'scanf';
    
    this.prompt = payload.prompt || payload.inputRequest?.prompt || 'Input:';
    this.format = payload.format || payload.inputRequest?.format || '%d';
    this.expectedType = payload.expectedType || payload.inputRequest?.expectedTypes?.[0] || 'int';
    
    const prompt = this.prompt;
    const format = this.format;

    this.layout = {
      x: 0,
      y: 0,
      width: 500,
      height: 60,
      cursorY: 0,
    };

    // Background with distinct input styling
    this.backgroundRect = new Konva.Rect({
      name: 'box-bg',
      width: this.layout.width,
      height: this.layout.height,
      fill: COLORS.state.warning, // Using theme color
      stroke: COLORS.state.highlight, // Using theme color
      strokeWidth: 2,
      cornerRadius: 8,
      shadowColor: 'rgba(249, 115, 22, 0.3)',
      shadowBlur: 8,
      shadowOpacity: 0.5,
    });

    // Icon group (input/scan icon)
    this.iconGroup = new Konva.Group({
      x: 15,
      y: 20,
    });

    // Simple input icon (arrow pointing in)
    const iconArrow = new Konva.Arrow({
      points: [0, 8, 15, 8],
      pointerLength: 6,
      pointerWidth: 6,
      fill: COLORS.flow.pointer.DEFAULT, // Using theme color
      stroke: COLORS.flow.pointer.DEFAULT, // Using theme color
      strokeWidth: 2,
    });

    this.iconGroup.add(iconArrow);

    // Prompt text
    this.promptText = new Konva.Text({
      name: 'prompt-text',
      text: prompt,
      x: 45,
      y: 10,
      fontSize: 12,
      fontFamily: 'monospace',
      fill: COLORS.dark.text.secondary, // Using theme color
    });

    // Input value text (shows entered value or waiting state)
    this.inputText = new Konva.Text({
      name: 'input-value',
      text: 'Waiting for input...',
      x: 45,
      y: 30,
      fontSize: 16,
      fontFamily: 'monospace',
      fill: COLORS.dark.text.primary, // Using theme color
      fontStyle: 'bold',
    });

    // Set initial state for non-animated rendering
    this.container.opacity(1);
    this.container.scaleX(1);
    this.container.scaleY(1);

    this.container.add(this.backgroundRect, this.iconGroup, this.promptText, this.inputText);
  }

  // Non-animating creation: set the final state immediately
  create(payload: any): void {
    console.log('[Input] Creating input (non-animated) with payload:', payload);
    const prompt = payload.prompt || payload.inputRequest?.prompt || 'Input:';
    this.promptText.text(prompt);
    this.inputText.text('Waiting for input...');
    this.isWaiting = true;
    this.container.opacity(1);
    this.container.scaleX(1);
    this.container.scaleY(1);
  }

  // Non-animating update: set the final state immediately
  update(payload: any): void {
    console.log('[Input] Updating input (non-animated) with payload:', payload);
    if (payload.value !== undefined && payload.value !== null) {
      this.inputValue = payload.value;
      this.isWaiting = false;
      this.inputText.text(String(payload.value));
    }
  }

  setValue(value: string | number): void {
    this.inputValue = value;
    this.isWaiting = false;
    this.inputText.text(String(value));
    this.container.draw(); // Assuming this is needed to redraw Konva manually
  }

  getCreateAnimation(payload: any): Animation {
    this.container.opacity(0);
    this.container.scaleX(0.9);
    this.container.scaleY(0.9);
    this.create(payload); // Apply final state for text

    const animation: VariableCreateAnimation = { // Re-using VariableCreateAnimation for now
      type: 'variable_create',
      target: this.id,
      duration: 400,
      konvaObject: this.container,
    };
    return animation;
  }

  getUpdateAnimation(payload: any): Animation {
    const oldValue = this.inputText.text();
    this.update(payload); // Apply final state for text
    const newValue = this.inputText.text();

    const animation: VariableUpdateAnimation = { // Re-using VariableUpdateAnimation for now
      type: 'variable_update',
      target: this.id,
      duration: 300,
      from: oldValue,
      to: newValue,
      konvaContainer: this.container,
      valueTextNode: this.inputText,
    };
    return animation;
  }
}
