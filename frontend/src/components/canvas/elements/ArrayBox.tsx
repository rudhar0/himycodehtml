// frontend/src/components/canvas/elements/ArrayBox.tsx
// FIXED VERSION - Proper value display for all initialization types

import React, { useRef, useEffect, useState, memo, useMemo, useCallback } from 'react';
import { Group, Rect, Text, Line } from 'react-konva';
import Konva from 'konva';
import { ArrayCell } from './ArrayCell';

export interface ArrayBoxProps {
  id: string;
  name: string;
  baseType: string;
  dimensions: number[];
  values: any[];
  address: string;
  x: number;
  y: number;
  isNew?: boolean;
  updatedIndices?: number[][];
  owner?: string;
  currentStep?: number;
}

const CELL_WIDTH = 60;
const CELL_HEIGHT = 50;
const CELL_SPACING = 4;
const HEADER_HEIGHT = 50;
const PADDING = 12;
const TAB_HEIGHT = 30;

export const ArrayBox: React.FC<ArrayBoxProps> = memo(({
  id,
  name,
  baseType,
  dimensions,
  values,
  address,
  x,
  y,
  isNew = false,
  updatedIndices = [],
  owner = 'main',
  currentStep = 0
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const [activeTab, setActiveTab] = useState(0);

  console.log(`[ArrayBox ${name}] Rendering with ${values.length} values:`, values);
  
  const is1D = dimensions.length === 1;
  const is2D = dimensions.length === 2;
  const is3D = dimensions.length === 3;

  // Calculate total size
  const totalSize = useMemo(() => {
    return dimensions.reduce((a, b) => a * b, 1);
  }, [dimensions]);

  // FIX: Ensure values array matches total size
  const normalizedValues = useMemo(() => {
    const normalized = new Array(totalSize).fill(null);
    for (let i = 0; i < Math.min(values.length, totalSize); i++) {
      normalized[i] = values[i];
    }
    return normalized;
  }, [values, totalSize]);

  const { width: boxWidth, height: boxHeight } = useMemo(() => {
    if (is1D) {
      const cols = dimensions[0];
      const width = cols * (CELL_WIDTH + CELL_SPACING) + PADDING * 2;
      const height = HEADER_HEIGHT + CELL_HEIGHT + PADDING * 2;
      return { width, height };
    }
    
    if (is2D) {
      const cols = dimensions[1];
      const rows = dimensions[0];
      const width = cols * (CELL_WIDTH + CELL_SPACING) + PADDING * 2;
      const height = HEADER_HEIGHT + rows * (CELL_HEIGHT + CELL_SPACING) + PADDING * 2;
      return { width, height };
    }
    
    if (is3D) {
      const cols = dimensions[2];
      const rows = dimensions[1];
      const width = cols * (CELL_WIDTH + CELL_SPACING) + PADDING * 2;
      const height = HEADER_HEIGHT + TAB_HEIGHT + rows * (CELL_HEIGHT + CELL_SPACING) + PADDING * 2;
      return { width, height };
    }
    
    return { width: 200, height: 100 };
  }, [dimensions, is1D, is2D, is3D]);

  // FIX: Proper value accessor using flat array
  const getValueAt = useCallback((indices: number[]): any => {
    if (is1D) {
      const idx = indices[0];
      return idx < normalizedValues.length ? normalizedValues[idx] : null;
    }
    if (is2D) {
      const [i, j] = indices;
      const flatIdx = i * dimensions[1] + j;
      return flatIdx < normalizedValues.length ? normalizedValues[flatIdx] : null;
    }
    if (is3D) {
      const [i, j, k] = indices;
      const flatIdx = i * dimensions[1] * dimensions[2] + j * dimensions[2] + k;
      return flatIdx < normalizedValues.length ? normalizedValues[flatIdx] : null;
    }
    return null;
  }, [normalizedValues, dimensions, is1D, is2D, is3D]);

  const isCellUpdated = useCallback((indices: number[]): boolean => {
    return updatedIndices.some(updated => 
      updated.length === indices.length &&
      updated.every((val, idx) => val === indices[idx])
    );
  }, [updatedIndices]);

  // RENDER: 1D ARRAY
  const render1DGrid = useMemo(() => {
    const cells: JSX.Element[] = [];
    
    for (let i = 0; i < dimensions[0]; i++) {
      const cellX = PADDING + i * (CELL_WIDTH + CELL_SPACING);
      const cellY = HEADER_HEIGHT + PADDING;
      const value = getValueAt([i]);
      
      cells.push(
        <ArrayCell
          key={`cell-${i}`}
          id={`${id}-cell-${i}`}
          index={[i]}
          value={value}
          baseType={baseType}
          x={cellX}
          y={cellY}
          width={CELL_WIDTH}
          height={CELL_HEIGHT}
          isUpdated={isCellUpdated([i])}
        />
      );
    }
    
    return cells;
  }, [dimensions, baseType, id, getValueAt, isCellUpdated]);

  // RENDER: 2D ARRAY
  const render2DGrid = useMemo(() => {
    const cells: JSX.Element[] = [];
    const [rows, cols] = dimensions;
    
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const cellX = PADDING + j * (CELL_WIDTH + CELL_SPACING);
        const cellY = HEADER_HEIGHT + PADDING + i * (CELL_HEIGHT + CELL_SPACING);
        const value = getValueAt([i, j]);
        
        cells.push(
          <ArrayCell
            key={`cell-${i}-${j}`}
            id={`${id}-cell-${i}-${j}`}
            index={[i, j]}
            value={value}
            baseType={baseType}
            x={cellX}
            y={cellY}
            width={CELL_WIDTH}
            height={CELL_HEIGHT}
            isUpdated={isCellUpdated([i, j])}
          />
        );
      }
    }
    
    return cells;
  }, [dimensions, baseType, id, getValueAt, isCellUpdated]);

  // RENDER: 3D ARRAY (TABBED PLANES)
  const render3DGrid = useMemo(() => {
    const elements: JSX.Element[] = [];
    const [planes, rows, cols] = dimensions;
    
    // Render tabs
    for (let p = 0; p < planes; p++) {
      const tabX = PADDING + p * 60;
      const isActive = p === activeTab;
      
      elements.push(
        <Group key={`tab-${p}`}>
          <Rect
            x={tabX}
            y={HEADER_HEIGHT}
            width={55}
            height={TAB_HEIGHT}
            fill={isActive ? '#3B82F6' : '#334155'}
            stroke={isActive ? '#60A5FA' : '#475569'}
            strokeWidth={1}
            cornerRadius={[4, 4, 0, 0]}
            onClick={() => setActiveTab(p)}
            onTap={() => setActiveTab(p)}
          />
          <Text
            text={`[${p}]`}
            x={tabX}
            y={HEADER_HEIGHT + 8}
            width={55}
            fontSize={12}
            fontStyle="bold"
            fill="#F1F5F9"
            align="center"
            fontFamily="'SF Mono', monospace"
            listening={false}
          />
        </Group>
      );
    }
    
    // Render active plane cells
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const cellX = PADDING + j * (CELL_WIDTH + CELL_SPACING);
        const cellY = HEADER_HEIGHT + TAB_HEIGHT + PADDING + i * (CELL_HEIGHT + CELL_SPACING);
        const value = getValueAt([activeTab, i, j]);
        
        elements.push(
          <ArrayCell
            key={`cell-${activeTab}-${i}-${j}`}
            id={`${id}-cell-${activeTab}-${i}-${j}`}
            index={[activeTab, i, j]}
            value={value}
            baseType={baseType}
            x={cellX}
            y={cellY}
            width={CELL_WIDTH}
            height={CELL_HEIGHT}
            isUpdated={isCellUpdated([activeTab, i, j])}
          />
        );
      }
    }
    
    return elements;
  }, [dimensions, activeTab, baseType, id, getValueAt, isCellUpdated]);

  return (
    <Group ref={groupRef} id={id} x={x} y={y}>
      {/* Background */}
      <Rect
        width={boxWidth}
        height={boxHeight}
        fill="rgba(30, 41, 59, 0.95)"
        stroke="#10B981"
        strokeWidth={2}
        cornerRadius={8}
        shadowColor="rgba(0, 0, 0, 0.3)"
        shadowBlur={12}
        shadowOffsetY={4}
        listening={false}
      />

      {/* Header */}
      <Rect
        width={boxWidth}
        height={HEADER_HEIGHT}
        fill="rgba(16, 185, 129, 0.2)"
        cornerRadius={[8, 8, 0, 0]}
        listening={false}
      />

      {/* Array Name */}
      <Text
        text={`${name}[${dimensions.join('][')}]`}
        x={12}
        y={12}
        fontSize={16}
        fontStyle="bold"
        fill="#F1F5F9"
        fontFamily="'SF Pro Display', system-ui"
        listening={false}
      />

      {/* Type & Address */}
      <Text
        text={`${baseType} • ${address}`}
        x={12}
        y={32}
        fontSize={11}
        fill="#94A3B8"
        fontFamily="'SF Mono', monospace"
        listening={false}
      />

      {/* Divider */}
      <Line
        points={[0, HEADER_HEIGHT, boxWidth, HEADER_HEIGHT]}
        stroke="#334155"
        strokeWidth={1}
        listening={false}
      />

      {/* Grid */}
      {is1D && render1DGrid}
      {is2D && render2DGrid}
      {is3D && render3DGrid}
    </Group>
  );
}, (prevProps, nextProps) => {
  // Only re-render if values or updatedIndices changed
  return (
    prevProps.values === nextProps.values &&
    JSON.stringify(prevProps.updatedIndices) === JSON.stringify(nextProps.updatedIndices) &&
    prevProps.currentStep === nextProps.currentStep &&
    JSON.stringify(prevProps.dimensions) === JSON.stringify(nextProps.dimensions)
  );
});

ArrayBox.displayName = 'ArrayBox';

export default ArrayBox;