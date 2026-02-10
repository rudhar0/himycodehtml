// frontend/src/canvas/elements/Condition.ts
import { CanvasElement } from "../core/CanvasElement";
import Konva from 'konva';
import { Animation, VariableCreateAnimation, LoopIterationAnimation } from "../../types/animation.types";
import { COLORS } from '../../config/theme.config';

export class Condition extends CanvasElement {
    private background: Konva.Rect;
    private title: Konva.Text;

    constructor(id: string, parentId: string, layer: Konva.Layer, payload: any) {
        super(id, parentId, layer);
        this.elementType = 'Condition';
        this.layout = {
            x: 0,
            y: 0,
            width: 520,
            height: 40, // Will grow
            cursorY: 40,
        };

        this.background = new Konva.Rect({
            width: this.layout.width,
            height: this.layout.height,
            fill: COLORS.flow.control.DEFAULT, // Using theme color
            stroke: COLORS.flow.control.dark, // Using theme color
            strokeWidth: 1,
            cornerRadius: 3,
            id: `${this.id}-background` // Give it an ID
        });

        this.title = new Konva.Text({
            text: `if (${payload.condition})`,
            x: 10,
            y: 10,
            fill: COLORS.dark.text.primary, // Using theme color
            fontFamily: 'monospace',
        });

        this.container.add(this.background, this.title);

        // Set initial state for non-animated rendering
        this.container.opacity(1);
        this.container.scaleX(1);
        this.container.scaleY(1);
    }

    // Non-animating creation: set the final state immediately
    create(payload: any): void {
        console.log('[Condition] Creating condition (non-animated) with payload:', payload);
        this.title.text(`if (${payload.condition})`);
        this.container.opacity(1);
        this.container.scaleX(1);
        this.container.scaleY(1);
    }

    // Non-animating update: set the final state immediately
    update(payload: any): void {
        console.log('[Condition] Updating condition (non-animated) with payload:', payload);
        if (payload.condition) {
            this.title.text(`if (${payload.condition})`);
        }
    }

    getCreateAnimation(payload: any): Animation {
        this.container.opacity(0);
        this.container.scaleX(0.8);
        this.container.scaleY(0.8);
        this.create(payload); // Apply final state for text

        const animation: VariableCreateAnimation = { // Re-using VariableCreateAnimation for now
            type: 'variable_create', 
            target: this.id,
            duration: 500,
            konvaObject: this.container,
        };
        return animation;
    }

    getUpdateAnimation(payload: any): Animation {
        this.update(payload); // Apply final state for text

        const animation: LoopIterationAnimation = { // Re-using LoopIterationAnimation for now for highlighting
            type: 'loop_iteration', 
            target: this.id,
            duration: 300,
            konvaObject: this.background, // Animate the background rect
            iteration: 0, // Not directly applicable, but required by type
            totalIterations: 0, // Not directly applicable, but required by type
        };
        return animation;
    }
}
