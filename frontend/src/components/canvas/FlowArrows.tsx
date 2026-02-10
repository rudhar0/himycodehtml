// frontend/src/components/canvas/FlowArrows.tsx

import React from 'react';
import { Arrow } from 'react-konva';

export type ArrowType = 'call' | 'return' | 'loop' | 'branch';

interface FlowArrowProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  type: ArrowType;
}

const FlowArrow: React.FC<FlowArrowProps> = ({ x1, y1, x2, y2, type }) => {
  const commonProps = {
    points: [x1, y1, x2, y2],
    pointerLength: 10,
    pointerWidth: 10,
    fill: 'black',
    stroke: 'black',
    strokeWidth: 2,
  };

  switch (type) {
    case 'return':
      return <Arrow {...commonProps} dash={[5, 5]} />;
    case 'loop':
        // A simple loop arrow could be a curved arrow.
        // For simplicity, we'll use a straight arrow for now,
        // but a more complex implementation would use a quadratic curve.
        return <Arrow
            {...commonProps}
            // A curved arrow for loops, needs adjusting based on layout
            points={[x1, y1, x1 + 50, y1 + 50, x2, y2]}
            tension={0.5}
            stroke="purple"
        />
    case 'branch':
        return <Arrow {...commonProps} stroke="blue" />;
    case 'call':
    default:
      return <Arrow {...commonProps} />;
  }
};

interface FlowArrowsContainerProps {
    arrows: Omit<FlowArrowProps, 'type'> & { id: string; type: ArrowType }[];
}

// This container would be used to render all the arrows on the canvas
export const FlowArrowsContainer: React.FC<FlowArrowsContainerProps> = ({ arrows }) => {
    return (
        <>
            {arrows.map(arrow => (
                <FlowArrow key={arrow.id} {...arrow} />
            ))}
        </>
    );
}

export default FlowArrow;
