// frontend/src/canvas/elements/Loop.ts
import { CanvasElement } from "../core/CanvasElement";
import Konva from 'konva';
import { Animation, LoopIterationAnimation, VariableCreateAnimation } from "../../types/animation.types";
import { COLORS } from '../../config/theme.config';

export class LoopBody extends CanvasElement {
    private background: Konva.Rect;
    private title: Konva.Text;

    constructor(id: string, parentId: string, layer: Konva.Layer, payload: any) {
        super(id, parentId, layer);
        this.elementType = 'LoopBody';
        this.layout = {
            x: 0,
            y: 0,
            width: 400, // Reduced width for the outside box
            height: 40, // Will grow with children
            cursorY: 40,
        };

        this.background = new Konva.Rect({
            width: this.layout.width,
            height: this.layout.height,
            fill: COLORS.dark.background.secondary, // Darker background for the body
            stroke: COLORS.flow.control.DEFAULT,
            strokeWidth: 2,
            cornerRadius: 5,
            id: `${this.id}-background`
        });

        this.title = new Konva.Text({
            text: `Iteration Context`,
            x: 10,
            y: 10,
            fill: COLORS.flow.control.light,
            fontFamily: 'monospace',
            fontSize: 10,
            fontStyle: 'italic',
            id: `${this.id}-title`
        });

        this.container.add(this.background, this.title);
        
        // Ensure proper identification for parent logic
        this.container.setAttr('controlRole', 'body');
    }

    create(payload: any): void {
        this.container.opacity(1);
    }

    update(payload: any): void {
        // Resize based on children layout
        // This will be called by LayoutManager or explicitly
    }
    
    getCreateAnimation(payload: any): Animation {
        this.container.opacity(0);
        return {
            type: 'variable_create',
            target: this.id,
            konvaObject: this.container,
            duration: 500,
        } as VariableCreateAnimation;
    }

    getUpdateAnimation(payload: any): Animation {
        return {
            type: 'loop_iteration', 
            target: this.id,
            duration: 300,
            konvaObject: this.background,
            iteration: payload.iteration || 0,
            totalIterations: payload.totalIterations || 0,
        } as LoopIterationAnimation;
    }
}
