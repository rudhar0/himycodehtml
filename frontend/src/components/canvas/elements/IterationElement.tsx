import React, { memo } from 'react';
import { Group, Rect, Text, Line } from 'react-konva';

interface IterationElementProps {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  iteration: number;
  children?: React.ReactNode;
}

export const IterationElement: React.FC<IterationElementProps> = memo(({
  id,
  x,
  y,
  width,
  height,
  iteration,
  children
}) => {
  return (
    <Group x={x} y={y}>
      {/* Iteration Separator/Header */}
      <Group>
        <Line
          points={[0, 10, width, 10]}
          stroke="#475569"
          strokeWidth={1}
          dash={[4, 4]}
        />
        <Rect
          x={10}
          y={0}
          width={80}
          height={20}
          fill="#1E293B" // Matches bg to cover line
        />
        <Text
          text={`Iteration ${iteration}`}
          x={15}
          y={4}
          fontSize={10}
          fill="#94A3B8"
          fontFamily="'SF Mono', monospace"
        />
      </Group>

      {/* Iteration Content */}
      <Group y={25}>
        {children}
      </Group>
    </Group>
  );
});
