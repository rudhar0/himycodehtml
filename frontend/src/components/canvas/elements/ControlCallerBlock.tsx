import React, { memo, useEffect, useRef, useState } from "react";
import { Group, Rect, Text } from "react-konva";
import Konva from "konva";

export interface CallerBlockProps {
  id: string;
  x: number;
  y: number;
  width: number;
  condition: string;
  controlKind: "if" | "else_if" | "switch" | "case" | "default" | "else";
  conditionResult: boolean | null;
  branchState?: "active" | "skipped" | "pending";
  isActive?: boolean;
  isNew?: boolean;
  stepNumber?: number;
  onToggleBody?: (id: string) => void;
  onHoverChange?: (id: string | null) => void;
}

const HEIGHT = 44;
const kindLabel: Record<CallerBlockProps["controlKind"], string> = {
  if: "IF",
  else_if: "ELSE IF",
  else: "ELSE",
  switch: "SWITCH",
  case: "CASE",
  default: "DEFAULT",
};

const RESULT_COLORS = {
  true: "rgba(255, 209, 102, 0.85)",
  matched: "rgba(255, 209, 102, 0.85)",
  false: "rgba(255, 107, 107, 0.85)",
  skipped: "rgba(176, 137, 104, 0.65)",
  pending: "rgba(255, 179, 71, 0.7)",
};

const getResultLabel = (
  controlKind: CallerBlockProps["controlKind"],
  conditionResult: boolean | null,
  branchState: CallerBlockProps["branchState"],
) => {
  const isCaseLike =
    controlKind === "switch" ||
    controlKind === "case" ||
    controlKind === "default";
  if (isCaseLike) {
    if (branchState === "active" || conditionResult === true) return "MATCHED";
    if (branchState === "skipped") return "SKIPPED";
    return "PENDING";
  }

  if (controlKind === "else") {
    return branchState === "active" ? "TRUE" : "SKIPPED";
  }

  if (conditionResult === true) return "TRUE";
  if (conditionResult === false) return "FALSE";
  if (branchState === "skipped") return "SKIPPED";
  return "PENDING";
};

const getResultColor = (resultLabel: string) => {
  if (resultLabel === "TRUE") return RESULT_COLORS.true;
  if (resultLabel === "MATCHED") return RESULT_COLORS.matched;
  if (resultLabel === "FALSE") return RESULT_COLORS.false;
  if (resultLabel === "SKIPPED") return RESULT_COLORS.skipped;
  return RESULT_COLORS.pending;
};

export const ControlCallerBlock: React.FC<CallerBlockProps> = memo(
  ({
    id,
    x,
    y,
    width,
    condition,
    controlKind,
    conditionResult,
    branchState = "pending",
    isActive = false,
    isNew = false,
    stepNumber,
    onToggleBody,
    onHoverChange,
  }) => {
    const groupRef = useRef<Konva.Group>(null);
    const [hovered, setHovered] = useState(false);
    const resultLabel = getResultLabel(controlKind, conditionResult, branchState);
    const resultColor = getResultColor(resultLabel);

    useEffect(() => {
      const node = groupRef.current;
      if (!node || !isNew) return;

      node.opacity(0);
      node.y(y + 10);

      new Konva.Tween({
        node,
        opacity: 1,
        y,
        duration: 0.2,
        easing: Konva.Easings.EaseInOut,
      }).play();
    }, [isNew, y]);

    return (
      <Group
        ref={groupRef}
        id={id}
        x={x}
        y={y}
        onMouseEnter={() => {
          setHovered(true);
          onHoverChange?.(id);
        }}
        onMouseLeave={() => {
          setHovered(false);
          onHoverChange?.(null);
        }}
        onClick={() => onToggleBody?.(id)}
      >
        <Rect
          x={-4}
          y={-4}
          width={width + 8}
          height={HEIGHT + 8}
          fill="transparent"
          cornerRadius={10}
          shadowColor={resultColor}
          shadowBlur={hovered || isActive ? 16 : 11}
          shadowOpacity={0.4}
        />

        <Rect
          width={width}
          height={HEIGHT}
          fill="rgba(15,23,42,0.96)"
          stroke={resultColor}
          strokeWidth={isActive ? 2.4 : 2}
          cornerRadius={8}
          fillLinearGradientStartPoint={{ x: 0, y: 0 }}
          fillLinearGradientEndPoint={{ x: width, y: HEIGHT }}
          fillLinearGradientColorStops={[
            0,
            "rgba(15,23,42,0.98)",
            1,
            resultColor.replace("0.85", "0.15").replace("0.7", "0.15"),
          ]}
        />

        <Group x={10} y={11}>
          <Rect
            width={84}
            height={22}
            fill="rgba(15,23,42,0.36)"
            stroke="rgba(255,220,170,0.7)"
            strokeWidth={1}
            cornerRadius={11}
          />
          <Text
            text={kindLabel[controlKind]}
            y={5}
            width={84}
            align="center"
            fontSize={11}
            fontStyle="bold"
            fill="#FFF0D9"
            fontFamily="monospace"
          />
        </Group>

        <Text
          text={condition || "(condition)"}
          x={100}
          y={15}
          width={Math.max(40, width - 210)}
          fontSize={11}
          fill="#FFF0D9"
          fontFamily="monospace"
          ellipsis
        />

        <Group x={width - 104} y={11}>
          <Rect
            width={94}
            height={22}
            fill="rgba(15,23,42,0.42)"
            stroke={resultColor}
            strokeWidth={1.3}
            cornerRadius={11}
            shadowColor={resultColor}
            shadowBlur={9}
            shadowOpacity={0.5}
          />
          <Text
            text={resultLabel}
            y={5}
            width={94}
            align="center"
            fontSize={10}
            fontStyle="bold"
            fill={resultColor}
            fontFamily="monospace"
          />
        </Group>

        {stepNumber !== undefined ? (
          <Text
            text={`#${stepNumber}`}
            x={width - 30}
            y={3}
            fontSize={9}
            fontStyle="bold"
            fill="rgba(255, 224, 186, 0.65)"
            fontFamily="monospace"
          />
        ) : null}
      </Group>
    );
  },
);

ControlCallerBlock.displayName = "ControlCallerBlock";

export default ControlCallerBlock;
