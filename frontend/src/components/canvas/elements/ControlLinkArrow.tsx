import React, { memo, useEffect, useMemo, useRef } from "react";
import { Arrow, Group } from "react-konva";
import Konva from "konva";

export interface ControlLinkArrowProps {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  c1x?: number;
  c1y?: number;
  c2x?: number;
  c2y?: number;
  arrowKind?: "caller_to_condition" | "condition_to_body" | "return_flow";
  dashed?: boolean;
  strokeWidth?: number;
  opacity?: number;
  animated?: boolean;
  pointerLength?: number;
  pointerWidth?: number;
  isActive?: boolean;
  isNew?: boolean;
  isHighlighted?: boolean;
}

const sampleBezierPoints = (
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
): number[] => {
  const points: number[] = [];
  const steps = 28;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x =
      mt * mt * mt * fromX +
      3 * mt * mt * t * c1x +
      3 * mt * t * t * c2x +
      t * t * t * toX;
    const y =
      mt * mt * mt * fromY +
      3 * mt * mt * t * c1y +
      3 * mt * t * t * c2y +
      t * t * t * toY;
    points.push(x, y);
  }
  return points;
};

export const ControlLinkArrow: React.FC<ControlLinkArrowProps> = memo(
  ({
    id,
    fromX,
    fromY,
    toX,
    toY,
    c1x,
    c1y,
    c2x,
    c2y,
    arrowKind = "caller_to_condition",
    dashed,
    strokeWidth,
    opacity,
    animated,
    pointerLength,
    pointerWidth,
    isActive = false,
    isNew = false,
    isHighlighted = false,
  }) => {
    const arrowRef = useRef<Konva.Arrow>(null);
    const isReturnArrow = arrowKind === "return_flow";
    const highlightBoost = isHighlighted && !isReturnArrow ? 0.45 : 0;
    const baseStrokeWidth = strokeWidth ?? 2;
    const effectiveStrokeWidth = baseStrokeWidth + highlightBoost;
    const baseOpacity = opacity ?? 0.9;
    const effectiveOpacity =
      isHighlighted && !isReturnArrow ? Math.max(baseOpacity, 1) : baseOpacity;
    const effectivePointerLength =
      pointerLength ??
      (arrowKind === "condition_to_body" ? 8 : isReturnArrow ? 7 : 10);
    const effectivePointerWidth =
      pointerWidth ??
      (arrowKind === "condition_to_body" ? 8 : isReturnArrow ? 7 : 10);
    const shouldAnimateStroke = animated ?? !isReturnArrow;
    const isDashed = dashed ?? false;

    const points = useMemo(() => {
      const isConditionToBody = arrowKind === "condition_to_body";
      const cx1 = c1x ?? (isConditionToBody ? fromX - 30 : fromX + 60);
      const cy1 = c1y ?? (isConditionToBody ? fromY + 16 : fromY);
      const cx2 = c2x ?? (isConditionToBody ? toX - 30 : toX - 60);
      const cy2 = c2y ?? (isConditionToBody ? toY - 16 : toY);
      return sampleBezierPoints(fromX, fromY, toX, toY, cx1, cy1, cx2, cy2);
    }, [fromX, fromY, toX, toY, c1x, c1y, c2x, c2y, arrowKind]);

    useEffect(() => {
      const arrow = arrowRef.current;
      if (!arrow) return;

      arrow.opacity(effectiveOpacity);
      arrow.strokeWidth(effectiveStrokeWidth);
      arrow.pointerLength(effectivePointerLength);
      arrow.pointerWidth(effectivePointerWidth);
      arrow.dash(isDashed ? [8, 7] : []);
      arrow.dashOffset(0);
    }, [
      effectiveOpacity,
      effectiveStrokeWidth,
      effectivePointerLength,
      effectivePointerWidth,
      isDashed,
    ]);

    useEffect(() => {
      const arrow = arrowRef.current;
      if (!arrow) return;
      if (!shouldAnimateStroke || !isActive || isReturnArrow) return;

      arrow.dash([14, 10]);
      let rafId = 0;
      let offset = 0;

      const tick = () => {
        offset -= 1.9;
        arrow.dashOffset(offset);
        arrow.getLayer()?.batchDraw();
        rafId = requestAnimationFrame(tick);
      };

      tick();

      return () => {
        cancelAnimationFrame(rafId);
        arrow.dash(isDashed ? [8, 7] : []);
        arrow.dashOffset(0);
      };
    }, [shouldAnimateStroke, isActive, isReturnArrow, isDashed]);

    useEffect(() => {
      const arrow = arrowRef.current;
      if (!arrow || !isNew) return;

      arrow.opacity(0);

      new Konva.Tween({
        node: arrow,
        opacity: effectiveOpacity,
        duration: 0.35,
        easing: Konva.Easings.EaseInOut,
      }).play();
    }, [isNew, effectiveOpacity]);

    return (
      <Group id={id}>
        <Arrow
          ref={arrowRef}
          points={points}
          stroke="#ff9a3c"
          strokeWidth={effectiveStrokeWidth}
          fill="#ff9a3c"
          pointerLength={effectivePointerLength}
          pointerWidth={effectivePointerWidth}
          opacity={effectiveOpacity}
          lineCap="round"
          lineJoin="round"
          tension={0}
        />
      </Group>
    );
  },
);

ControlLinkArrow.displayName = "ControlLinkArrow";

export default ControlLinkArrow;
