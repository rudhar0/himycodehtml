// frontend/src/components/canvas/elements/ArrayPanel.tsx
// FIXED VERSION - Stable keys and proper value propagation

import React, { useRef, memo, useMemo } from 'react';
import { Group, Rect, Text, Line } from 'react-konva';
import { ArrayBox } from './ArrayBox';

export interface ArrayData {
  id?: string;
  name: string;
  baseType: string;
  dimensions: number[];
  values: any[];
  address: string;
  owner: string;
  birthStep: number;
  lastUpdateStep?: number;
  updatedIndices?: number[][];
}

export interface ArrayPanelProps {
  id: string;
  x: number;
  y: number;
  arrays: ArrayData[];
  currentStep: number;
  isNew?: boolean;
}

const HEADER_HEIGHT = 50;
const PADDING = 16;
const ARRAY_SPACING = 20;
const MIN_WIDTH = 300;

export const ArrayPanel: React.FC<ArrayPanelProps> = memo(({
  id,
  x,
  y,
  arrays,
  currentStep,
  isNew = false
}) => {
  const groupRef = useRef<any>(null);

  const { panelWidth, panelHeight, arrayPositions } = useMemo(() => {
    if (arrays.length === 0) {
      return { 
        panelWidth: MIN_WIDTH, 
        panelHeight: HEADER_HEIGHT + PADDING * 2,
        arrayPositions: []
      };
    }

    let maxWidth = MIN_WIDTH;
    let currentY = HEADER_HEIGHT + PADDING;
    const positions: { array: ArrayData; y: number; height: number }[] = [];

    arrays.forEach(arr => {
      const { width, height } = calculateArrayBoxSize(arr.dimensions);
      maxWidth = Math.max(maxWidth, width + PADDING * 2);
      
      positions.push({
        array: arr,
        y: currentY,
        height: height
      });
      
      currentY += height + ARRAY_SPACING;
    });

    const totalHeight = currentY + PADDING;

    return { 
      panelWidth: maxWidth, 
      panelHeight: totalHeight,
      arrayPositions: positions
    };
  }, [arrays]);

  // FIX: Use stable keys based on array name + dimensions only
  const renderedArrays = useMemo(() => {
    return arrayPositions.map(({ array, y }) => {
      const stableKey = `${array.name}-${array.dimensions.join('x')}`;
      
      return (
        <ArrayBox
          key={stableKey}
          id={array.id || array.name}
          name={array.name}
          baseType={array.baseType}
          dimensions={array.dimensions}
          values={array.values}
          address={array.address}
          x={PADDING}
          y={y}
          isNew={array.birthStep === currentStep}
          updatedIndices={array.updatedIndices || []}
          owner={array.owner}
          currentStep={currentStep}
        />
      );
    });
  }, [arrayPositions, currentStep]);

  return (
    <Group ref={groupRef} id={id} x={x} y={y}>
      {/* Background */}
      <Rect
        width={panelWidth}
        height={panelHeight}
        fill="rgba(15, 23, 42, 0.95)"
        stroke="#10B981"
        strokeWidth={2}
        cornerRadius={8}
        shadowColor="rgba(0, 0, 0, 0.4)"
        shadowBlur={16}
        shadowOffsetY={4}
        listening={false}
      />

      {/* Header Background */}
      <Rect
        width={panelWidth}
        height={HEADER_HEIGHT}
        fill="rgba(16, 185, 129, 0.2)"
        cornerRadius={[8, 8, 0, 0]}
        listening={false}
      />

      {/* Header Title */}
      <Text
        text="Arrays"
        x={PADDING}
        y={16}
        fontSize={18}
        fontStyle="bold"
        fill="#F1F5F9"
        fontFamily="'SF Pro Display', system-ui"
        listening={false}
      />

      {/* Array Count Badge */}
      <Group x={panelWidth - 80} y={12}>
        <Rect
          width={60}
          height={26}
          fill="#10B981"
          cornerRadius={13}
          opacity={0.3}
          listening={false}
        />
        <Text
          text={`${arrays.length} array${arrays.length !== 1 ? 's' : ''}`}
          x={0}
          y={6}
          width={60}
          fontSize={12}
          fontStyle="bold"
          fill="#34D399"
          align="center"
          fontFamily="'SF Pro Display', system-ui"
          listening={false}
        />
      </Group>

      {/* Divider */}
      <Line
        points={[0, HEADER_HEIGHT, panelWidth, HEADER_HEIGHT]}
        stroke="#334155"
        strokeWidth={1}
        listening={false}
      />

      {/* Arrays */}
      {arrays.length > 0 ? (
        renderedArrays
      ) : (
        <Text
          text="No arrays yet"
          x={PADDING}
          y={HEADER_HEIGHT + 40}
          fontSize={14}
          fill="#64748B"
          fontFamily="system-ui"
          listening={false}
        />
      )}
    </Group>
  );
}, (prevProps, nextProps) => {
  // Re-render if arrays data changed or currentStep changed
  const arraysChanged = JSON.stringify(prevProps.arrays) !== JSON.stringify(nextProps.arrays);
  const stepChanged = prevProps.currentStep !== nextProps.currentStep;
  
  return !arraysChanged && !stepChanged;
});

ArrayPanel.displayName = 'ArrayPanel';

function calculateArrayBoxSize(dimensions: number[]) {
  const CELL_WIDTH = 60;
  const CELL_HEIGHT = 50;
  const CELL_SPACING = 4;
  const BOX_HEADER = 50;
  const BOX_PADDING = 12;

  if (dimensions.length === 1) {
    const cols = dimensions[0];
    return {
      width: cols * (CELL_WIDTH + CELL_SPACING) + BOX_PADDING * 2,
      height: BOX_HEADER + CELL_HEIGHT + BOX_PADDING * 2
    };
  }

  if (dimensions.length === 2) {
    const cols = dimensions[1];
    const rows = dimensions[0];
    return {
      width: cols * (CELL_WIDTH + CELL_SPACING) + BOX_PADDING * 2,
      height: BOX_HEADER + rows * (CELL_HEIGHT + CELL_SPACING) + BOX_PADDING * 2
    };
  }

  if (dimensions.length === 3) {
    const cols = dimensions[2];
    const rows = dimensions[1];
    return {
      width: cols * (CELL_WIDTH + CELL_SPACING) + BOX_PADDING * 2,
      height: BOX_HEADER + 30 + rows * (CELL_HEIGHT + CELL_SPACING) + BOX_PADDING * 2
    };
  }

  return { width: 200, height: 100 };
}

export default ArrayPanel;