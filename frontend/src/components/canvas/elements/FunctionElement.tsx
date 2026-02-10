// frontend/src/components/canvas/elements/FunctionElement.tsx
// COMPLETE FILE - REPLACE ENTIRELY

import React, { useRef, useEffect, useState, memo } from 'react';
import { Group, Rect, Text, Line, Circle } from 'react-konva';
import Konva from 'konva';

// ============================================
// TYPE DEFINITIONS
// ============================================

interface Parameter {
  name: string;
  type: string;
  value?: any;
}

export interface FunctionElementProps {
  id: string;
  functionName: string;
  returnType: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  
  // Metadata
  isRecursive?: boolean;
  depth?: number;
  calledFrom?: string;
  
  // Content
  parameters?: Parameter[];
  localVarCount?: number;
  
  // State
  isNew?: boolean;
  isActive?: boolean;
  isReturning?: boolean;
  stepNumber?: number;
  enterDelay?: number;
  
  // Children
  children?: React.ReactNode;
  
  // Callbacks
  onConnectorClick?: (pos: { x: number; y: number }) => void;
}

// ============================================
// CONSTANTS
// ============================================

const BOX_WIDTH = 400;
const HEADER_HEIGHT = 55;
const MIN_BODY_HEIGHT = 80;
const PADDING = 16;
const CORNER_RADIUS = 10;
const CONNECTOR_RADIUS = 11;

const COLORS = {
  recursive: {
    primary: '#F59E0B',
    light: '#FCD34D',
    bg: 'rgba(245, 158, 11, 0.12)',
    glow: 'rgba(245, 158, 11, 0.5)'
  },
  normal: {
    primary: '#8B5CF6',
    light: '#A78BFA',
    bg: 'rgba(139, 92, 246, 0.12)',
    glow: 'rgba(139, 92, 246, 0.5)'
  },
  active: {
    primary: '#10B981',
    glow: 'rgba(16, 185, 129, 0.7)'
  },
  returning: {
    primary: '#EF4444',
    glow: 'rgba(239, 68, 68, 0.6)'
  }
};

// ============================================
// MAIN COMPONENT
// ============================================

export const FunctionElement: React.FC<FunctionElementProps> = memo(({
  id,
  functionName,
  returnType,
  x,
  y,
  width,
  height,
  isRecursive = false,
  depth = 0,
  calledFrom,
  parameters = [],
  localVarCount = 0,
  isNew = false,
  isActive = false,
  isReturning = false,
  stepNumber,
  enterDelay = 0,
  children,
  onConnectorClick,
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const glowRef = useRef<Konva.Rect>(null);
  const connectorRef = useRef<Konva.Circle>(null);
  const [isHovered, setIsHovered] = useState(false);
  const isInitialMount = useRef(true);

  // Use prop height/width directly (calculated by LayoutEngine)
  const totalWidth = width || BOX_WIDTH;
  const totalHeight = height || 150;

  const colorScheme = isReturning 
    ? COLORS.returning 
    : isRecursive 
      ? COLORS.recursive 
      : COLORS.normal;

  const borderColor = isActive ? COLORS.active.primary : colorScheme.primary;

  // ============================================
  // ENTRANCE ANIMATION
  // ============================================
  useEffect(() => {
    const group = groupRef.current;
    const glow = glowRef.current;

    if (!group) return;

    if (isNew && isInitialMount.current) {
      group.opacity(0);
      group.scaleX(0.8);
      group.scaleY(0.8);
      const origY = group.y();
      group.y(origY + 35);

      const playAnim = () => {
        if (!group.getLayer()) return;
        new Konva.Tween({
          node: group,
          opacity: 1,
          scaleX: 1,
          scaleY: 1,
          y: origY,
          duration: 0.55,
          easing: Konva.Easings.BackEaseOut,
          onFinish: () => {
            if (glow) glow.to({ opacity: 0.65, duration: 0.3 });
          }
        }).play();
      };

      if (enterDelay > 0) {
        const t = setTimeout(playAnim, enterDelay);
        return () => clearTimeout(t);
      } else {
        playAnim();
      }
    } else if (isInitialMount.current) {
      group.opacity(1);
      group.scaleX(1);
      group.scaleY(1);
      if (glow) glow.opacity(0.65);
      isInitialMount.current = false;
    }
  }, [isNew, enterDelay]);

  // ============================================
  // ACTIVE STATE ANIMATION
  // ============================================
  useEffect(() => {
    if (isActive && glowRef.current) {
      glowRef.current.to({
        shadowBlur: 32,
        opacity: 0.9,
        duration: 0.25
      });
    } else if (glowRef.current) {
      glowRef.current.to({
        shadowBlur: 18,
        opacity: 0.65,
        duration: 0.25
      });
    }
  }, [isActive]);

  // ============================================
  // CONNECTOR PULSE
  // ============================================
  useEffect(() => {
    if (isActive && connectorRef.current) {
      const pulse = new Konva.Tween({
        node: connectorRef.current,
        scaleX: 1.25,
        scaleY: 1.25,
        duration: 0.4,
        yoyo: true,
        repeat: -1
      });
      pulse.play();
      return () => pulse.destroy();
    }
  }, [isActive]);

  return (
    <Group
      ref={groupRef}
      id={`${id}-step-${stepNumber || 0}`}
      x={x}
      y={y}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Glow Effect */}
      <Rect
        ref={glowRef}
        x={-5}
        y={-5}
        width={totalWidth + 10}
        height={totalHeight + 10}
        fill="transparent"
        cornerRadius={CORNER_RADIUS + 3}
        shadowColor={isActive ? COLORS.active.glow : colorScheme.glow}
        shadowBlur={18}
        shadowOpacity={0.65}
        opacity={0}
      />

      {/* Main Background */}
      <Rect
        width={totalWidth}
        height={totalHeight}
        fill="rgba(15, 23, 42, 0.96)"
        stroke={borderColor}
        strokeWidth={isActive ? 3 : 2}
        cornerRadius={CORNER_RADIUS}
        shadowColor="rgba(0, 0, 0, 0.35)"
        shadowBlur={14}
        shadowOffsetY={3}
      />

      {/* Header Background */}
      <Rect
        width={totalWidth}
        height={HEADER_HEIGHT}
        fill={colorScheme.bg}
        cornerRadius={[CORNER_RADIUS, CORNER_RADIUS, 0, 0]}
      />

      {/* Accent Line */}
      <Line
        points={[0, 0, 0, HEADER_HEIGHT]}
        stroke={colorScheme.primary}
        strokeWidth={5}
        lineCap="round"
      />

      {/* Function Name */}
      <Text
        text={functionName}
        x={PADDING}
        y={10}
        fontSize={18}
        fontStyle="bold"
        fill="#F1F5F9"
        fontFamily="'SF Pro Display', system-ui"
      />

      {/* Return Type Badge */}
      <Group x={PADDING} y={32}>
        <Rect
          width={returnType.length * 7.5 + 14}
          height={16}
          fill={colorScheme.primary}
          cornerRadius={8}
          opacity={0.4}
        />
        <Text
          text={returnType}
          x={7}
          y={2.5}
          fontSize={10}
          fontStyle="bold"
          fill={colorScheme.light}
          fontFamily="'SF Mono', monospace"
        />
      </Group>

      {/* Recursive Badge */}
      {isRecursive && (
        <Group x={totalWidth - 95} y={8}>
          <Rect
            width={85}
            height={20}
            fill={COLORS.recursive.primary}
            cornerRadius={10}
            opacity={0.25}
          />
          <Text
            text="🔄 RECURSIVE"
            width={85}
            y={4}
            fontSize={9}
            fontStyle="bold"
            fill={COLORS.recursive.light}
            align="center"
            fontFamily="'SF Pro Display', system-ui"
          />
        </Group>
      )}

      {/* Depth Indicator */}
      {depth > 0 && (
        <Text
          text={`depth: ${depth}`}
          x={totalWidth - 95}
          y={32}
          fontSize={8}
          fill="#94A3B8"
          fontFamily="'SF Mono', monospace"
          fontStyle="italic"
        />
      )}

      {/* Called From */}
      {calledFrom && (
        <Text
          text={`← ${calledFrom}`}
          x={PADDING + returnType.length * 7.5 + 30}
          y={35}
          fontSize={8}
          fill="#64748B"
          fontFamily="'SF Mono', monospace"
          fontStyle="italic"
        />
      )}

      {/* Divider */}
      <Line
        points={[0, HEADER_HEIGHT, totalWidth, HEADER_HEIGHT]}
        stroke="#334155"
        strokeWidth={1}
      />

      {/* Body Section */}
      <Group y={HEADER_HEIGHT}>
        {/* Parameters */}
        {parameters.length > 0 && (
          <Group y={PADDING}>
            <Text
              text="PARAMS:"
              x={PADDING}
              fontSize={9}
              fontStyle="bold"
              fill="#64748B"
              fontFamily="'SF Pro Display', system-ui"
              letterSpacing={1}
            />
            {parameters.map((param, idx) => (
              <Group key={idx} y={20 + idx * 28}>
                <Rect
                  x={PADDING}
                  width={totalWidth - PADDING * 2}
                  height={24}
                  fill="rgba(51, 65, 85, 0.5)"
                  stroke="#475569"
                  strokeWidth={1}
                  cornerRadius={5}
                />
                <Text
                  text={param.type}
                  x={PADDING + 8}
                  y={5}
                  fontSize={9}
                  fontStyle="bold"
                  fill="#60A5FA"
                  fontFamily="'SF Mono', monospace"
                />
                <Text
                  text={param.name}
                  x={PADDING + 60}
                  y={5}
                  fontSize={11}
                  fontStyle="bold"
                  fill="#F1F5F9"
                  fontFamily="'SF Mono', monospace"
                />
                {param.value !== undefined && (
                  <Text
                    text={`= ${param.value}`}
                    x={totalWidth - PADDING - 70}
                    y={5}
                    fontSize={10}
                    fill="#10B981"
                    fontFamily="'SF Mono', monospace"
                  />
                )}
              </Group>
            ))}
          </Group>
        )}

        {/* Children */}
        {children}
      </Group>

      {/* Call Connector */}
      <Group
        x={totalWidth}
        y={totalHeight / 2}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={() => onConnectorClick?.({ x: totalWidth, y: totalHeight / 2 })}
        onTap={() => onConnectorClick?.({ x: totalWidth, y: totalHeight / 2 })}
      >
        <Circle
          radius={CONNECTOR_RADIUS + 3}
          fill="transparent"
          shadowColor={isActive ? COLORS.active.glow : colorScheme.glow}
          shadowBlur={isActive ? 18 : 10}
          shadowOpacity={isHovered || isActive ? 0.9 : 0.6}
        />
        <Circle
          radius={CONNECTOR_RADIUS}
          stroke={isActive ? COLORS.active.primary : colorScheme.primary}
          strokeWidth={isHovered ? 2.5 : 2}
          fill="rgba(30, 41, 59, 0.9)"
        />
        <Circle
          ref={connectorRef}
          radius={CONNECTOR_RADIUS - 5}
          fill={isActive ? COLORS.active.primary : colorScheme.light}
          opacity={isActive ? 1 : 0.7}
        />
        <Text
          text="→"
          x={-5}
          y={-7}
          fontSize={12}
          fill="#F1F5F9"
          fontStyle="bold"
        />
      </Group>

      {/* Step Number */}
      {stepNumber !== undefined && (
        <Text
          text={`#${stepNumber}`}
          x={totalWidth - 45}
          y={totalHeight - 18}
          fontSize={9}
          fontStyle="bold"
          fill="#475569"
          fontFamily="'SF Mono', monospace"
        />
      )}

      {/* Returning Indicator */}
      {isReturning && (
        <Group x={PADDING} y={totalHeight - 25}>
          <Rect
            width={80}
            height={18}
            fill="rgba(239, 68, 68, 0.2)"
            stroke="#EF4444"
            strokeWidth={1}
            cornerRadius={9}
          />
          <Text
            text="↩ RETURNING"
            width={80}
            y={3}
            fontSize={8}
            fontStyle="bold"
            fill="#FCA5A5"
            align="center"
            fontFamily="'SF Pro Display', system-ui"
          />
        </Group>
      )}
    </Group>
  );
});

FunctionElement.displayName = 'FunctionElement';

export default FunctionElement;