// frontend/src/components/memory/MemoryCell.tsx
import React from 'react';
import { Rect, Text, Group } from 'react-konva';

interface MemoryCellProps {
  x: number;
  y: number;
  width: number;
  height: number;
  variableName: string;
  value: any;
  address: string;
}

const MemoryCell: React.FC<MemoryCellProps> = ({
  x,
  y,
  width,
  height,
  variableName,
  value,
  address,
}) => {
  const valueStr = String(value);

  return (
    <Group x={x} y={y}>
      <Rect
        width={width}
        height={height}
        stroke="#3B82F6" // stack.DEFAULT blue
        strokeWidth={1}
      />
      <Text
        text={`${variableName} = ${valueStr}`}
        x={5}
        y={5}
        fontFamily="monospace"
        fill="#f8fafc" // slate-50
        fontSize={12}
      />
      <Text
        text={address}
        x={5}
        y={height - 15}
        fontFamily="monospace"
        fill="#94a3b8" // slate-400
        fontSize={10}
      />
    </Group>
  );
};

export default MemoryCell;
