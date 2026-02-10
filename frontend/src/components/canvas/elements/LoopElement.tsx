// frontend/src/components/canvas/elements/LoopElement.tsx
// COMPLETE - Loop visualization with toggle mode and skip functionality

import React, { useRef, useEffect, useState, memo } from 'react';
import { Group, Rect, Text, Line, Circle, Path } from 'react-konva';
import Konva from 'konva';

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface LoopElementProps {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  
  // Loop metadata
  loopType: 'for' | 'while' | 'do-while';
  loopId: number;
  
  // Loop state
  currentIteration?: number;
  totalIterations?: number;
  isActive?: boolean;
  isComplete?: boolean;
  
  // Loop details
  initialization?: string;
  condition?: string;
  update?: string;
  conditionResult?: boolean;
  
  // Visual state
  isNew?: boolean;
  stepNumber?: number;
  enterDelay?: number;
  
  // Children
  children?: React.ReactNode;
  
  // Callbacks
  onSkip?: () => void;
}

// ============================================
// CONSTANTS
// ============================================

const BOX_WIDTH = 400;
const HEADER_HEIGHT = 70;
const MIN_BODY_HEIGHT = 100;
const PADDING = 16;
const CORNER_RADIUS = 10;

const COLORS = {
  for: {
    primary: '#F59E0B',
    light: '#FCD34D',
    bg: 'rgba(245, 158, 11, 0.12)',
    glow: 'rgba(245, 158, 11, 0.6)',
    accent: '#FBBF24'
  },
  while: {
    primary: '#8B5CF6',
    light: '#C084FC',
    bg: 'rgba(139, 92, 246, 0.12)',
    glow: 'rgba(139, 92, 246, 0.6)',
    accent: '#A78BFA'
  },
  'do-while': {
    primary: '#EC4899',
    light: '#F472B6',
    bg: 'rgba(236, 72, 153, 0.12)',
    glow: 'rgba(236, 72, 153, 0.6)',
    accent: '#F9A8D4'
  },
  active: {
    primary: '#10B981',
    glow: 'rgba(16, 185, 129, 0.7)'
  },
  complete: {
    primary: '#64748B',
    glow: 'rgba(100, 116, 139, 0.5)'
  }
};

// ============================================
// LOOP ELEMENT COMPONENT
// ============================================

export const LoopElement: React.FC<LoopElementProps> = memo(({
  id,
  x,
  y,
  width,
  height,
  loopType,
  loopId,
  currentIteration = 0,
  totalIterations,
  isActive = false,
  isComplete = false,
  initialization,
  condition,
  update,
  conditionResult,
  isNew = false,
  stepNumber,
  enterDelay = 0,
  children,
  onSkip,
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const glowRef = useRef<Konva.Rect>(null);
  const progressRef = useRef<Konva.Rect>(null);
  const [isHovered, setIsHovered] = useState(false);
  const isInitialMount = useRef(true);

  const totalWidth = width || BOX_WIDTH;
  const totalHeight = height || 200;

  const colorScheme = isComplete 
    ? COLORS.complete 
    : isActive 
      ? COLORS.active 
      : COLORS[loopType];

  const borderColor = isActive 
    ? COLORS.active.primary 
    : isComplete
      ? COLORS.complete.primary
      : colorScheme.primary;

  // Calculate progress percentage
  const progressPercent = totalIterations && totalIterations > 0 
    ? Math.min((currentIteration / totalIterations) * 100, 100)
    : 0;

  // ============================================
  // ENTRANCE ANIMATION
  // ============================================
  useEffect(() => {
    const group = groupRef.current;
    const glow = glowRef.current;

    if (!group) return;

    if (isNew && isInitialMount.current) {
      group.opacity(0);
      group.scaleX(0.85);
      group.scaleY(0.85);
      const origY = group.y();
      group.y(origY + 30);

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
            if (glow) glow.to({ opacity: 0.7, duration: 0.3 });
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
      if (glow) glow.opacity(0.7);
      isInitialMount.current = false;
    }
  }, [isNew, enterDelay]);

  // ============================================
  // ACTIVE STATE ANIMATION
  // ============================================
  useEffect(() => {
    if (isActive && glowRef.current) {
      glowRef.current.to({
        shadowBlur: 28,
        opacity: 0.85,
        duration: 0.25
      });
    } else if (glowRef.current) {
      glowRef.current.to({
        shadowBlur: 16,
        opacity: 0.7,
        duration: 0.25
      });
    }
  }, [isActive]);

  // ============================================
  // PROGRESS BAR ANIMATION
  // ============================================
  useEffect(() => {
    if (progressRef.current && totalIterations && totalIterations > 0) {
      const targetWidth = (progressPercent / 100) * (totalWidth - PADDING * 2);
      progressRef.current.to({
        width: targetWidth,
        duration: 0.4,
        easing: Konva.Easings.EaseInOut
      });
    }
  }, [currentIteration, totalIterations, progressPercent, totalWidth]);

  // ============================================
  // LOOP TYPE ICON
  // ============================================
  const getLoopIcon = () => {
    switch (loopType) {
      case 'for':
        return '🔄';
      case 'while':
        return '🔁';
      case 'do-while':
        return '🔃';
      default:
        return '🔄';
    }
  };

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
        shadowBlur={16}
        shadowOpacity={0.7}
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

      {/* Loop Type Badge */}
      <Group x={PADDING} y={10}>
        <Rect
          width={120}
          height={24}
          fill={colorScheme.primary}
          cornerRadius={12}
          opacity={0.35}
        />
        <Text
          text={`${getLoopIcon()} ${loopType.toUpperCase()}`}
          x={8}
          y={5}
          fontSize={12}
          fontStyle="bold"
          fill={colorScheme.light}
          fontFamily="'SF Pro Display', system-ui"
        />
      </Group>

      {/* Skip Button */}
      {onSkip && (
        <Group 
            x={totalWidth - 145} 
            y={10}
            onClick={(e) => {
                if (e && e.cancelBubble !== undefined) e.cancelBubble = true;
                if (onSkip) onSkip();
            }}
            onMouseEnter={(e) => {
                const container = e.target.getStage()?.container();
                if (container) container.style.cursor = "pointer";
            }}
            onMouseLeave={(e) => {
                const container = e.target.getStage()?.container();
                if (container) container.style.cursor = "default";
            }}
        >
             <Rect width={28} height={24} fill="rgba(239, 68, 68, 0.15)" stroke="#EF4444" strokeWidth={1} cornerRadius={6} />
             <Text text="⏩" x={6} y={6} fontSize={12} />
        </Group>
      )}

      {/* Iteration Counter */}
      {totalIterations !== undefined && (
        <Group x={totalWidth - 110} y={10}>
          <Rect
            width={95}
            height={24}
            fill="rgba(51, 65, 85, 0.6)"
            stroke={colorScheme.accent}
            strokeWidth={1.5}
            cornerRadius={12}
          />
          <Text
            text={`${currentIteration} / ${totalIterations}`}
            width={95}
            y={5}
            fontSize={11}
            fontStyle="bold"
            fill={colorScheme.light}
            align="center"
            fontFamily="'SF Mono', monospace"
          />
        </Group>
      )}

      {/* Loop Details */}
      <Group y={40}>
        {loopType === 'for' && (
          <>
            {initialization && (
              <Text
                text={`Init: ${initialization}`}
                x={PADDING + 6}
                y={0}
                fontSize={9}
                fill="#94A3B8"
                fontFamily="'SF Mono', monospace"
              />
            )}
            {condition && (
              <Text
                text={`Cond: ${condition}`}
                x={PADDING + 6}
                y={14}
                fontSize={9}
                fill={conditionResult ? '#10B981' : '#EF4444'}
                fontFamily="'SF Mono', monospace"
                fontStyle="bold"
              />
            )}
            {update && (
              <Text
                text={`Update: ${update}`}
                x={PADDING + 6}
                y={28}
                fontSize={9}
                fill="#94A3B8"
                fontFamily="'SF Mono', monospace"
              />
            )}
          </>
        )}
        
        {loopType === 'while' && condition && (
          <Group>
            <Text
              text="CONDITION:"
              x={PADDING + 6}
              y={0}
              fontSize={8}
              fontStyle="bold"
              fill="#64748B"
              fontFamily="'SF Pro Display', system-ui"
              letterSpacing={1}
            />
            <Text
              text={condition}
              x={PADDING + 6}
              y={14}
              fontSize={10}
              fill={conditionResult ? '#10B981' : '#EF4444'}
              fontFamily="'SF Mono', monospace"
              fontStyle="bold"
            />
          </Group>
        )}

        {loopType === 'do-while' && condition && (
          <Group>
            <Text
              text="DO-WHILE CONDITION:"
              x={PADDING + 6}
              y={0}
              fontSize={8}
              fontStyle="bold"
              fill="#64748B"
              fontFamily="'SF Pro Display', system-ui"
              letterSpacing={1}
            />
            <Text
              text={condition}
              x={PADDING + 6}
              y={14}
              fontSize={10}
              fill={conditionResult ? '#10B981' : '#EF4444'}
              fontFamily="'SF Mono', monospace"
              fontStyle="bold"
            />
          </Group>
        )}
      </Group>

      {/* Divider */}
      <Line
        points={[0, HEADER_HEIGHT, totalWidth, HEADER_HEIGHT]}
        stroke="#334155"
        strokeWidth={1.5}
      />

      {/* Progress Bar */}
      {totalIterations !== undefined && totalIterations > 0 && (
        <Group y={HEADER_HEIGHT - 8}>
          <Rect
            x={PADDING}
            width={totalWidth - PADDING * 2}
            height={6}
            fill="rgba(51, 65, 85, 0.5)"
            cornerRadius={3}
          />
          <Rect
            ref={progressRef}
            x={PADDING}
            width={0}
            height={6}
            fill={colorScheme.primary}
            cornerRadius={3}
            shadowColor={colorScheme.primary}
            shadowBlur={8}
            shadowOpacity={0.6}
          />
        </Group>
      )}

      {/* Body Section */}
      <Group y={HEADER_HEIGHT + 10}>
        {children}
      </Group>

      {/* Condition Result Indicator */}
      {conditionResult !== undefined && (
        <Group x={PADDING} y={totalHeight - 28}>
          <Rect
            width={conditionResult ? 110 : 130}
            height={20}
            fill={conditionResult 
              ? 'rgba(16, 185, 129, 0.2)' 
              : 'rgba(239, 68, 68, 0.2)'}
            stroke={conditionResult ? '#10B981' : '#EF4444'}
            strokeWidth={1.5}
            cornerRadius={10}
          />
          <Text
            text={conditionResult 
              ? '✓ CONTINUE' 
              : '✗ EXIT LOOP'}
            width={conditionResult ? 110 : 130}
            y={4}
            fontSize={9}
            fontStyle="bold"
            fill={conditionResult ? '#34D399' : '#FCA5A5'}
            align="center"
            fontFamily="'SF Pro Display', system-ui"
          />
        </Group>
      )}

      {/* Complete Badge */}
      {isComplete && (
        <Group x={totalWidth - 85} y={totalHeight - 28}>
          <Rect
            width={70}
            height={20}
            fill="rgba(100, 116, 139, 0.25)"
            stroke="#94A3B8"
            strokeWidth={1.5}
            cornerRadius={10}
          />
          <Text
            text="🏁 DONE"
            width={70}
            y={4}
            fontSize={9}
            fontStyle="bold"
            fill="#CBD5E1"
            align="center"
            fontFamily="'SF Pro Display', system-ui"
          />
        </Group>
      )}

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

      {/* Active Pulse Indicator */}
      {isActive && (
        <Circle
          x={totalWidth - 18}
          y={18}
          radius={5}
          fill={COLORS.active.primary}
          shadowColor={COLORS.active.primary}
          shadowBlur={12}
          shadowOpacity={1}
        />
      )}
    </Group>
  );
});

LoopElement.displayName = 'LoopElement';

export default LoopElement;