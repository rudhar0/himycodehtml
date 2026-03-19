import React, { useRef, useEffect, memo } from 'react';
import { Group, Rect, Text } from 'react-konva';
import Konva from 'konva';

export interface BreakContinueElementProps {
  id: string;
  x: number;
  y: number;
  kind: 'break' | 'continue';
  line?: number;
  isNew?: boolean;
  stepNumber?: number;
  enterDelay?: number;
}

const BOX_WIDTH = 300;
const BOX_HEIGHT = 48;
const CORNER_RADIUS = 8;

const BREAK_COLORS = {
  primary: '#FF4D4D',
  light: '#FF9999',
  bg: 'rgba(255, 77, 77, 0.13)',
  border: 'rgba(255, 77, 77, 0.75)',
  glow: 'rgba(255, 77, 77, 0.55)',
  icon: '⛔',
  label: 'BREAK',
};

const CONTINUE_COLORS = {
  primary: '#3B82F6',
  light: '#93C5FD',
  bg: 'rgba(59, 130, 246, 0.13)',
  border: 'rgba(59, 130, 246, 0.75)',
  glow: 'rgba(59, 130, 246, 0.55)',
  icon: '⏭',
  label: 'CONTINUE',
};

export const BreakContinueElement: React.FC<BreakContinueElementProps> = memo(({
  id,
  x,
  y,
  kind,
  line,
  isNew = false,
  stepNumber,
  enterDelay = 0,
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const C = kind === 'break' ? BREAK_COLORS : CONTINUE_COLORS;

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    if (isNew) {
      group.opacity(0);
      group.scaleX(0.88);
      group.scaleY(0.88);
      const baseY = group.y();
      group.y(baseY + 10);

      const play = () => {
        if (!group.getLayer()) return;
        new Konva.Tween({
          node: group,
          opacity: 1,
          scaleX: 1,
          scaleY: 1,
          y: baseY,
          duration: 0.3,
          easing: Konva.Easings.BackEaseOut,
        }).play();
      };

      if (enterDelay > 0) {
        const t = setTimeout(play, enterDelay);
        return () => clearTimeout(t);
      }
      play();
    }
  }, [isNew, enterDelay]);

  return (
    <Group ref={groupRef} id={id} x={x} y={y}>
      {/* Glow */}
      <Rect
        x={-4}
        y={-4}
        width={BOX_WIDTH + 8}
        height={BOX_HEIGHT + 8}
        fill="transparent"
        cornerRadius={CORNER_RADIUS + 2}
        shadowColor={C.glow}
        shadowBlur={14}
        shadowOpacity={0.7}
      />

      {/* Background */}
      <Rect
        width={BOX_WIDTH}
        height={BOX_HEIGHT}
        fill={C.bg}
        stroke={C.border}
        strokeWidth={1.8}
        cornerRadius={CORNER_RADIUS}
        shadowColor={C.glow}
        shadowBlur={8}
        shadowOpacity={0.4}
      />

      {/* Left accent bar */}
      <Rect
        x={0}
        y={0}
        width={5}
        height={BOX_HEIGHT}
        fill={C.primary}
        cornerRadius={[CORNER_RADIUS, 0, 0, CORNER_RADIUS]}
        opacity={0.85}
      />

      {/* Icon */}
      <Text
        text={C.icon}
        x={14}
        y={14}
        fontSize={16}
        listening={false}
      />

      {/* Label */}
      <Text
        text={C.label}
        x={40}
        y={10}
        fontSize={13}
        fontStyle="bold"
        fill={C.light}
        fontFamily="'SF Mono', monospace"
        letterSpacing={1.5}
      />

      {/* Subtext */}
      <Text
        text={kind === 'break' ? 'exit loop' : 'next iteration'}
        x={40}
        y={27}
        fontSize={10}
        fill={C.primary}
        fontFamily="'SF Mono', monospace"
        opacity={0.7}
      />

      {/* Line number */}
      {line !== undefined && (
        <Text
          text={`L${line}`}
          x={BOX_WIDTH - 44}
          y={10}
          fontSize={9}
          fill={C.primary}
          fontFamily="'SF Mono', monospace"
          opacity={0.6}
        />
      )}

      {/* Step number */}
      {stepNumber !== undefined && (
        <Text
          text={`#${stepNumber}`}
          x={BOX_WIDTH - 44}
          y={24}
          fontSize={9}
          fontStyle="bold"
          fill={'#64748B'}
          fontFamily="'SF Mono', monospace"
        />
      )}
    </Group>
  );
});

BreakContinueElement.displayName = 'BreakContinueElement';
export default BreakContinueElement;
