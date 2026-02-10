import React, { useRef, useEffect, useState } from 'react';
import { Group, Rect, Text, Circle, Line } from 'react-konva';
import Konva from 'konva';

type VariableState = 
  | 'declared'
  | 'initialized'
  | 'updated';

interface VariableBoxProps {
  id: string;
  name: string;
  type: string;
  value: any;
  address: string;
  x: number;
  y: number;
  width: number;
  height: number;
  section: 'global' | 'stack' | 'heap';
  isNew?: boolean;
  isUpdated?: boolean;
  previousValue?: any;
  expression?: string;
  onClick?: () => void;
  state?: VariableState;
  stepNumber?: number;
  enterDelay?: number;
  color?: string;
  explanation?: string;
}

const TYPE_COLORS: Record<string, {
  primary: string;
  light: string;
  dark: string;
  glow: string;
  bg: string;
  accent: string;
}> = {
  int: {
    primary: '#2563EB',
    light: '#60A5FA',
    dark: '#1E40AF',
    glow: 'rgba(37, 99, 235, 0.6)',
    bg: 'rgba(37, 99, 235, 0.18)',
    accent: '#3B82F6'
  },
  float: {
    primary: '#0891B2',
    light: '#22D3EE',
    dark: '#0E7490',
    glow: 'rgba(8, 145, 178, 0.6)',
    bg: 'rgba(8, 145, 178, 0.18)',
    accent: '#06B6D4'
  },
  double: {
    primary: '#7C3AED',
    light: '#A78BFA',
    dark: '#6D28D9',
    glow: 'rgba(124, 58, 237, 0.6)',
    bg: 'rgba(124, 58, 237, 0.18)',
    accent: '#8B5CF6'
  },
  char: {
    primary: '#EA580C',
    light: '#FB923C',
    dark: '#C2410C',
    glow: 'rgba(234, 88, 12, 0.6)',
    bg: 'rgba(234, 88, 12, 0.18)',
    accent: '#F97316'
  },
  bool: {
    primary: '#9333EA',
    light: '#C084FC',
    dark: '#7E22CE',
    glow: 'rgba(147, 51, 234, 0.6)',
    bg: 'rgba(147, 51, 234, 0.18)',
    accent: '#A855F7'
  },
  string: {
    primary: '#DB2777',
    light: '#F472B6',
    dark: '#BE185D',
    glow: 'rgba(219, 39, 119, 0.6)',
    bg: 'rgba(219, 39, 119, 0.18)',
    accent: '#EC4899'
  },
  pointer: {
    primary: '#DC2626',
    light: '#F87171',
    dark: '#B91C1C',
    glow: 'rgba(220, 38, 38, 0.6)',
    bg: 'rgba(220, 38, 38, 0.18)',
    accent: '#F87171'
  },
  array: {
    primary: '#10B981',
    light: '#34D399',
    dark: '#059669',
    glow: 'rgba(16, 185, 129, 0.6)',
    bg: 'rgba(16, 185, 129, 0.18)',
    accent: '#34D399'
  },
  default: {
    primary: '#64748B',
    light: '#94A3B8',
    dark: '#475569',
    glow: 'rgba(100, 116, 139, 0.6)',
    bg: 'rgba(100, 116, 139, 0.18)',
    accent: '#94A3B8'
  }
};

const STATE_CONFIGS = {
  declared: {
    label: 'DECLARED',
    dotColor: '#94A3B8',
    labelBg: 'rgba(148, 163, 184, 0.25)',
    labelStroke: '#94A3B8',
    glowEnabled: false,
    borderDash: [8, 4],
    bgOpacity: 0.6
  },
  initialized: {
    label: 'INITIALIZED',
    dotColor: '#10B981',
    labelBg: 'rgba(16, 185, 129, 0.25)',
    labelStroke: '#10B981',
    glowEnabled: true,
    borderDash: [],
    bgOpacity: 0.2
  },
  updated: {
    label: 'UPDATED',
    dotColor: '#F59E0B',
    labelBg: 'rgba(245, 158, 11, 0.25)',
    labelStroke: '#F59E0B',
    glowEnabled: true,
    borderDash: [],
    bgOpacity: 0.2
  }
};

const BOX_WIDTH = 360;
const BASE_HEIGHT = 140;
const EXPLANATION_HEIGHT = 35;
const PADDING = 16;
const CORNER_RADIUS = 12;

export const VariableBox: React.FC<VariableBoxProps> = ({
  id,
  name,
  type,
  value,
  address,
  x,
  y,
  width,
  height,
  section,
  isNew = false,
  isUpdated = false,
  previousValue,
  expression,
  onClick,
  state: varState = 'initialized',
  stepNumber,
  enterDelay = 0,
  color,
  explanation
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const glowRef = useRef<Konva.Rect>(null);
  const dotRef = useRef<Konva.Circle>(null);
  const [isHovered, setIsHovered] = useState(false);
  const isInitialMount = useRef(true);
  const [showingExplanation, setShowingExplanation] = useState(!!explanation);

  const stateConfig = STATE_CONFIGS[varState];
  
  const normalizeType = (t: string): string => {
    const lower = t.toLowerCase();
    if (lower.includes('int')) return 'int';
    if (lower.includes('float')) return 'float';
    if (lower.includes('double')) return 'double';
    if (lower.includes('char')) return 'char';
    if (lower.includes('bool')) return 'bool';
    if (lower.includes('string')) return 'string';
    if (lower.includes('*') || lower.includes('ptr') || lower.includes('point')) return 'pointer';
    if (lower.includes('[]') || lower.includes('array')) return 'array';
    return 'default';
  };

  const typeKey = normalizeType(type);
  const colors = TYPE_COLORS[typeKey];

  const formatValue = (val: any): string => {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'string') {
      if (val.length > 15) return `"${val.slice(0, 13)}..."`;
      return `"${val}"`;
    }
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'number') {
      const str = String(val);
      if (str.length > 15) return val.toExponential(2);
      return str;
    }
    return String(val).slice(0, 15);
  };

  const displayValue = varState === 'declared' ? '—' : formatValue(value);

  const hasExplanation = !!explanation;
  
  const bgColor = varState === 'declared' 
    ? 'rgba(51, 65, 85, 0.5)'
    : (hasExplanation && showingExplanation) 
      ? 'rgba(16, 185, 129, 0.15)'
      : colors.bg;
  
  const borderColor = varState === 'declared' 
    ? '#64748B'
    : (hasExplanation && showingExplanation)
      ? '#10B981'
      : colors.primary;
  
  const borderWidth = varState === 'declared' ? 2 : 3;

  const totalHeight = BASE_HEIGHT;

  useEffect(() => {
    const group = groupRef.current;
    const glow = glowRef.current;
    const dot = dotRef.current;
    
    if (!group) return;

    if (isNew && isInitialMount.current) {
      group.opacity(0);
      group.scaleX(0.75);
      group.scaleY(0.75);
      const origY = group.y();
      group.y(origY + 25);

      const playAnim = () => {
        if (!group.getLayer()) return;
        new Konva.Tween({
          node: group,
          opacity: 1,
          scaleX: 1,
          scaleY: 1,
          y: origY,
          duration: 0.6,
          easing: Konva.Easings.BackEaseOut,
          onFinish: () => {
            if (glow && varState !== 'declared') {
              glow.to({ opacity: 0.7, duration: 0.4 });
            }
            if (dot) {
              new Konva.Tween({
                node: dot,
                scaleX: 1.6,
                scaleY: 1.6,
                duration: 0.25,
                onFinish: () => dot.to({ scaleX: 1, scaleY: 1, duration: 0.25 })
              }).play();
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
      group.scaleX(1);
      group.scaleY(1);
      if (glow && varState !== 'declared') glow.opacity(0.7);
      isInitialMount.current = false;
    }
  }, [isNew, varState, enterDelay]);

  // Color transition for explanation
  useEffect(() => {
    if (explanation && showingExplanation) {
      const timer = setTimeout(() => {
        setShowingExplanation(false);
        
        // Transition to dark colors
        const group = groupRef.current;
        if (group) {
          const mainBg = group.findOne('.main-bg');
          if (mainBg) {
            mainBg.to({
              fill: 'rgba(5, 92, 64, 0.25)',
              stroke: '#065F46',
              duration: 0.5
            });
          }
        }
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [explanation, showingExplanation]);

  const handleMouseEnter = () => {
    setIsHovered(true);
    glowRef.current?.to({ shadowBlur: 28, opacity: 0.9, duration: 0.2 });
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    glowRef.current?.to({ shadowBlur: 20, opacity: varState === 'declared' ? 0 : 0.7, duration: 0.2 });
  };

  return (
    <Group
      ref={groupRef}
      id={`${id}-step-${stepNumber || 0}`}
      x={x}
      y={y}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
      onTap={onClick}
    >
      {stateConfig.glowEnabled && (
        <Rect
          ref={glowRef}
          x={-4}
          y={-4}
          width={BOX_WIDTH + 8}
          height={totalHeight + 8}
          fill="transparent"
          cornerRadius={CORNER_RADIUS + 3}
          shadowColor={colors.primary}
          shadowBlur={varState === 'updated' ? 25 : 20}
          shadowOpacity={varState === 'updated' ? 1 : 0.8}
          opacity={0}
        />
      )}

      <Rect
        name="main-bg"
        width={BOX_WIDTH}
        height={BASE_HEIGHT}
        fill={bgColor}
        stroke={borderColor}
        strokeWidth={borderWidth}
        dash={stateConfig.borderDash}
        cornerRadius={CORNER_RADIUS}
        shadowColor={varState === 'declared' ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.4)'}
        shadowBlur={varState === 'declared' ? 4 : 12}
        shadowOffsetY={varState === 'declared' ? 1 : 4}
        opacity={varState === 'declared' ? 0.8 : 1}
      />

      {varState !== 'declared' && (
        <Line
          points={[0, 0, 0, BASE_HEIGHT]}
          stroke={colors.accent}
          strokeWidth={5}
          lineCap="round"
          opacity={0.6}
        />
      )}

      <Circle
        ref={dotRef}
        x={BOX_WIDTH - 12}
        y={12}
        radius={6}
        fill={stateConfig.dotColor}
        shadowColor={stateConfig.dotColor}
        shadowBlur={10}
        shadowOpacity={1}
      />

      <Group x={PADDING} y={8}>
        <Rect
          width={stateConfig.label.length * 6.5 + 14}
          height={18}
          fill={stateConfig.labelBg}
          stroke={stateConfig.labelStroke}
          strokeWidth={1.5}
          cornerRadius={9}
          shadowColor={stateConfig.labelStroke}
          shadowBlur={varState === 'declared' ? 0 : 8}
          shadowOpacity={0.5}
        />
        <Text
          text={stateConfig.label}
          y={3}
          width={stateConfig.label.length * 6.5 + 14}
          fontSize={9}
          fontStyle="bold"
          fill={varState === 'declared' ? '#94A3B8' : stateConfig.dotColor}
          fontFamily="'SF Pro Display', system-ui, sans-serif"
          align="center"
          letterSpacing={0.5}
        />
      </Group>

      <Group y={32}>
        <Text
          text="VAR:"
          x={PADDING}
          y={0}
          fontSize={10}
          fontStyle="bold"
          fill="#64748B"
          fontFamily="'SF Pro Display', system-ui, sans-serif"
          letterSpacing={1}
        />
        <Text
          text={name}
          x={PADDING}
          y={14}
          width={BOX_WIDTH - PADDING * 2}
          fontSize={name.length > 10 ? 20 : 24}
          fontStyle="bold"
          fill="#FFFFFF"
          fontFamily="'SF Pro Display', system-ui, sans-serif"
          ellipsis={true}
        />
      </Group>

      <Group y={74}>
        <Text
          text="VALUE:"
          x={PADDING}
          y={0}
          fontSize={10}
          fontStyle="bold"
          fill="#64748B"
          fontFamily="'SF Pro Display', system-ui, sans-serif"
          letterSpacing={1}
        />
        <Text
          text={displayValue}
          x={PADDING}
          y={14}
          width={BOX_WIDTH - PADDING * 2}
          fontSize={displayValue.length > 10 ? 16 : 18}
          fontStyle="bold"
          fill={varState === 'declared' ? '#64748B' : colors.light}
          fontFamily="'SF Mono', 'Courier New', monospace"
          wrap="char"
          ellipsis={true}
        />
      </Group>

      {expression && (varState === 'updated' || varState === 'initialized') && (
        <Group y={106}>
          <Text
            text="FROM:"
            x={PADDING}
            y={0}
            fontSize={8}
            fontStyle="bold"
            fill="#64748B"
            fontFamily="'SF Pro Display', system-ui, sans-serif"
            letterSpacing={0.8}
          />
          <Text
            text={expression.length > 20 ? expression.slice(0, 18) + '...' : expression}
            x={PADDING + 32}
            y={0}
            width={BOX_WIDTH - PADDING * 2 - 32}
            fontSize={9}
            fill="#94A3B8"
            fontFamily="'SF Mono', monospace"
            fontStyle="italic"
            ellipsis={true}
          />
        </Group>
      )}

      <Group y={BASE_HEIGHT - 20}>
        <Rect
          x={PADDING}
          y={0}
          width={type.length * 7 + 12}
          height={16}
          fill={colors.primary}
          cornerRadius={8}
          opacity={0.35}
        />
        <Text
          text={type.toUpperCase()}
          x={PADDING + 6}
          y={2.5}
          fontSize={10}
          fontStyle="bold"
          fill={colors.light}
          fontFamily="'SF Pro Display', system-ui, sans-serif"
          letterSpacing={0.5}
        />

        {address && address !== '0x0' && address !== '00000000' && (
          <Text
            text={address.slice(0, 10)}
            x={BOX_WIDTH / 2 - 25}
            y={2.5}
            fontSize={9}
            fill="#94A3B8"
            fontFamily="'SF Mono', monospace"
          />
        )}

        {stepNumber !== undefined && (
          <Text
            text={`#${stepNumber}`}
            x={BOX_WIDTH - PADDING - 28}
            y={2.5}
            fontSize={10}
            fontStyle="bold"
            fill="#64748B"
            fontFamily="'SF Mono', monospace"
          />
        )}
      </Group>

      {explanation && (
        <Group y={BASE_HEIGHT - EXPLANATION_HEIGHT - 8}>
          <Rect
            name="explanation-bg"
            width={BOX_WIDTH}
            height={EXPLANATION_HEIGHT}
            fill={showingExplanation ? 
                  'rgba(16, 185, 129, 0.3)' : 
                  'rgba(5, 92, 64, 0.9)'}
            stroke={showingExplanation ? '#10B981' : '#065F46'}
            strokeWidth={1}
            cornerRadius={8}
            shadowColor="rgba(0,0,0,0.2)"
            shadowBlur={4}
            opacity={showingExplanation ? 1 : 0.9}
          />
          <Text
            text={`💡 ${explanation}`}
            x={12}
            y={12}
            width={BOX_WIDTH - 24}
            fontSize={10}
            fill={showingExplanation ? '#064E3B' : '#D1FAE5'}
            fontFamily="'SF Pro Display', system-ui"
            fontStyle="bold"
            align="center"
          />
        </Group>
      )}
    </Group>
  );
};

export default VariableBox;