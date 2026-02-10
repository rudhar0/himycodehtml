// frontend/src/canvas/elements/Pointer.ts
import { CanvasElement } from "../core/CanvasElement";
import Konva from 'konva';
import { Animation, VariableCreateAnimation, VariableUpdateAnimation } from "../../types/animation.types";
import { COLORS } from '../../config/theme.config';

export class Pointer extends CanvasElement {
    private textNode: Konva.Text; // Assuming pointer has a text representation

    constructor(id: string, parentId: string, layer: Konva.Layer, payload: any) {
        super(id, parentId, layer);
        this.elementType = 'Pointer';
        this.layout = {
            x: 0,
            y: 0,
            width: 540,
            height: 20,
        };

        this.textNode = new Konva.Text({
            text: `${payload.type} ${payload.name} = ${payload.value};`, // value is the address
            x: 0,
            y: 5,
            fill: COLORS.dark.text.primary, // Using theme color
            fontFamily: 'monospace',
        });
        
        this.container.add(this.textNode);

        // Set initial state for non-animated rendering
        this.container.opacity(1);
        this.container.scaleX(1);
        this.container.scaleY(1);
    }
    
    // Non-animating creation: set the final state immediately
    create(payload: any): void {
        console.log('[Pointer] Creating pointer (non-animated) with payload:', payload);
        this.textNode.text(`${payload.type} ${payload.name} = ${payload.value};`);
        this.container.opacity(1);
        this.container.scaleX(1);
        this.container.scaleY(1);
    }

    // Non-animating update: set the final state immediately
    update(payload: any): void {
        console.log('[Pointer] Updating pointer (non-animated) with payload:', payload);
        this.textNode.text(`${payload.type} ${payload.name} = ${payload.value};`);
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
        const oldValue = this.textNode.text();
        this.update(payload); // Apply final state for text
        const newValue = this.textNode.text();

        const animation: VariableUpdateAnimation = { // Re-using VariableUpdateAnimation for now
            type: 'variable_update',
            target: this.id,
            duration: 600,
            from: oldValue,
            to: newValue,
            konvaContainer: this.container,
            valueTextNode: this.textNode,
        };
        return animation;
    }
}
