// frontend/src/canvas/elements/CanvasArray.ts
import { CanvasElement } from "../core/CanvasElement";
import Konva from 'konva';
import { Animation, VariableCreateAnimation, ArrayAccessAnimation } from "../../types/animation.types";
import { COLORS } from '../../config/theme.config';

export class CanvasArray extends CanvasElement {
    private cellRects: Konva.Rect[] = []; // Store references to individual cell rectangles
    private cellTexts: Konva.Text[] = []; // Store references to individual cell texts

    constructor(id: string, parentId: string, layer: Konva.Layer, payload: any) {
        super(id, parentId, layer);
        this.elementType = 'Array';
        this.layout = {
            x: 0,
            y: 0,
            width: 540,
            height: 40,
        };

        // Main declaration text
        const text = new Konva.Text({
            text: `${payload.type} ${payload.name}[${payload.size}];`,
            x: 0,
            y: 5,
            fill: COLORS.dark.text.primary, // Using theme color
            fontFamily: 'monospace',
        });
        this.container.add(text);

        // Visual representation of array cells
        const cellGroup = new Konva.Group({ x: 0, y: 20 });
        const cellWidth = 30;
        payload.values.forEach((val: any, index: number) => {
            const cellRect = new Konva.Rect({
                x: index * (cellWidth + 5),
                y: 0,
                width: cellWidth,
                height: cellWidth,
                stroke: COLORS.memory.array.dark, // Using theme color
                strokeWidth: 1,
                id: `${this.id}-cell-rect-${index}`, // Unique ID for each cell rectangle
                fill: COLORS.memory.array.DEFAULT, // Using theme color
            });
            this.cellRects.push(cellRect); 
            
            const cellText = new Konva.Text({
                text: String(val),
                x: index * (cellWidth + 5) + 5,
                y: 5,
                fill: COLORS.dark.text.primary, // Using theme color
                fontSize: 12,
                id: `${this.id}-cell-text-${index}`, // Unique ID for each cell text
            });
            this.cellTexts.push(cellText);
            cellGroup.add(cellRect, cellText);
        });
        this.container.add(cellGroup);
        
        this.layout.height = cellGroup.getClientRect().height + 25;

        // Set initial state for non-animated rendering
        this.container.opacity(1);
        this.container.scaleX(1);
        this.container.scaleY(1);
    }
    
    // Non-animating creation: set the final state immediately
    create(payload: any): void {
        console.log('[CanvasArray] Creating array (non-animated) with payload:', payload);
        this.container.opacity(1);
        this.container.scaleX(1);
        this.container.scaleY(1);
        // Update cell values
        payload.values.forEach((val: any, index: number) => {
            if (this.cellTexts[index]) {
                this.cellTexts[index].text(String(val));
            }
        });
    }

    // Non-animating update: set the final state immediately
    update(payload: any): void {
        console.log('[CanvasArray] Updating array (non-animated) with payload:', payload);
        // Assuming payload has 'index' and 'newValue' for array update
        if (payload.index !== undefined && this.cellTexts[payload.index]) {
            this.cellTexts[payload.index].text(String(payload.newValue));
        }
    }

    getCreateAnimation(payload: any): Animation {
        this.container.opacity(0);
        this.container.scaleX(0.8);
        this.container.scaleY(0.8);
        this.create(payload); // Apply final state for text, cells, etc.

        const animation: VariableCreateAnimation = { // Re-using for now, consider a specific ArrayCreateAnimation
            type: 'variable_create', 
            target: this.id,
            duration: 500,
            konvaObject: this.container,
        };
        return animation;
    }

    getUpdateAnimation(payload: any): Animation {
        const index = payload.index;
        if (index === undefined || !this.cellRects[index]) {
            console.warn(`[CanvasArray] No valid index or cell found for update animation: ${index}`);
            // If no specific update animation, just apply the state
            this.update(payload);
            return {
                type: 'variable_update', // Fallback to generic update if specific animation not possible
                target: this.id,
                duration: 0,
                from: '',
                to: String(payload.newValue),
                konvaContainer: this.container,
                valueTextNode: this.cellTexts[index] || null,
                backgroundRect: this.cellRects[index] || null,
            };
        }

        const oldCellValue = this.cellTexts[index].text();
        this.update(payload); // Apply final state for text

        const animation: ArrayAccessAnimation = { // Using ArrayAccess for updates
            type: 'array_access',
            target: `${this.id}-cell-rect-${index}`, // Target the specific cell for animation
            duration: 300,
            index: index,
            konvaObject: this.cellRects[index],
            // Potentially add 'from' and 'to' for value changes within ArrayAccessAnimation if needed
        };
        return animation;
    }
}
