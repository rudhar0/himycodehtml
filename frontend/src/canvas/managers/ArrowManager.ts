// frontend/src/canvas/managers/ArrowManager.ts
import Konva from 'konva';
import { CanvasElement } from '../core/CanvasElement';
import gsap from 'gsap';

export type ArrowType = 'function_call' | 'access' | 'reference' | 'control_flow';

export interface ArrowConnection {
    from: CanvasElement;
    to: CanvasElement;
    type: ArrowType;
}

class ArrowManager {
    private layer: Konva.Layer;
    private arrows: Konva.Arrow[] = [];

    constructor(layer: Konva.Layer) {
        this.layer = layer;
    }

    connect(connection: ArrowConnection) {
        const { from, to, type } = connection;

        const fromBox = from.container.getClientRect();
        const toBox = to.container.getClientRect();

        // A simple heuristic to find good connection points
        const points = [
            fromBox.x + fromBox.width, // right edge of from
            fromBox.y + fromBox.height / 2,
            toBox.x, // left edge of to
            toBox.y + toBox.height / 2,
        ];

        const arrow = new Konva.Arrow({
            points,
            pointerLength: 8,
            pointerWidth: 8,
            fill: 'white',
            stroke: 'white',
            strokeWidth: 1.5,
            opacity: 0,
        });

        this.arrows.push(arrow);
        this.layer.add(arrow);

        gsap.to(arrow, { opacity: 1, duration: 0.5 });
        
        // Pulse animation for emphasis
        gsap.to(arrow, {
            strokeWidth: 3,
            duration: 0.3,
            yoyo: true,
            repeat: 1
        });
    }

    update() {
        // This method would be called on each frame to update arrow positions
        // if the elements are moving. For now, we'll assume static positions
        // after initial placement.
    }

    clear() {
        this.arrows.forEach(arrow => {
            gsap.to(arrow, {
                opacity: 0,
                duration: 0.3,
                onComplete: () => arrow.destroy()
            });
        });
        this.arrows = [];
    }
}

export default ArrowManager;
