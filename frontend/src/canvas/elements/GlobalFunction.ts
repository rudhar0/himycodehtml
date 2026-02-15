// frontend/src/canvas/elements/GlobalFunction.ts
import { CanvasElement } from "../core/CanvasElement";
import Konva from 'konva';
import AnimationEngine from "../../animations/AnimationEngine";
import { VariableCreateAnimation } from "../../types/animation.types"; // Re-using this for generic creation animation

export class GlobalFunction extends CanvasElement {
    constructor(id: string, parentId: string, layer: Konva.Layer, name: string) {
        super(id, parentId, layer);
        this.elementType = 'GlobalFunction';
        this.layout = {
            x: 0, // Positioned by layout manager
            y: 0,
            width: 260,
            height: 40,
        };
        
        const rect = new Konva.Rect({
            width: this.layout.width,
            height: this.layout.height,
            fill: '#334155',
            cornerRadius: 3,
        });

        const text = new Konva.Text({
            text: `void ${name}() { ... }`,
            x: 10,
            y: 12,
            fill: 'white',
            fontFamily: 'monospace',
        });

        this.container.add(rect, text);
    }


    create(payload: any): void {}
    update(payload: any): void {}
    
    getCreateAnimation(data: any): any {
        return {
            type: 'fade_in',
            target: this.id,
            konvaObject: this.container,
            duration: 500,
        };
    }

    getUpdateAnimation(data: any): any {
        return {
            type: 'update',
            target: this.id,
            konvaObject: this.container,
            duration: 300,
        };
    }
}
