// frontend/src/components/memory/MemoryRegion.tsx
import React from 'react';
import { Rect, Text, Group } from 'react-konva';

type RegionType = 'TEXT' | 'DATA' | 'HEAP' | 'STACK';

interface MemoryRegionProps {
  x: number;
  y: number;
  width: number;
  height: number;
  name: RegionType;
  startAddress: string;
  children?: React.ReactNode;
}

const REGION_COLORS: Record<RegionType, string> = {
    TEXT: '#14B8A6', // global.dark (Teal)
    DATA: '#D97706', // optimized.dark (Amber)
    HEAP: '#059669', // heap.dark (Green)
    STACK: '#2563EB', // stack.dark (Blue)
}

const MemoryRegion: React.FC<MemoryRegionProps> = ({
  x,
  y,
  width,
  height,
  name,
  startAddress,
  children,
}) => {
  const color = REGION_COLORS[name];

  return (
    <Group x={x} y={y}>
      {/* Region Bounding Box */}
      <Rect
        width={width}
        height={height}
        stroke="#475569" // slate-600
        strokeWidth={1}
        fill={`${color}1A`} // color with low opacity
      />
      
      {/* Region Header */}
      <Rect width={width} height={24} fill={color} />
      <Text
        text={`${name} (${startAddress})`}
        x={10}
        y={6}
        fontFamily="sans-serif"
        fill="white"
        fontSize={14}
        fontStyle="bold"
      />

      {/* Content inside the region */}
      <Group x={0} y={24}>
        {children}
      </Group>
    </Group>
  );
};

export default MemoryRegion;