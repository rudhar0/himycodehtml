import { CanvasElement } from "../core/CanvasElement";
import Konva from 'konva';
import { FunctionCallAnimation as FunctionCallAnimationType, Animation } from "../../types/animation.types"; // Aliasing to avoid conflict

export class FunctionCall extends CanvasElement {
    private text: Konva.Text;

    constructor(id: string, parentId: string, layer: Konva.Layer, payload: any) {
        super(id, parentId, layer);
        this.elementType = 'FunctionCall';
        this.subType = payload.function;
        this.layout = {
            x: 0,
            y: 0,
            width: 560,
            height: 30, // Will expand
            cursorY: 30,
        };

        this.text = new Konva.Text({
            text: `call ${payload.function}()`,
            x: 0,
            y: 5,
            fill: '#a855f7',
            fontFamily: 'monospace',
            fontStyle: 'italic',
        });
        
        this.container.add(this.text);
    }
    
    create(payload: any): void {
        this.container.opacity(1);
    }

    update(payload: any): void {}

    getCreateAnimation(payload: any): Animation {
        return {
            type: 'function_call',
            target: this.id,
            konvaObject: this.container,
            duration: 300,
        } as FunctionCallAnimationType;
    }
    
    getUpdateAnimation(payload: any): Animation {
        return null;
    }
}
