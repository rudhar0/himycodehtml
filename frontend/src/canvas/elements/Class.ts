// frontend/src/canvas/elements/Class.ts
import { CanvasElement } from '../core/CanvasElement';
import Konva from 'konva';
import { COLORS } from '../../config/theme.config';
import { Variable as VariableData, MemberVariable } from '@types/execution.types';
import { Variable as VariableElement } from './Variable';
import { VerticalFlowLayout } from '../managers/VerticalFlowLayout';

export class Class extends CanvasElement {
    private backgroundRect: Konva.Rect;
    private title: Konva.Text;
    public memberElements: Map<string, VariableElement> = new Map();

    constructor(id: string, parentId: string, layer: Konva.Layer, data: VariableData) {
        super(id, parentId, layer);
        this.elementType = 'Class';
        this.layout = {
            x: 0,
            y: 0,
            width: 540,
            height: 0, // Will be calculated based on members
            padding: 10,
        };

        this.container.opacity(1);

        // Main background for the class
        this.backgroundRect = new Konva.Rect({
            name: 'box-bg',
            width: this.layout.width,
            height: 100, // Placeholder
            fill: COLORS.memory.class.DEFAULT,
            stroke: COLORS.memory.class.dark,
            strokeWidth: 2,
            cornerRadius: 8,
            shadowColor: 'black',
            shadowBlur: 8,
            shadowOpacity: 0.3,
        });
        
        // Title for the class (e.g., "Car tesla")
        this.title = new Konva.Text({
            name: 'class-title',
            text: `${data.className} ${data.name}`,
            x: this.layout.padding,
            y: this.layout.padding,
            fill: COLORS.dark.text.primary,
            fontFamily: 'monospace',
            fontSize: 16,
            fontStyle: 'bold',
        });
        
        this.container.add(this.backgroundRect, this.title);

        this.renderMembers(data);
    }
    
    renderMembers(data: VariableData): void {
        if (!Array.isArray(data.value)) {
            return;
        }

        let currentY = 40; // Starting Y for the first member

        // Create and position member variables
        for (const memberData of data.value as MemberVariable[]) {
            const memberId = `var-${memberData.address}`;
            const memberPayload = { ...memberData, isMember: true };
            
            const memberElement = new VariableElement(memberId, this.id, this.layer, memberPayload);

            // Adjust layout for members (they are smaller)
            memberElement.layout.x = this.layout.padding;
            memberElement.layout.y = currentY;
            memberElement.container.position({ x: this.layout.padding, y: currentY });

            this.addChild(memberElement);
            this.memberElements.set(memberId, memberElement);

            currentY += memberElement.layout.height + 5; // Add padding between members
        }
        
        // Update the main container height
        this.layout.height = currentY + this.layout.padding;
        this.backgroundRect.height(this.layout.height);
    }

    update(data: VariableData): void {
        if (!Array.isArray(data.value)) {
            return;
        }

        // Update existing members
        for (const memberData of data.value as MemberVariable[]) {
            const memberId = `var-${memberData.address}`;
            const memberElement = this.memberElements.get(memberId);
            if (memberElement) {
                memberElement.update(memberData);
            }
        }
    }
}
