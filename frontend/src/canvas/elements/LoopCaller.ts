import { CanvasElement } from "../core/CanvasElement";
import Konva from 'konva';
import { Animation, VariableCreateAnimation } from "../../types/animation.types";
import { COLORS } from '../../config/theme.config';

export class LoopCaller extends CanvasElement {
    private text: Konva.Text;
    private background: Konva.Rect;

    constructor(id: string, parentId: string, layer: Konva.Layer, payload: any) {
        super(id, parentId, layer);
        this.elementType = 'LoopCaller';
        this.layout = {
            x: 0,
            y: 0,
            width: 120, // Smaller width for the caller
            height: 30,
            cursorY: 30,
        };

        this.background = new Konva.Rect({
            width: this.layout.width,
            height: this.layout.height,
            fill: COLORS.flow.control.DEFAULT,
            cornerRadius: 15, // Pill shape
            opacity: 0.8,
        });

        this.text = new Konva.Text({
            text: `loop (${payload.condition})`,
            x: 10,
            y: 8,
            fill: 'white',
            fontSize: 12,
            fontFamily: 'monospace',
        });
        
        this.container.add(this.background, this.text);
    }
    
    create(payload: any): void {
        this.container.opacity(1);
    }

    update(payload: any): void {
         if (payload.condition) {
            this.text.text(`loop (${payload.condition})`);
        }
    }

    getCreateAnimation(payload: any): Animation {
        return {
            type: 'variable_create',
            target: this.id,
            konvaObject: this.container,
            duration: 300,
        } as VariableCreateAnimation;
    }
    
    getUpdateAnimation(payload: any): Animation {
        return null;
    }
}
