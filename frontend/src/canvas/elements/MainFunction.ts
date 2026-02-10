// frontend/src/canvas/elements/MainFunction.ts
import { CanvasElement } from "../core/CanvasElement";
import Konva from 'konva';
import AnimationEngine from "../../animations/AnimationEngine";
import { FunctionCallAnimation } from "../../types/animation.types"; // Assuming this type is used for creation or a generic equivalent

export class MainFunction extends CanvasElement {
    private background: Konva.Rect;
    private title: Konva.Text;

    constructor(parentId: string, layer: Konva.Layer) {
        super('main-function', parentId, layer);
        this.elementType = 'MainFunction';
        this.layout = {
            x: 40,
            y: 40,
            width: 500,
            height: 60, // Will grow
            cursorY: 60,
        };
        this.container.position({ x: this.layout.x, y: this.layout.y });

        this.background = new Konva.Rect({
            width: this.layout.width,
            height: this.layout.height,
            fill: '#1e293b',
            stroke: '#a855f7', // Purple
            strokeWidth: 2,
            cornerRadius: 5,
        });

        this.title = new Konva.Text({
            text: 'main()',
            x: 20,
            y: 20,
            fontSize: 24,
            fontStyle: 'bold',
            fill: 'white',
        });

        this.container.add(this.background, this.title);
    }
    
    async create(payload: any): Promise<void> {
        const animation: FunctionCallAnimation = { // Re-using FunctionCallAnimation for its 'y' animation
            type: 'function_call', // Type for the animation logic in Timelines.ts
            target: this.id, // ID of the container for reference
            konvaObject: this.container, // The Konva object to animate
            duration: 500, // Duration in ms
        };
        const timeline = AnimationEngine.createSequence([animation]);
        AnimationEngine.addSequence(timeline);
    }

    async update(payload: any): Promise<void> {
        // Resize based on new children
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
