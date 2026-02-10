// frontend/src/components/memory/MemoryCanvas.tsx
import React from 'react';
import { Stage, Layer, Rect, Text } from 'react-konva';
import MemoryRegion from './MemoryRegion';
import MemoryCell from './MemoryCell';

// Placeholder data - this will come from the memory store later
const mockStack = [
    { name: 'x', value: 5, address: '0x7fff004' },
    { name: 'y', value: 10, address: '0x7fff000' },
];

const MemoryCanvas: React.FC = () => {
  const stageWidth = 600; // example width
  const stageHeight = 800; // example height

  return (
    <Stage width={stageWidth} height={stageHeight}>
      <Layer>
        {/* Background */}
        <Rect x={0} y={0} width={stageWidth} height={stageHeight} fill="#0f172a" />

        {/* Title */}
        <Text
          text="MEMORY MAP"
          x={10}
          y={10}
          fontSize={18}
          fontStyle="bold"
          fill="white"
          fontFamily="sans-serif"
        />

        {/* Memory Regions */}
        <MemoryRegion name="TEXT" x={10} y={40} width={stageWidth - 20} height={100} startAddress="0x400000" />
        <MemoryRegion name="DATA" x={10} y={150} width={stageWidth - 20} height={100} startAddress="0x600000" />
        <MemoryRegion name="HEAP" x={10} y={260} width={stageWidth - 20} height={200} startAddress="0x1000000" />
        <MemoryRegion name="STACK" x={10} y={470} width={stageWidth - 20} height={300} startAddress="0x7fff000">
            {/* Mock stack variables */}
            {mockStack.map((variable, index) => (
                <MemoryCell
                    key={variable.address}
                    x={10}
                    y={10 + index * 40}
                    width={stageWidth - 40}
                    height={35}
                    variableName={variable.name}
                    value={variable.value}
                    address={variable.address}
                />
            ))}
        </MemoryRegion>
      </Layer>
    </Stage>
  );
};

export default MemoryCanvas;