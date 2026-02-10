// frontend/src/components/canvas/elements/ReturnElement.tsx
// COMPLETE FILE - REPLACE ENTIRELY

import React, { useRef, useEffect, useState, memo } from 'react';
import { Group, Rect, Text, Circle } from 'react-konva';
import Konva from 'konva';

export interface ReturnElementProps {
  id: string;
  x: number;
  y: number;
  returnValue?: any;
  functionName: string;
  frameId: string;
  isNew?: boolean;
  stepNumber?: number;
  enterDelay?: number;
}

const BOX_WIDTH = 360;
const BOX_HEIGHT = 70;
const PADDING = 12;
const CORNER_RADIUS = 8;

const COLORS = {
  primary: '#EF4444',
  light: '#FCA5A5',
  bg: 'rgba(239, 68, 68, 0.15)',
  bgDark: 'rgba(127, 29, 29, 0.9)',
  glow: 'rgba(239, 68, 68, 0.6)'
};

export const ReturnElement: React.FC<ReturnElementProps> = memo(({
  id,
  x,
  y,
  returnValue,
  functionName,
  frameId,
  isNew = false,
  stepNumber,
  enterDelay = 0
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const glowRef = useRef<Konva.Rect>(null);
  const isInitialMount = useRef(true);
  const [showingExplanation, setShowingExplanation] = useState(true);

  const hasValue = returnValue !== undefined && returnValue !== null;
  const displayValue = hasValue ? String(returnValue) : 'void';

  // Entrance animation
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    if (isNew && isInitialMount.current) {
      group.opacity(0);
      group.scaleX(0.8);
      group.scaleY(0.8);
      const origY = group.y();
      group.y(origY + 20);

      const playAnim = () => {
        if (!group.getLayer()) return;
        new Konva.Tween({
          node: group,
          opacity: 1,
          scaleX: 1,
          scaleY: 1,
          y: origY,
          duration: 0.5,
          easing: Konva.Easings.BackEaseOut,
          onFinish: () => {
            if (glowRef.current) {
              glowRef.current.to({ opacity: 0.7, duration: 0.3 });
            }
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
      isInitialMount.current = false;
    }
  }, [isNew, enterDelay]);

  // Color transition
  useEffect(() => {
    if (showingExplanation) {
      const timer = setTimeout(() => {
        setShowingExplanation(false);
        const group = groupRef.current;
        if (group) {
          const mainBg = group.findOne('.main-bg');
          const explBg = group.findOne('.explanation-bg');
          if (mainBg) {
            mainBg.to({ fill: COLORS.bgDark, stroke: '#7F1D1D', duration: 0.5 });
          }
          if (explBg) {
            explBg.to({ fill: 'rgba(127, 29, 29, 0.9)', duration: 0.5 });
          }
        }
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [showingExplanation]);

  return (
    <Group
      ref={groupRef}
      id={`${id}-step-${stepNumber || 0}`}
      x={x}
      y={y}
    >
      {/* Glow */}
      <Rect
        ref={glowRef}
        x={-3}
        y={-3}
        width={BOX_WIDTH + 6}
        height={BOX_HEIGHT + 6}
        fill="transparent"
        cornerRadius={CORNER_RADIUS + 2}
        shadowColor={COLORS.glow}
        shadowBlur={12}
        shadowOpacity={0.5}
        opacity={0}
      />

      {/* Main Background */}
      <Rect
        name="main-bg"
        width={BOX_WIDTH}
        height={BOX_HEIGHT}
        fill={showingExplanation ? COLORS.bg : COLORS.bgDark}
        stroke={showingExplanation ? COLORS.primary : '#7F1D1D'}
        strokeWidth={2}
        cornerRadius={CORNER_RADIUS}
        shadowColor="rgba(0, 0, 0, 0.3)"
        shadowBlur={10}
        shadowOffsetY={2}
      />

      {/* Return Icon */}
      <Circle
        x={PADDING + 12}
        y={16}
        radius={14}
        fill={COLORS.primary}
        opacity={0.2}
      />
      <Text
        text="↩"
        x={PADDING + 3}
        y={8}
        fontSize={20}
        fill={COLORS.light}
        fontStyle="bold"
      />

      {/* Function Name */}
      <Text
        text={`${functionName}()`}
        x={PADDING + 32}
        y={8}
        fontSize={12}
        fontStyle="bold"
        fill={showingExplanation ? '#7F1D1D' : COLORS.light}
        fontFamily="'SF Mono', monospace"
      />

      {/* Return Value - PROMINENT */}
      <Group y={32}>
        <Text
          text="RETURNS:"
          x={PADDING}
          y={0}
          fontSize={9}
          fontStyle="bold"
          fill={showingExplanation ? '#991B1B' : '#F87171'}
          fontFamily="'SF Pro Display', system-ui"
          letterSpacing={1}
        />
        <Rect
          x={PADDING + 70}
          y={-4}
          width={displayValue.length * 11 + 16}
          height={24}
          fill={hasValue ? 'rgba(16, 185, 129, 0.2)' : 'rgba(100, 116, 139, 0.2)'}
          stroke={hasValue ? '#10B981' : '#64748B'}
          strokeWidth={1}
          cornerRadius={6}
        />
        <Text
          text={displayValue}
          x={PADDING + 78}
          y={2}
          fontSize={16}
          fontStyle="bold"
          fill={hasValue ? '#10B981' : '#64748B'}
          fontFamily="'SF Mono', monospace"
        />
      </Group>

      {/* Explanation */}
      <Group y={BOX_HEIGHT - 8}>
        <Text
          text={`💡 Returns to ${frameId.split('-')[0]}`}
          x={PADDING}
          y={-14}
          width={BOX_WIDTH - PADDING * 2}
          fontSize={9}
          fill={showingExplanation ? '#7F1D1D' : COLORS.light}
          fontFamily="'SF Pro Display', system-ui"
          align="center"
          fontStyle="italic"
        />
      </Group>

      {/* Step Number */}
      {stepNumber !== undefined && (
        <Text
          text={`#${stepNumber}`}
          x={BOX_WIDTH - 40}
          y={8}
          fontSize={9}
          fontStyle="bold"
          fill="#64748B"
          fontFamily="'SF Mono', monospace"
        />
      )}
    </Group>
  );
});

ReturnElement.displayName = 'ReturnElement';

export default ReturnElement;