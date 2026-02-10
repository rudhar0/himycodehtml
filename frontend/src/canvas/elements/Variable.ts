// frontend/src/canvas/elements/Variable.ts
import { CanvasElement } from "../core/CanvasElement";
import Konva from 'konva';
import { COLORS } from '../../config/theme.config';
import { Variable as VariableData } from '@types/execution.types';

export class Variable extends CanvasElement {
    private textNode: Konva.Text;
    private backgroundRect: Konva.Rect;

    constructor(id: string, parentId: string, layer: Konva.Layer, data: VariableData & { isMember?: boolean }) {
        super(id, parentId, layer);
        this.elementType = 'Variable';
        
        const isMember = data.isMember || false;

        this.layout = {
            x: 0,
            y: 0,
            width: isMember ? 520 : 540,
            height: isMember ? 40 : 50,
        };

        this.container.opacity(1);

        this.backgroundRect = new Konva.Rect({
            name: 'box-bg',
            width: this.layout.width,
            height: this.layout.height,
            fill: isMember ? COLORS.memory.stack.MEMBER : COLORS.memory.stack.DEFAULT,
            stroke: COLORS.memory.stack.dark,
            strokeWidth: 2,
            cornerRadius: 6,
            shadowColor: 'black',
            shadowBlur: isMember ? 2 : 5,
            shadowOpacity: 0.2,
        });

        this.textNode = new Konva.Text({
            name: 'variable-value',
            text: '', // Will be set by update
            x: 10,
            y: isMember ? 12 : 15,
            fill: COLORS.dark.text.primary,
            fontFamily: 'monospace',
            fontSize: 14,
        });
        
        this.container.add(this.backgroundRect, this.textNode);

        // Render initial state
        this.update(data);
    }
    
    update(data: Partial<VariableData>): void {
        const type = data.type || data.primitive || 'unknown';
        const name = data.name || '';
        let valueStr = '?';

        if (data.value !== undefined) {
            if (typeof data.value === 'object' && data.value !== null) {
                // For pointers, arrays, or complex objects, just show the type or address
                if (data.primitive === 'pointer' || data.type?.includes('*')) {
                    valueStr = data.value; // Show address
                } else if (data.primitive === 'array') {
                    valueStr = `[${(data.value as any[]).join(', ')}]`;
                } else {
                    valueStr = `{...}`; // Placeholder for other objects
                }
            } else {
                valueStr = String(data.value);
            }
        }
        
        this.textNode.text(`${type} ${name} = ${valueStr};`);
    }
}
