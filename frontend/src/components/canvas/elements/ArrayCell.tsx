import React, { useRef, useEffect, memo } from 'react';
import { Group, Rect, Text } from 'react-konva';
import Konva from 'konva';

export interface ArrayCellProps {
  id: string;
  index: number[];
  value: any;
  baseType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isNew?: boolean;
  isUpdated?: boolean;
  isHovered?: boolean;
  onClick?: () => void;
  explanation?: string;
}

const TYPE_COLORS: Record<string, string> = {
  int: '#3B82F6',
  float: '#10B981',
  double: '#8B5CF6',
  char: '#F59E0B',
  bool: '#EAB308',
  default: '#64748B'
};

const getTypeColor = (type: string): string => {
  const normalized = type.toLowerCase();
  return TYPE_COLORS[normalized] || TYPE_COLORS.default;
};

const EXPLANATION_HEIGHT = 22;

export const ArrayCell: React.FC<ArrayCellProps> = memo(({
  id,
  index,
  value,
  baseType,
  x,
  y,
  width,
  height,
  isNew = false,
  isUpdated = false,
  isHovered = false,
  onClick,
  explanation
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const bgRef = useRef<Konva.Rect>(null);
  
  const color = getTypeColor(baseType);
  
  const formatValue = (val: any): string => {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'string') return `'${val}'`;
    if (typeof val === 'boolean') return val ? '1' : '0';
    if (typeof val === 'number' && Number.isInteger(val)) return String(val);
    if (typeof val === 'number') return val.toFixed(2);
    return String(val);
  };

  const displayValue = formatValue(value);
  const indexLabel = index.length === 1 
    ? `[${index[0]}]`
    : index.length === 2
    ? `[${index[0]},${index[1]}]`
    : `[${index.join(',')}]`;

  const totalHeight = explanation ? height + EXPLANATION_HEIGHT + 2 : height;

  useEffect(() => {
    const bg = bgRef.current;
    if (!bg || !isUpdated) return;

    const originalFill = bg.fill();
    
    bg.fill('#FBBF24');
    bg.to({
      fill: originalFill,
      duration: 0.4,
      easing: Konva.Easings.EaseInOut
    });
  }, [isUpdated, value]);

  return (
    <Group
      ref={groupRef}
      id={id}
      x={x}
      y={y}
      onClick={onClick}
      onTap={onClick}
    >
      <Rect
        ref={bgRef}
        width={width}
        height={height}
        fill={isUpdated ? '#FEF3C7' : '#1E293B'}
        stroke={color}
        strokeWidth={isHovered ? 2 : 1}
        cornerRadius={4}
        shadowColor="rgba(0, 0, 0, 0.2)"
        shadowBlur={isHovered ? 8 : 4}
        shadowOffsetY={2}
        listening={false}
      />

      <Text
        text={indexLabel}
        x={4}
        y={4}
        fontSize={9}
        fill="#64748B"
        fontFamily="'SF Mono', monospace"
        width={width - 8}
        align="center"
        listening={false}
      />

      <Text
        text={displayValue}
        x={4}
        y={height / 2 - 8}
        fontSize={14}
        fontStyle="bold"
        fill="#F1F5F9"
        fontFamily="'SF Mono', monospace"
        width={width - 8}
        align="center"
        listening={false}
      />

      {explanation && (
        <Group y={height + 2}>
          <Rect
            width={width}
            height={EXPLANATION_HEIGHT}
            fill="rgba(30, 41, 59, 0.9)"
            stroke="#64748B"
            strokeWidth={1}
            cornerRadius={4}
          />
          <Text
            text={explanation}
            x={4}
            y={6}
            width={width - 8}
            fontSize={8}
            fill="#E2E8F0"
            fontFamily="'SF Mono', monospace"
            align="center"
          />
        </Group>
      )}
    </Group>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.value === nextProps.value &&
    prevProps.isUpdated === nextProps.isUpdated &&
    prevProps.isHovered === nextProps.isHovered &&
    prevProps.isNew === nextProps.isNew &&
    prevProps.explanation === nextProps.explanation
  );
});

ArrayCell.displayName = 'ArrayCell';

export default ArrayCell;