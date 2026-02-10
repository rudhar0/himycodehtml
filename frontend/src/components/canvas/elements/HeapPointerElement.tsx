import React, { useRef, useEffect, useState } from 'react';
import { Group, Rect, Text, Line, Circle } from 'react-konva';
import Konva from 'konva';

export interface HeapPointerElementProps {
  id: string;
  name: string;
  type: string;
  value: any;
  address?: string | null;
  x: number;
  y: number;
  isNew?: boolean;
  isUpdated?: boolean;
  stepNumber?: number;
  enterDelay?: number;
  
  pointsTo?: {
    target: string;
    region: 'stack' | 'heap';
    address?: string | null;
  };
  
  isHeapBacked?: boolean;
  memoryRegion?: 'stack' | 'heap';
  
  decayedFromArray?: boolean;
  aliasOf?: string;
  explanation?: string;
}

const BOX_WIDTH = 360;
const BASE_HEIGHT = 140;
const EXPLANATION_HEIGHT = 35;
const PADDING = 16;
const CORNER_RADIUS = 12;

const HEAP_GRADIENT = {
  start: '#8B5CF6',
  end: '#06B6D4',
};

const POINTER_ACCENT = '#F59E0B';
const ADDRESS_COLOR = '#64748B';
const VALUE_COLOR = '#10B981';
const BG_COLOR = 'rgba(15, 23, 42, 0.95)';

export const HeapPointerElement: React.FC<HeapPointerElementProps> = ({
  id,
  name,
  type,
  value,
  address,
  x,
  y,
  isNew = false,
  isUpdated = false,
  stepNumber,
  enterDelay = 0,
  pointsTo,
  isHeapBacked = false,
  memoryRegion = 'stack',
  decayedFromArray = false,
  aliasOf,
  explanation
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const glowRef = useRef<Konva.Rect>(null);
  const [isHovered, setIsHovered] = useState(false);
  const isInitialMount = useRef(true);
  const [showingExplanation, setShowingExplanation] = useState(!!explanation);

  const isPointer = type.includes('*') || !!pointsTo || decayedFromArray;
  const displayRegion = memoryRegion === 'heap' ? 'HEAP' : 'STACK';

  const formatValue = (val: any): string => {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'string') {
      if (val.length > 20) return `"${val.slice(0, 18)}..."`;
      return `"${val}"`;
    }
    if (typeof val === 'number') {
      const str = String(val);
      return str.length > 20 ? val.toExponential(2) : str;
    }
    return String(val).slice(0, 20);
  };

  const displayValue = formatValue(value);
  const displayAddress = address && address !== '0x0' ? address.slice(0, 12) : '—';

  const totalHeight = BASE_HEIGHT;

  useEffect(() => {
    const group = groupRef.current;
    const glow = glowRef.current;

    if (!group) return;

    if (isNew && isInitialMount.current) {
      group.opacity(0);
      group.scaleX(0.8);
      group.scaleY(0.8);
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
            if (glow) {
              glow.to({ opacity: 0.6, duration: 0.3 });
            }
          },
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
      if (glow) glow.opacity(0.6);
      isInitialMount.current = false;
    }
  }, [isNew, enterDelay]);

  // Color transition for explanation
  useEffect(() => {
    if (explanation && showingExplanation) {
      const timer = setTimeout(() => {
        setShowingExplanation(false);
        
        const group = groupRef.current;
        if (group) {
          const mainBg = group.findOne('.main-bg');
          if (mainBg) {
            mainBg.to({
              fill: 'rgba(124, 58, 237, 0.25)',
              stroke: '#6D28D9',
              duration: 0.5
            });
          }
        }
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [explanation, showingExplanation]);

  useEffect(() => {
    if (!isUpdated || !glowRef.current) return;

    const glow = glowRef.current;
    glow.to({
      shadowBlur: 35,
      opacity: 1,
      duration: 0.2,
      yoyo: true,
      repeat: 1,
    });
  }, [isUpdated, value]);

  const handleMouseEnter = () => {
    setIsHovered(true);
    glowRef.current?.to({ shadowBlur: 30, opacity: 0.8, duration: 0.15 });
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    glowRef.current?.to({ shadowBlur: 20, opacity: 0.6, duration: 0.15 });
  };

  return (
    <Group
      ref={groupRef}
      id={`${id}-${stepNumber || 0}`}
      x={x}
      y={y}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Rect
        ref={glowRef}
        x={-4}
        y={-4}
        width={BOX_WIDTH + 8}
        height={totalHeight + 8}
        fill="transparent"
        cornerRadius={CORNER_RADIUS + 2}
        shadowColor={isHeapBacked ? HEAP_GRADIENT.start : POINTER_ACCENT}
        shadowBlur={20}
        shadowOpacity={0.6}
        opacity={0}
      />

      <Rect
        width={BOX_WIDTH}
        height={BASE_HEIGHT}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: BOX_WIDTH, y: BASE_HEIGHT }}
        fillLinearGradientColorStops={
          isHeapBacked
            ? [0, HEAP_GRADIENT.start, 1, HEAP_GRADIENT.end]
            : [0, BG_COLOR, 1, BG_COLOR]
        }
        stroke={isPointer ? POINTER_ACCENT : HEAP_GRADIENT.start}
        strokeWidth={isHovered ? 3 : 2}
        cornerRadius={CORNER_RADIUS}
        shadowColor="rgba(0, 0, 0, 0.4)"
        shadowBlur={12}
        shadowOffsetY={4}
        opacity={isHeapBacked ? 0.2 : 1}
      />

      <Rect
        name="main-bg"
        width={BOX_WIDTH}
        height={BASE_HEIGHT}
        fill={showingExplanation ? 
              'rgba(139, 92, 246, 0.15)' : 
              'rgba(124, 58, 237, 0.25)'}
        cornerRadius={CORNER_RADIUS}
        opacity={0.9}
      />

      <Line
        points={[0, 0, 0, BASE_HEIGHT]}
        stroke={isPointer ? POINTER_ACCENT : HEAP_GRADIENT.end}
        strokeWidth={4}
        lineCap="round"
        opacity={0.8}
      />

      <Group x={BOX_WIDTH - 80} y={8}>
        <Rect
          width={70}
          height={20}
          fill={isHeapBacked ? HEAP_GRADIENT.start : '#334155'}
          cornerRadius={10}
          opacity={0.3}
        />
        <Text
          text={displayRegion}
          width={70}
          y={4}
          fontSize={10}
          fontStyle="bold"
          fill="#F1F5F9"
          align="center"
          fontFamily="'SF Pro Display', system-ui"
        />
      </Group>

      <Text
        text={name.toUpperCase()}
        x={PADDING}
        y={12}
        fontSize={18}
        fontStyle="bold"
        fill="#F1F5F9"
        fontFamily="'SF Pro Display', system-ui"
      />

      <Text
        text={type}
        x={PADDING}
        y={34}
        fontSize={12}
        fill={isPointer ? POINTER_ACCENT : '#94A3B8'}
        fontFamily="'SF Mono', monospace"
        fontStyle="italic"
      />

      <Line
        points={[PADDING, 52, BOX_WIDTH - PADDING, 52]}
        stroke="#334155"
        strokeWidth={1}
        opacity={0.5}
      />

      <Group y={58}>
        <Text
          text="ADDR:"
          x={PADDING}
          y={0}
          fontSize={9}
          fontStyle="bold"
          fill={ADDRESS_COLOR}
          fontFamily="'SF Pro Display', system-ui"
        />
        <Text
          text={displayAddress}
          x={PADDING + 50}
          y={0}
          fontSize={11}
          fill="#CBD5E1"
          fontFamily="'SF Mono', monospace"
        />
      </Group>

      <Group y={76}>
        <Text
          text="VALUE:"
          x={PADDING}
          y={0}
          fontSize={9}
          fontStyle="bold"
          fill={ADDRESS_COLOR}
          fontFamily="'SF Pro Display', system-ui"
        />
        <Text
          text={displayValue}
          x={PADDING + 55}
          y={0}
          fontSize={13}
          fontStyle="bold"
          fill={VALUE_COLOR}
          fontFamily="'SF Mono', monospace"
        />
      </Group>

      {isPointer && (
        <Group y={94}>
          <Circle x={PADDING + 4} y={4} radius={3} fill={POINTER_ACCENT} />
          <Text
            text="→"
            x={PADDING + 12}
            y={0}
            fontSize={14}
            fill={POINTER_ACCENT}
          />
          <Text
            text={
              aliasOf
                ? `${aliasOf} (array decay)`
                : pointsTo?.target
                ? `${pointsTo.target} (${pointsTo.region})`
                : 'unresolved'
            }
            x={PADDING + 28}
            y={2}
            fontSize={11}
            fill="#FCD34D"
            fontFamily="'SF Mono', monospace"
            fontStyle="italic"
          />
        </Group>
      )}

      {!isPointer && (
        <Group y={94}>
          <Rect
            x={PADDING}
            y={0}
            width={BOX_WIDTH - PADDING * 2}
            height={24}
            fill="transparent"
            stroke="#475569"
            strokeWidth={1}
            dash={[4, 4]}
            cornerRadius={4}
            opacity={0.4}
          />
          <Text
            text="[ Function Call Slot ]"
            x={PADDING}
            y={6}
            width={BOX_WIDTH - PADDING * 2}
            fontSize={9}
            fill="#64748B"
            align="center"
            fontFamily="'SF Pro Display', system-ui"
            fontStyle="italic"
          />
        </Group>
      )}

      {stepNumber !== undefined && (
        <Text
          text={`#${stepNumber}`}
          x={BOX_WIDTH - 50}
          y={BASE_HEIGHT - 20}
          fontSize={10}
          fontStyle="bold"
          fill="#475569"
          fontFamily="'SF Mono', monospace"
        />
      )}

      {explanation && (
        <Group y={BASE_HEIGHT - EXPLANATION_HEIGHT - 8}>
          <Rect
            name="explanation-bg"
            width={BOX_WIDTH}
            height={EXPLANATION_HEIGHT}
            fill={showingExplanation ? 
                  'rgba(245, 158, 11, 0.3)' : 
                  'rgba(76, 29, 149, 0.9)'}
            stroke={showingExplanation ? POINTER_ACCENT : '#6D28D9'}
            strokeWidth={1}
            cornerRadius={8}
          />
          <Text
            text={`💡 ${explanation}`}
            x={12}
            y={12}
            width={BOX_WIDTH - 24}
            fontSize={10}
            fill={showingExplanation ? '#78350F' : '#E9D5FF'}
            fontFamily="'SF Pro Display', system-ui"
            fontStyle="bold"
            align="center"
          />
        </Group>
      )}
    </Group>
  );
};

export default HeapPointerElement;