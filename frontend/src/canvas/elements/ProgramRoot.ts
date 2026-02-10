// frontend/src/canvas/elements/ProgramRoot.ts
import { CanvasElement } from "../core/CanvasElement";
import Konva from 'konva';

export class ProgramRoot extends CanvasElement {
    constructor(layer: Konva.Layer) {
        super('program-root', null, layer);
        this.elementType = 'ProgramRoot';
        this.layout = {
            x: 0,
            y: 0,
            width: 0, // will be determined by children
            height: 0,
            cursorY: 40,
        };
        this.container.position({ x: this.layout.x, y: this.layout.y });
    }

    async create(payload: any): Promise<void> {
        // The root doesn't have a visual representation itself, it's just a container.
        return Promise.resolve();
    }

    async update(payload: any): Promise<void> {
        // Nothing to update visually
        return Promise.resolve();
    }

    async animate(type: any, payload?: any): Promise<void> {
        // No animations for the root itself
        return Promise.resolve();
    }
}
