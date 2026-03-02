// frontend/src/components/canvas/elements/ConditionElement.tsx
// COMPLETE - Conditional visualization for if/else/switch statements

import React, { useRef, useEffect, useMemo, useState, memo, useCallback } from 'react';
import { Group, Rect, Text, Line, Circle, Path } from 'react-konva';
import Konva from 'konva';
import { resizeContainer } from '../utils/resizeContainer';

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface ConditionElementProps {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  
  // Condition metadata
  conditionType: 'if' | 'if-else' | 'if-else-if' | 'switch';
  
  // Condition state
  condition: string;
  conditionResult?: boolean;
  branchTaken?: 'if' | 'else' | 'else-if' | 'default' | 'case';
  caseValue?: string | number;
  
  // Visual state
  isActive?: boolean;
  isNew?: boolean;
  stepNumber?: number;
  enterDelay?: number;
  headerOnly?: boolean;

  // Caller / trigger (used by arrow rendering / alignment)
  triggerElementId?: string;
  triggerStepId?: number;
  
  // Children
  children?: React.ReactNode;
  
  // Switch-specific
  switchExpression?: string;
  totalCases?: number;
}

// ============================================
// CONSTANTS
// ============================================

const BOX_WIDTH = 400;
const HEADER_HEIGHT = 75;
const MIN_BODY_HEIGHT = 100;
const FOOTER_HEIGHT = 52;
const PADDING = 16;
const CORNER_RADIUS = 10;

// Layout tuning for nested conditions
export const HORIZONTAL_GAP = 160;
export const SAFE_MARGIN = 24;

const COLORS = {
  if: {
    primary: '#FF7A18',
    light: '#FFB347',
    bg: 'rgba(255, 140, 0, 0.10)',
    glow: 'rgba(255,140,0,0.6)',
    accent: '#FFD08A',
  },
  'if-else': {
    primary: '#FF7A18',
    light: '#FFB347',
    bg: 'rgba(255, 140, 0, 0.10)',
    glow: 'rgba(255,140,0,0.6)',
    accent: '#FFD08A',
  },
  'if-else-if': {
    primary: '#FF7A18',
    light: '#FFB347',
    bg: 'rgba(255, 140, 0, 0.10)',
    glow: 'rgba(255,140,0,0.6)',
    accent: '#FFD08A',
  },
  switch: {
    primary: '#FF7A18',
    light: '#FFB347',
    bg: 'rgba(255, 140, 0, 0.10)',
    glow: 'rgba(255,140,0,0.6)',
    accent: '#FFD08A',
  },
  true: {
    primary: '#FFD166',
    light: '#FFE3A3',
    glow: 'rgba(255, 209, 102, 0.7)',
  },
  false: {
    primary: '#FF6B6B',
    light: '#FF9A9A',
    glow: 'rgba(255, 107, 107, 0.6)',
  },
};

// ============================================
// CONDITION ELEMENT COMPONENT
// ============================================

export const ConditionElement: React.FC<ConditionElementProps> = memo(({
  id,
  x,
  y,
  width,
  height,
  conditionType,
  condition,
  conditionResult,
  branchTaken,
  caseValue,
  isActive = false,
  isNew = false,
  stepNumber,
  enterDelay = 0,
  children,
  switchExpression,
  totalCases,
  triggerElementId,
  triggerStepId,
  headerOnly = false,
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const glowRef = useRef<Konva.Rect>(null);
  const [isHovered, setIsHovered] = useState(false);
  const isInitialMount = useRef(true);
  const tweenRef = useRef<Konva.Tween | null>(null);

  const hasBodyContent = useMemo(() => React.Children.count(children) > 0, [children]);
  // Header must always render; body only when executed and not header-only.
  // Body renders only when an actual branch was taken for this condition
  // (branchTaken is provided by the trace and indicates the executed branch).
  const executedBranch = Boolean(branchTaken);
  const shouldRenderBody = executedBranch && hasBodyContent && !headerOnly;

  const baseWidth = width || BOX_WIDTH;
  // Prevent false/skipped branches from reserving body space (compact header-only).
  const headerOnlyHeight = HEADER_HEIGHT + FOOTER_HEIGHT;
  const defaultBodyHeight = HEADER_HEIGHT + 10 + MIN_BODY_HEIGHT + FOOTER_HEIGHT;
  const baseHeight = shouldRenderBody
    ? Math.max(height || 0, defaultBodyHeight)
    : headerOnlyHeight;

  const [autoSize, setAutoSize] = useState({ width: baseWidth, height: baseHeight });
  const totalWidth = Math.max(baseWidth, autoSize.width);
  const totalHeight = Math.max(baseHeight, autoSize.height);

  const colorScheme = COLORS[conditionType];
  const resultColor = conditionResult !== undefined 
    ? (conditionResult ? COLORS.true : COLORS.false)
    : null;

  const borderColor = isActive 
    ? (resultColor?.primary || colorScheme.primary)
    : colorScheme.primary;

  // ============================================
  // ENTRANCE ANIMATION
  // ============================================
  useEffect(() => {
    const group = groupRef.current;
    const glow = glowRef.current;

    if (!group) return;
    if (tweenRef.current) {
      tweenRef.current.destroy();
      tweenRef.current = null;
    }

    if (isNew && isInitialMount.current) {
      group.opacity(0);
      group.scaleX(0.85);
      group.scaleY(0.85);
      const origY = group.y();
      group.y(origY + 30);

      const playAnim = () => {
        if (!group.getLayer()) return;
        const tween = new Konva.Tween({
          node: group,
          opacity: 1,
          scaleX: 1,
          scaleY: 1,
          y: origY,
          duration: 0.5,
          easing: Konva.Easings.BackEaseOut,
          onFinish: () => {
            if (glow) glow.to({ opacity: 0.7, duration: 0.3 });
            resizeContainer(group, { padding: 16, minWidth: baseWidth, minHeight: baseHeight });
            group.getLayer()?.batchDraw();
          }
        });
        tweenRef.current = tween;
        tween.play();
      };

      if (enterDelay > 0) {
        const t = setTimeout(playAnim, enterDelay);
        return () => {
          clearTimeout(t);
          if (tweenRef.current) {
            tweenRef.current.destroy();
            tweenRef.current = null;
          }
        };
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

    return () => {
      if (tweenRef.current) {
        tweenRef.current.destroy();
        tweenRef.current = null;
      }
    };
  }, [isNew, enterDelay, baseWidth, baseHeight]);

  const measureContent = useCallback(() => {
    const group = groupRef.current;
    if (!group || !group.getLayer()) return;
    if (!shouldRenderBody) return;
    if (group.scaleX() < 0.9 || group.scaleY() < 0.9 || group.opacity() < 1) return;

    const content = group.findOne<Konva.Node>('.content-bounds');
    if (!content) return;

    const bounds = content.getClientRect({
      relativeTo: group,
      skipTransform: true,
      skipShadow: true,
    });
    const padding = 16;
    const bottomReserve = FOOTER_HEIGHT; // space for result/branch/step indicators

    // Avoid self-inflating width: content-bounds includes the shell/header which already uses totalWidth.
    const desiredWidth = Math.ceil(Math.max(baseWidth, bounds.width));
    const desiredHeight = Math.ceil(
      Math.max(0, bounds.y + bounds.height) + padding + bottomReserve,
    );

    setAutoSize((prev) => {
      const nextWidth = Math.max(baseWidth, desiredWidth);
      const nextHeight = Math.max(baseHeight, desiredHeight);
      if (prev.width === nextWidth && prev.height === nextHeight) {
        return prev;
      }
      return { width: nextWidth, height: nextHeight };
    });
  }, [baseWidth, baseHeight, shouldRenderBody]);

  useEffect(() => {
    setAutoSize((prev) => {
      if (prev.width === baseWidth && prev.height === baseHeight) {
        return prev;
      }
      return { width: baseWidth, height: baseHeight };
    });
    const raf = requestAnimationFrame(measureContent);
    return () => cancelAnimationFrame(raf);
  }, [
    baseWidth,
    baseHeight,
    measureContent,
    children,
    conditionType,
    condition,
    conditionResult,
    branchTaken,
    caseValue,
    switchExpression,
    totalCases,
    isActive,
  ]);

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

  // Attach trigger metadata to the group so arrow/flow layout logic
  // (implemented elsewhere) can read the origin/step for accurate arrows.
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    try {
      if ((group as any).setAttr) {
        (group as any).setAttr('triggerElementId', ("" + (triggerElementId || '')) || undefined);
        (group as any).setAttr('triggerStepId', triggerStepId);
      }
    } catch (e) {
      // no-op
    }
  }, [triggerElementId, triggerStepId]);

  // ============================================
  // CONDITION TYPE ICON
  // ============================================
  const getConditionIcon = () => {
    switch (conditionType) {
      case 'if':
        return '❓';
      case 'if-else':
        return '⚖️';
      case 'if-else-if':
        return '🔀';
      case 'switch':
        return '🎛️';
      default:
        return '❓';
    }
  };

  // ============================================
  // BRANCH DISPLAY
  // ============================================
  const getBranchDisplay = () => {
    if (!branchTaken) return null;

    const branchLabels: Record<string, string> = {
      'if': '✓ IF BLOCK',
      'else': '↓ ELSE BLOCK',
      'else-if': '↪ ELSE-IF',
      'default': '⚡ DEFAULT',
      'case': `🎯 CASE ${caseValue}`
    };

    return branchLabels[branchTaken] || branchTaken.toUpperCase();
  };

  return (
    <Group
      ref={groupRef}
      id={id}
      x={x}
      y={y}
      name="auto-resize"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Glow Effect */}
      <Rect
        ref={glowRef}
        name="glow-bg"
        x={-5}
        y={-5}
        width={totalWidth + 10}
        height={totalHeight + 10}
        fill="transparent"
        cornerRadius={CORNER_RADIUS + 3}
        shadowColor={resultColor?.glow || colorScheme.glow}
        shadowBlur={16}
        shadowOpacity={0.7}
        opacity={0}
      />

      {/* Main Background */}
      <Rect
        name="main-bg"
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

      <Group name="content-bounds">
      {/* Header Background */}
      <Rect
        width={totalWidth}
        height={HEADER_HEIGHT}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: totalWidth, y: HEADER_HEIGHT }}
        fillLinearGradientColorStops={[0, '#FF7A18', 1, '#FFB347']}
        cornerRadius={[CORNER_RADIUS, CORNER_RADIUS, 0, 0]}
        opacity={0.9}
      />

      {/* Accent Line */}
      <Line
        points={[0, 0, 0, HEADER_HEIGHT]}
        stroke={colorScheme.primary}
        strokeWidth={5}
        lineCap="round"
      />

      {/* Condition Type Badge */}
      <Group x={PADDING} y={10}>
        <Rect
          width={140}
          height={24}
          fill="rgba(15,23,42,0.34)"
          stroke="rgba(255,220,170,0.7)"
          strokeWidth={1}
          cornerRadius={12}
        />
        <Text
          text={`${getConditionIcon()} ${conditionType.toUpperCase()}`}
          x={8}
          y={5}
          fontSize={12}
          fontStyle="bold"
          fill="#FFF0D9"
          fontFamily="'SF Pro Display', system-ui"
        />
      </Group>

      {/* Condition/Expression */}
      <Group y={40}>
        <Text
          text={conditionType === 'switch' ? 'SWITCH:' : 'CONDITION:'}
          x={PADDING + 6}
          y={0}
          fontSize={8}
          fontStyle="bold"
          fill="#64748B"
          fontFamily="'SF Pro Display', system-ui"
          letterSpacing={1}
        />
        <Text
          text={conditionType === 'switch' ? (switchExpression || condition) : condition}
          x={PADDING + 6}
          y={14}
          width={totalWidth - PADDING * 2 - 12}
          fontSize={11}
          fill="#F1F5F9"
          fontFamily="'SF Mono', monospace"
          fontStyle="bold"
          wrap="char"
          ellipsis={true}
        />
      </Group>

      {/* Divider */}
      <Line
        points={[0, HEADER_HEIGHT, totalWidth, HEADER_HEIGHT]}
        stroke="#334155"
        strokeWidth={1.5}
      />

      {/* Result Indicator Bar */}
      {conditionResult !== undefined && (
        <Group y={HEADER_HEIGHT - 8}>
          <Rect
            x={0}
            width={totalWidth}
            height={6}
            fill={resultColor?.primary}
            opacity={0.6}
            shadowColor={resultColor?.primary}
            shadowBlur={10}
            shadowOpacity={0.8}
          />
        </Group>
      )}

      {/* Body Section */}
      {shouldRenderBody ? (
        <Group y={HEADER_HEIGHT + 10}>{children}</Group>
      ) : null}

      </Group>
      {/* Condition Result */}
      {conditionResult !== undefined && (
        <Group x={PADDING} y={totalHeight - 32}>
          <Rect
            width={conditionResult ? 100 : 110}
            height={22}
            fill={conditionResult ? 'rgba(255, 209, 102, 0.18)' : 'rgba(255, 107, 107, 0.18)'}
            stroke={conditionResult ? COLORS.true.primary : COLORS.false.primary}
            strokeWidth={1.5}
            cornerRadius={11}
          />
          <Text
            text={conditionResult ? '✓ TRUE' : '✗ FALSE'}
            width={conditionResult ? 100 : 110}
            y={5}
            fontSize={10}
            fontStyle="bold"
            fill={conditionResult ? COLORS.true.primary : COLORS.false.primary}
            align="center"
            fontFamily="'SF Pro Display', system-ui"
          />
        </Group>
      )}

      {/* Branch Taken Indicator */}
      {branchTaken && (
        <Group x={totalWidth - 140} y={totalHeight - 32}>
          <Rect
            width={125}
            height={22}
            fill={colorScheme.bg}
            stroke={colorScheme.accent}
            strokeWidth={1.5}
            cornerRadius={11}
          />
          <Text
            text={getBranchDisplay() || ''}
            width={125}
            y={5}
            fontSize={9}
            fontStyle="bold"
            fill={colorScheme.light}
            align="center"
            fontFamily="'SF Pro Display', system-ui"
          />
        </Group>
      )}

      {/* Switch Cases Counter */}
      {conditionType === 'switch' && totalCases !== undefined && (
        <Group x={totalWidth - 100} y={10}>
          <Rect
            width={85}
            height={24}
            fill="rgba(51, 65, 85, 0.6)"
            stroke={colorScheme.accent}
            strokeWidth={1.5}
            cornerRadius={12}
          />
          <Text
            text={`${totalCases} cases`}
            width={85}
            y={5}
            fontSize={10}
            fontStyle="bold"
            fill={colorScheme.light}
            align="center"
            fontFamily="'SF Mono', monospace"
          />
        </Group>
      )}

      {/* No Execution Badge */}
      {conditionResult === false && !branchTaken && conditionType === 'if' && (
        <Group x={totalWidth - 160} y={totalHeight - 32}>
          <Rect
            width={145}
            height={22}
            fill="rgba(100, 116, 139, 0.2)"
            stroke="#64748B"
            strokeWidth={1.5}
            cornerRadius={11}
          />
          <Text
            text="⊘ NO EXECUTION"
            width={145}
            y={5}
            fontSize={9}
            fontStyle="bold"
            fill="#94A3B8"
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
          fill={resultColor?.primary || colorScheme.primary}
          shadowColor={resultColor?.primary || colorScheme.primary}
          shadowBlur={12}
          shadowOpacity={1}
        />
      )}

      {/* Diamond Branch Indicator */}
      <Group x={totalWidth / 2} y={-12}>
        <Path
          data="M 0,-10 L 10,0 L 0,10 L -10,0 Z"
          fill={colorScheme.primary}
          stroke={colorScheme.light}
          strokeWidth={2}
          shadowColor={colorScheme.glow}
          shadowBlur={10}
          shadowOpacity={0.6}
        />
        <Text
          text="?"
          x={-4}
          y={-6}
          fontSize={10}
          fontStyle="bold"
          fill="#FFFFFF"
          fontFamily="'SF Pro Display', system-ui"
        />
      </Group>
    </Group>
  );
});

ConditionElement.displayName = 'ConditionElement';

export default ConditionElement;
