import React, { useRef, useEffect, useState, memo, useCallback } from 'react';
import { Group, Rect, Text, Line, Circle } from 'react-konva';
import Konva from 'konva';
import { resizeContainer } from '../utils/resizeContainer';
import { MAIN_THEME } from '../../../theme/mainTheme';
import { useExecutionStore } from '../../../store/slices/executionSlice';
import { useThemeStore } from '../../../store/slices/themeSlice';


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
  onConnectorClick?: (id: string) => void;
}

// ============================================
// CONSTANTS
// ============================================

const BOX_WIDTH = 410; // Main card width
const HEADER_HEIGHT = 105; // Taller header for main metadata
const CORNER_RADIUS = 14;
const PADDING = 16;
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
    light: '#6EE7B7',
    glow: 'rgba(16, 185, 129, 0.7)'
  },
  returning: {
    primary: '#EF4444',
    light: '#F87171',
    bg: 'rgba(239, 68, 68, 0.12)',
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
  const { theme } = useThemeStore();
  const dark = theme === 'dark';
  const isMain = functionName.toLowerCase().startsWith('main');

  const groupRef = useRef<Konva.Group>(null);
  const shimmerRef = useRef<Konva.Rect>(null);
  const mainBoardRef = useRef<Konva.Rect>(null);
  const connectorRef = useRef<Konva.Circle>(null);
  const [isHovered, setIsHovered] = useState(false);
  const isInitialMount = useRef(true);
  const tweenRef = useRef<Konva.Tween | null>(null);

  // Real stats from store
  const totalExecutionSteps = useExecutionStore(state => state.executionTrace?.steps.length || 0);

  // Use prop height/width directly (calculated by LayoutEngine)
  const baseWidth = isMain ? BOX_WIDTH : (width || 400);
  const headerHeight = isMain ? HEADER_HEIGHT : 55;
  const baseHeight = height || 150;
  
  // Add a ref to track previous base dimensions
  const prevBaseDims = useRef({ width: baseWidth, height: baseHeight });
  
  const [autoSize, setAutoSize] = useState({ width: baseWidth, height: baseHeight });
  const totalWidth = Math.max(baseWidth, autoSize.width);
  const totalHeight = Math.max(baseHeight, autoSize.height);

  const colorScheme = isReturning 
    ? COLORS.returning 
    : isRecursive 
      ? COLORS.recursive 
      : COLORS.normal;

  const borderColor = isMain 
    ? (isActive ? '#7C3AED' : (dark ? MAIN_THEME.border.dark : MAIN_THEME.border.light))
    : (isActive ? COLORS.active.primary : colorScheme.primary);

  const glowColor = isMain ? (dark ? MAIN_THEME.glow.a : MAIN_THEME.glow.b) : (isActive ? COLORS.active.glow : colorScheme.glow);


  useEffect(() => {
    if (!isMain) return;
    
    const board = mainBoardRef.current;
    if (!board) return;

    const anim = new Konva.Animation((frame) => {
      if (!frame) return;
      const layer = board.getLayer();
      if (!layer) return;

      const period = 2400; // Faster "active" breathing
      const val = 0.5 + 0.5 * Math.sin((frame.time * 2 * Math.PI) / period);
      
      // Reduced intensity (50% reduction in variance and base)
      board.strokeWidth(1.2 + val * 1.8);
      board.shadowBlur(15 + val * 28);
      board.shadowOpacity(0.15 + val * 0.3);
      
      // Softer color breathing
      board.stroke(val > 0.5 
        ? (dark ? "rgba(139, 92, 246, 0.55)" : "rgba(124, 58, 237, 0.55)") 
        : (dark ? "rgba(124, 58, 237, 0.35)" : "rgba(139, 92, 246, 0.35)")
      );

      
      layer.batchDraw();
    });
    
    anim.start();
    return () => { 
      anim.stop(); 
    };
  }, [isMain]);

  // ============================================
  // SHIMMER ANIMATION (Main only)
  // ============================================
  useEffect(() => {
    if (!isMain || !shimmerRef.current) return;
    const anim = new Konva.Animation((frame) => {
      if (!frame || !shimmerRef.current) return;
      const speed = 180; // px per second
      const offset = (frame.time / 1000 * speed) % (totalWidth * 2.5);
      shimmerRef.current.x(-totalWidth + offset);
    }, shimmerRef.current.getLayer());
    anim.start();
    return () => {
      anim.stop();
    };
  }, [isMain, totalWidth]);

  // ============================================
  // SUB-CARD RENDERING (Main specialized)
  // ============================================
  const renderSubCard = (kind: 'OUTPUT' | 'VARIABLES' | 'RETURNS', title: string, step: number, icon: string) => {
    const clr = kind === 'OUTPUT' ? MAIN_THEME.types.string : 
                kind === 'VARIABLES' ? MAIN_THEME.types.int : 
                MAIN_THEME.types.ptr;
    
    return (
      <Group x={12} y={10}>
        <Rect 
          width={totalWidth - 24} 
          height={75} 
          cornerRadius={9} 
          fill={dark ? MAIN_THEME.body.dark : MAIN_THEME.body.light} 
          stroke={clr.bd} 
          strokeWidth={1}
          shadowColor={clr.clr}
          shadowBlur={isActive && step === stepNumber ? 12 : 0}
        />
        
        {/* Sub Header */}
        <Group>
          <Rect width={totalWidth - 24} height={26} fill={clr.bg} cornerRadius={[9, 9, 0, 0]} />
          <Circle x={14} y={13} radius={3.5} fill={clr.clr} />
          <Text text={title} x={28} y={8} fontSize={10} fontStyle="bold" fill={clr.clr} fontFamily="'SF Pro Display', system-ui" letterSpacing={0.5} />
          <Text text={`#${step}`} x={totalWidth - 55} y={8} fontSize={9} fill="rgba(255,255,255,0.4)" fontFamily="'JetBrains Mono', monospace" />
        </Group>

        {/* Sub Body */}
        <Group y={30} x={12}>
           <Text text={kind === 'OUTPUT' ? 'print' : kind === 'VARIABLES' ? 'declarations' : 'return value'} fontSize={9} fontStyle="bold" fill="rgba(255,255,255,0.3)" />
           <Text 
              text={kind === 'OUTPUT' ? '"Hello, World!"' : kind === 'VARIABLES' ? `${localVarCount} vars` : returnType} 
              y={14} 
              fontSize={13} 
              fontStyle="bold" 
              fill={clr.clr} 
              fontFamily="'JetBrains Mono', monospace" 
           />
        </Group>
      </Group>
    );
  };

  // ============================================
  // ENTRANCE ANIMATION
  // ============================================
  useEffect(() => {
    const group = groupRef.current;
    const board = mainBoardRef.current;

    if (!group) return;
    if (tweenRef.current) {
      tweenRef.current.destroy();
      tweenRef.current = null;
    }

    if (isNew && isInitialMount.current) {
      group.opacity(0);
      group.scaleX(0.01); 
      group.scaleY(0.01);
      const origY = group.y();
      group.y(origY + 35);

      const playAnim = () => {
        if (!group.getLayer()) return;
        const tween = new Konva.Tween({
          node: group,
          opacity: 1,
          scaleX: 1,
          scaleY: 1,
          y: origY,
          duration: 0.55,
          easing: Konva.Easings.BackEaseOut,
          onFinish: () => {
            if (board) board.to({ opacity: isMain ? 1 : 0.98, duration: 0.3 });
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
        requestAnimationFrame(playAnim);
      }
    } else if (isInitialMount.current) {
      group.opacity(1);
      group.scaleX(1);
      group.scaleY(1);
      if (board) board.opacity(isMain ? 1 : 0.98);
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

    // STRICTER guard — require fully settled animation
    if (group.scaleX() < 0.99 || group.scaleY() < 0.99 || group.opacity() < 0.95) return;

    const content = group.findOne<Konva.Node>('.content-bounds');
    if (!content) return;

    const bounds = content.getClientRect({
      relativeTo: group,
      skipTransform: true,
      skipShadow: true,
    });
    const padding = 16;
    const bottomReserve = isMain ? 50 : 40; 

    const desiredWidth = Math.ceil(Math.max(0, bounds.x + bounds.width) + padding);
    const desiredHeight = Math.ceil(
      Math.max(0, bounds.y + bounds.height) + padding + bottomReserve,
    );

    setAutoSize((prev) => {
      const nextWidth = Math.max(baseWidth, desiredWidth);
      const nextHeight = Math.max(baseHeight, desiredHeight);
      
      // STABILIZATION: Only update if change is > 1.5px to prevent sub-pixel jitter
      const diffW = Math.abs(prev.width - nextWidth);
      const diffH = Math.abs(prev.height - nextHeight);
      
      if (diffW < 1.5 && diffH < 1.5) return prev;
      // Also prevent shrinking below current measured size — only grow, never collapse
      if (nextWidth < prev.width || nextHeight < prev.height) return prev;
      
      return { width: nextWidth, height: nextHeight };
    });
  }, [baseWidth, baseHeight, isMain]);

  useEffect(() => {
    const prev = prevBaseDims.current;
    // Only reset if base dims truly changed (LayoutEngine gave new values)
    if (prev.width !== baseWidth || prev.height !== baseHeight) {
      prevBaseDims.current = { width: baseWidth, height: baseHeight };
      setAutoSize({ width: baseWidth, height: baseHeight });
    }
    const raf = requestAnimationFrame(measureContent);
    return () => cancelAnimationFrame(raf);
  }, [baseWidth, baseHeight, measureContent, parameters.length, localVarCount, isReturning]);

  // ============================================
  // ACTIVE STATE ANIMATION
  // ============================================
  useEffect(() => {
    if (isActive && mainBoardRef.current) {
      mainBoardRef.current.to({
        shadowBlur: isMain ? 40 : 32,
        opacity: 0.95,
        duration: 0.25
      });
    } else if (mainBoardRef.current) {
      mainBoardRef.current.to({
        shadowBlur: 18,
        opacity: isMain ? 1 : 0.65,
        duration: 0.25
      });
    }
  }, [isActive, isMain]);

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
      {/* Extra glow removed for consolidation */}
      {/* Main Background */}
      <Rect
        ref={mainBoardRef}
        name="main-bg"
        width={totalWidth}
        height={totalHeight}
        fill={isMain 
          ? (dark ? "rgba(18, 16, 40, 0.05)" : "rgba(255, 255, 255, 0.05)") 
          : (dark ? "rgba(15, 23, 42, 0.98)" : "rgba(255, 255, 255, 0.98)")}
        stroke={borderColor}
        strokeWidth={isMain ? 1.2 : (isActive ? 2.5 : 1.2)}
        cornerRadius={CORNER_RADIUS}
        shadowColor={isMain ? "#7C3AED" : "rgba(0, 0, 0, 0.45)"}
        shadowBlur={isMain ? 15 : 20}
        shadowOpacity={isMain ? 0.2 : 0.1}
        shadowOffsetY={isMain ? 8 : 6}
        perfectDrawEnabled={false}
        listening={!isMain}
      />

      <Group name="content-bounds">
        {/* ── HEADER ── */}
        <Group>
          {/* Header Grad Background */}
          <Rect
            width={totalWidth}
            height={headerHeight}
            fillLinearGradientStartPoint={{ x: 0, y: 0 }}
            fillLinearGradientEndPoint={{ x: totalWidth, y: 0 }}
            fillLinearGradientColorStops={isMain ? [
              0, MAIN_THEME.header.gradStart,
              0.52, MAIN_THEME.header.gradMid,
              1, MAIN_THEME.header.gradEnd
            ] : [
              0, colorScheme.primary,
              1, colorScheme.primary
            ]}
            cornerRadius={[CORNER_RADIUS, CORNER_RADIUS, 0, 0]}
            opacity={isMain ? 1 : 0.8}
          />

          {/* Grid Texture Overlay (Main only) */}
          {isMain && (
            <Group>
              {Array.from({ length: 15 }).map((_, i) => (
                <Line key={`grid-h-${i}`} points={[0, i * 4, totalWidth, i * 4]} stroke="rgba(255,255,255,0.03)" strokeWidth={1} />
              ))}
              {Array.from({ length: 40 }).map((_, i) => (
                <Line key={`grid-v-${i}`} points={[i * 10, 0, i * 10, headerHeight]} stroke="rgba(255,255,255,0.03)" strokeWidth={1} />
              ))}
            </Group>
          )}

          {/* Shimmer Sweep Overlay (Main only) */}
          {isMain && (
            <Group clipFunc={(ctx) => ctx.rect(0, 0, totalWidth, headerHeight)}>
              <Rect
                ref={shimmerRef}
                width={totalWidth}
                height={headerHeight}
                fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                fillLinearGradientEndPoint={{ x: totalWidth, y: 0 }}
                fillLinearGradientColorStops={[
                  0, 'transparent',
                  0.5, MAIN_THEME.header.shimmerColor,
                  1, 'transparent'
                ]}
              />
            </Group>
          )}

          {/* Header Content */}
          <Group x={16} y={16}>
            {/* Icon (Main only) */}
            {isMain && (
               <Group>
                  <Rect width={34} height={34} cornerRadius={9} fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.22)" strokeWidth={1} />
                  <Line points={[12, 10, 22, 17, 12, 24]} stroke="white" strokeWidth={2.5} lineCap="round" lineJoin="round" />
                  <Circle x={26} y={17} radius={2.2} fill="rgba(255,255,255,0.6)" />
               </Group>
            )}

            <Group x={isMain ? 46 : 0}>
              <Text
                text={isMain ? "main()" : functionName}
                fontSize={isMain ? 19 : 18}
                fontStyle="bold"
                fill="#FFFFFF"
                fontFamily="'JetBrains Mono', monospace"
              />
              <Text
                text={isMain ? `int main(int argc, char* argv[])` : returnType}
                y={isMain ? 22 : 22}
                fontSize={10}
                fill="rgba(255,255,255,0.5)"
                fontFamily="'JetBrains Mono', monospace"
              />
            </Group>

            {/* Badges */}
            <Group x={totalWidth - (isMain ? 110 : 90)} y={0}>
              {isActive && (
                <Group>
                  <Rect width={80} height={19} cornerRadius={4} fill={MAIN_THEME.badges.running.bg} stroke={MAIN_THEME.badges.running.border} strokeWidth={1} />
                  <Text text="● RUNNING" x={8} y={5} fontSize={9} fontStyle="bold" fill={MAIN_THEME.badges.running.text} fontFamily="'JetBrains Mono', monospace" />
                </Group>
              )}
              {!isActive && isMain && (
                 <Group>
                  <Rect width={80} height={19} cornerRadius={4} fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
                  <Text text="STOPPED" x={15} y={5} fontSize={9} fontStyle="bold" fill="rgba(255,255,255,0.4)" fontFamily="'JetBrains Mono', monospace" />
                </Group>
              )}
              {!isMain && isRecursive && (
                 <Group>
                   <Rect width={80} height={19} cornerRadius={4} fill={COLORS.recursive.bg} stroke={COLORS.recursive.primary} strokeWidth={1} />
                   <Text text="🔄 RECURSIVE" x={8} y={5} fontSize={8} fontStyle="bold" fill={COLORS.recursive.light} fontFamily="'SF Pro Display', sans-serif" />
                 </Group>
              )}
            </Group>
          </Group>

          {/* Metadata Pills (Main only) */}
          {isMain && (
            <Group x={16} y={72}>
               <Line points={[0, 0, totalWidth-32, 0]} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
               <Group y={10}>
                  {/* File Pill (Grow) */}
                  <Group>
                    <Rect width={totalWidth - 32 - 135} height={20} cornerRadius={5} fill={MAIN_THEME.meta.pillBg} />
                    <Group x={10} y={5}>
                        <Rect width={11} height={11} stroke="rgba(255,255,255,0.6)" strokeWidth={1.2} cornerRadius={1.5} />
                        <Line points={[3, 4, 8, 4]} stroke="rgba(255,255,255,0.6)" strokeWidth={1.2} />
                        <Line points={[3, 7, 6, 7]} stroke="rgba(255,255,255,0.6)" strokeWidth={1.2} />
                    </Group>
                    <Text text={`src / `} x={30} y={5} fontSize={10} fill={MAIN_THEME.meta.text} fontFamily="'JetBrains Mono', monospace" />
                    <Text text={`main.cpp`} x={65} y={5} fontSize={10} fontStyle="bold" fill={MAIN_THEME.meta.accent} fontFamily="'JetBrains Mono', monospace" />
                  </Group>
                  
                  {/* Lines Pill */}
                  <Group x={totalWidth - 32 - 130}>
                    <Rect width={50} height={20} cornerRadius={5} fill={MAIN_THEME.meta.pillBg} />
                    <Text text={`L:`} x={8} y={5} fontSize={10} fill={MAIN_THEME.meta.text} fontFamily="'JetBrains Mono', monospace" />
                    <Text text={`3–9`} x={22} y={5} fontSize={10} fontStyle="bold" fill={MAIN_THEME.meta.accent} fontFamily="'JetBrains Mono', monospace" />
                  </Group>
                  
                  {/* Step Pill */}
                  <Group x={totalWidth - 32 - 75}>
                    <Rect width={75} height={20} cornerRadius={5} fill={MAIN_THEME.meta.pillBg} />
                    <Text text={`step`} x={8} y={5} fontSize={10} fill={MAIN_THEME.meta.text} fontFamily="'JetBrains Mono', monospace" />
                    <Text text={`${stepNumber || 0} / ${totalExecutionSteps - 1}`} x={38} y={5} fontSize={10} fontStyle="bold" fill={MAIN_THEME.meta.accent} fontFamily="'JetBrains Mono', monospace" />
                  </Group>
               </Group>
            </Group>
          )}

          {!isMain && (
             <Line points={[0, headerHeight, totalWidth, headerHeight]} stroke="rgba(51, 65, 85, 0.5)" strokeWidth={1} />
          )}
        </Group>

        {/* ── BODY ── */}
        <Group y={headerHeight}>
           <Group x={12} y={20}>
              {children}
              
              {/* If no children, show specialized hints/placeholders (Optional) */}
              {isMain && !children && (
                 <Group>
                    {renderSubCard('OUTPUT', 'Entry', 0, '🏠')}
                 </Group>
              )}
           </Group>
        </Group>

        {/* ── FOOTER (Main only) ── */}
        {isMain && (
          <Group y={totalHeight - 38}>
            <Line points={[0, 0, totalWidth, 0]} stroke={MAIN_THEME.border.dark} strokeWidth={1} opacity={0.4} />
            <Rect width={totalWidth} height={38} fill={MAIN_THEME.footer.bg} cornerRadius={[0, 0, CORNER_RADIUS, CORNER_RADIUS]} />
            
            {/* Steps column */}
            <Group x={16} y={15}>
               <Text text="steps" x={0} y={-5} fontSize={9} fill={MAIN_THEME.meta.text} fontFamily="'JetBrains Mono', monospace" />
               <Text text={(totalExecutionSteps - 1).toString()} x={0} y={8} fontSize={12} fontStyle="bold" fill={MAIN_THEME.meta.accent} fontFamily="'JetBrains Mono', monospace" />
            </Group>
            
            <Line points={[totalWidth*0.28, 12, totalWidth*0.28, 26]} stroke={MAIN_THEME.footer.sep} strokeWidth={1} opacity={0.4} />

            {/* Vars column */}
            <Group x={totalWidth * 0.35} y={15}>
               <Text text="vars" x={0} y={-5} fontSize={9} fill={MAIN_THEME.meta.text} fontFamily="'JetBrains Mono', monospace" />
               <Text text={localVarCount.toString()} x={0} y={8} fontSize={12} fontStyle="bold" fill={MAIN_THEME.meta.accent} fontFamily="'JetBrains Mono', monospace" />
            </Group>

            <Line points={[totalWidth*0.6, 12, totalWidth*0.6, 26]} stroke={MAIN_THEME.footer.sep} strokeWidth={1} opacity={0.4} />

            {/* Ret column */}
            <Group x={totalWidth * 0.65} y={15}>
               <Text text="ret" x={0} y={-5} fontSize={9} fill={MAIN_THEME.meta.text} fontFamily="'JetBrains Mono', monospace" />
               <Group y={8}>
                  <Text text="int" x={0} y={0} fontSize={12} fontStyle="bold" fill="#FBC02D" fontFamily="'JetBrains Mono', monospace" />
                  <Text text=": 0" x={24} y={0} fontSize={12} fontStyle="bold" fill={MAIN_THEME.meta.accent} fontFamily="'JetBrains Mono', monospace" />
               </Group>
            </Group>

            <Group x={totalWidth - 65} y={9}>
               <Rect width={50} height={20} cornerRadius={5} fill={MAIN_THEME.footer.okBg} stroke="rgba(34,197,94,0.25)" strokeWidth={1} />
               <Circle x={10} y={10} radius={2.5} fill="#22C55E" />
               <Text text="OK" x={20} y={5} fontSize={10} fontStyle="bold" fill="#22C55E" />
            </Group>
          </Group>
        )}
      </Group>

      {/* ── CONNECTOR ── */}
      {!isMain && (
        <Group
          x={totalWidth}
          y={totalHeight / 2}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onClick={() => onConnectorClick?.(id)}
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
            strokeWidth={isHovered ? 2.5 : 1.5}
            fill={dark ? MAIN_THEME.body.dark : MAIN_THEME.body.light}
          />
          <Circle
            ref={connectorRef}
            radius={CONNECTOR_RADIUS - 5}
            fill={isActive ? COLORS.active.primary : colorScheme.light}
            opacity={isActive ? 1 : 0.7}
          />
        </Group>
      )}

      {/* Step Number Badge (Regular only) */}
      {!isMain && stepNumber !== undefined && (
        <Text
          text={`#${stepNumber}`}
          x={totalWidth - 35}
          y={totalHeight - 15}
          fontSize={9}
          fontStyle="bold"
          fill="#475569"
          fontFamily="'SF Mono', monospace"
        />
      )}
    </Group>
  );
});

FunctionElement.displayName = 'FunctionElement';

export default FunctionElement;
