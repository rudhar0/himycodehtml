// frontend/src/canvas/elements/Loop.ts
import { CanvasElement } from "../core/CanvasElement";
import Konva from 'konva';
import { Animation, LoopIterationAnimation, VariableCreateAnimation } from "../../types/animation.types";
import { COLORS } from '../../config/theme.config';

export class Loop extends CanvasElement {
    private background: Konva.Rect;
    private title: Konva.Text; // Assuming title is also a Konva object

    constructor(id: string, parentId: string, layer: Konva.Layer, payload: any) {
        super(id, parentId, layer);
        this.elementType = 'Loop';
        this.layout = {
            x: 0,
            y: 0,
            width: 520, // Slightly smaller than parent
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
            id: `${this.id}-background` // Give it an ID for Konva.Stage.findOne
        });

        this.title = new Konva.Text({
            text: `loop (${payload.condition})`,
            x: 10,
            y: 10,
            fill: COLORS.dark.text.primary, // Using theme color
            fontFamily: 'monospace',
            id: `${this.id}-title` // Give it an ID
        });

        this.container.add(this.background, this.title);

        // Set initial state for non-animated rendering
        this.container.opacity(1);
        this.container.scaleX(1);
        this.container.scaleY(1);
    }

    // Non-animating creation: set the final state immediately
    create(payload: any): void {
        console.log('[Loop] Creating loop (non-animated) with payload:', payload);
        this.title.text(`loop (${payload.condition})`);
        this.container.opacity(1);
        this.container.scaleX(1);
        this.container.scaleY(1);
    }

    // Non-animating update: set the final state immediately
    update(payload: any): void {
        console.log('[Loop] Updating loop (non-animated) with payload:', payload);
        // For loops, updates might involve changing conditions or just highlighting
        if (payload.condition) {
            this.title.text(`loop (${payload.condition})`);
        }
    }

    getCreateAnimation(payload: any): Animation {
        this.container.opacity(0);
        this.container.scaleX(0.8);
        this.container.scaleY(0.8);
        this.create(payload); // Apply final state for text

        const animation: VariableCreateAnimation = { // Re-using for now, consider a specific LoopCreateAnimation
            type: 'variable_create', 
            target: this.id,
            duration: 500,
            konvaObject: this.container,
        };
        return animation;
    }

    getUpdateAnimation(payload: any): Animation {
        this.update(payload); // Apply final state for text

        const animation: LoopIterationAnimation = {
            type: 'loop_iteration', 
            target: this.id,
            duration: 300,
            konvaObject: this.background, // Animate the background rect
            iteration: payload.iteration || 0,
            totalIterations: payload.totalIterations || 0,
        };
        return animation;
    }
}
