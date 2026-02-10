// frontend/src/canvas/elements/GlobalPanel.ts
import { CanvasElement } from "../core/CanvasElement";
import Konva from 'konva';
import AnimationEngine from "../../animations/AnimationEngine";
import { VariableCreateAnimation } from "../../types/animation.types"; // Re-using this for generic creation animation

export class GlobalPanel extends CanvasElement {
    private background: Konva.Rect;

    constructor(parentId: string, layer: Konva.Layer) {
        super('global-panel', parentId, layer);
        this.elementType = 'GlobalPanel';
        this.layout = {
            x: 720,
            y: 40,
            width: 300,
            height: 40, // Will grow
            cursorY: 20,
        };
        this.container.position({ x: this.layout.x, y: this.layout.y });

        this.background = new Konva.Rect({
            width: this.layout.width,
            height: this.layout.height,
            fill: '#1e293b',
            stroke: '#334155',
            strokeWidth: 1,
            cornerRadius: 5,
        });
        this.container.add(this.background);
    }
    
    async create(payload: any): Promise<void> {
        const animation: VariableCreateAnimation = { // Re-using for generic element creation with opacity/position
            type: 'variable_create', 
            target: this.id,
            konvaObject: this.container,
            duration: 500,
        };
        const timeline = AnimationEngine.createSequence([animation]);
        AnimationEngine.addSequence(timeline);
    }

    async update(payload: any): Promise<void> {
        // The main update will be resizing based on new children
        const timeline = AnimationEngine.createSequence([
            {
                type: 'loop_iteration', // Re-using for generic container resize animation
                target: this.id,
                konvaObject: this.background,
                duration: 300,
            }
        ]);
        AnimationEngine.addSequence(timeline);
    }

    async animate(type: any, payload?: any): Promise<void> {}
}
